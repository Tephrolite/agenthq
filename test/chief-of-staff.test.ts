import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChiefOfStaff } from '../src/research/chief-of-staff.js';
import { JsonFile } from '../src/storage/json-file.js';
import { FileExecutionLedger } from '../src/billing/ledger.js';
import { BudgetController } from '../src/billing/budget-controller.js';
import { ModelClient, ModelGateway } from '../src/model/model-gateway.js';
import { loadBudgetConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
const source = { id: 's1', title: 'Example', url: 'https://example.com', text: 'The project supports one workflow.' };
const valid = { summary: 'One workflow is supported.', findings: [{ claim: 'One workflow.', sourceIds: ['s1'] }], uncertainties: [], nextSteps: [] };
const config = loadBudgetConfig({ AGENT_HQ_MONTHLY_BUDGET_USD: '5', AGENT_HQ_MAX_TASK_COST_USD: '0.10', AGENT_HQ_MAX_MODEL_CALLS_PER_TASK: '6', AGENT_HQ_MAX_CONCURRENT_RUNS: '1', AGENT_HQ_AUTONOMOUS_RUNS_ENABLED: 'false' });
function setup(t: { after: (fn: () => void) => void }, client?: ModelClient, budget = config) {
  const dir = mkdtempSync(join(tmpdir(), 'agenthq-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new FileExecutionLedger(new JsonFile(join(dir, 'ledger.json')));
  const controller = new BudgetController(budget, ledger);
  let calls = 0;
  const gateway = new ModelGateway(budget, controller, ledger, client ?? { execute: async request => {
    calls++;
    assert.ok(request.responseSchema);
    return { outputText: JSON.stringify(valid), usage: { inputTokens: 100, outputTokens: 100 } };
  } });
  const file = new JsonFile<import('../src/research/chief-of-staff.js').ResearchTask[]>(join(dir, 'tasks.json'));
  const chief = new ChiefOfStaff(gateway, file, 'gpt-5.4-mini', 1200);
  return { chief, controller, ledger, gateway, file, dir, calls: () => calls };
}
test('approval is required; completed tasks cannot run twice; state survives restart', async t => {
  const s = setup(t);
  const task = s.chief.create('What is supported?', [source]);
  assert.equal(s.calls(), 0);
  await assert.rejects(s.chief.run(task.id), /requires an approved/);
  s.chief.approve(task.id);
  assert.equal((await s.chief.run(task.id)).status, 'completed');
  await assert.rejects(s.chief.run(task.id));
  assert.equal(s.calls(), 1);
  assert.deepEqual(new ChiefOfStaff(s.gateway, s.file, 'gpt-5.4-mini', 1200).get(task.id).brief, valid);
  const restored = new FileExecutionLedger(new JsonFile(join(s.dir, 'ledger.json')));
  assert.equal(restored.list()[0].reportedCost, s.ledger.list()[0].reportedCost);
});
test('invalid citations fail without retry and incurred usage is accounted', async t => {
  let calls = 0;
  const s = setup(t, { execute: async () => { calls++; return { outputText: JSON.stringify({ ...valid, findings: [{ claim: 'fake', sourceIds: ['unknown'] }] }), usage: { inputTokens: 100, outputTokens: 100 } }; } });
  const task = s.chief.create('Question', [source]); s.chief.approve(task.id);
  assert.equal((await s.chief.run(task.id)).status, 'failed');
  assert.equal(calls, 1); assert.equal(s.controller.report().completedRequests, 1);
});
test('cancelled in-flight result is discarded; duplicate and concurrent runs are blocked', async t => {
  let release!: () => void;
  const s = setup(t, { execute: async () => new Promise(resolve => { release = () => resolve({ outputText: JSON.stringify(valid), usage: { inputTokens: 100, outputTokens: 100 } }); }) });
  const a = s.chief.create('A', [source]); const b = s.chief.create('B', [source]);
  s.chief.approve(a.id); s.chief.approve(b.id);
  const running = s.chief.run(a.id);
  await assert.rejects(s.chief.run(a.id)); await assert.rejects(s.chief.run(b.id), /Another/);
  s.chief.cancel(a.id); release();
  assert.equal((await running).status, 'cancelled'); assert.equal(s.chief.get(a.id).brief, undefined);
  assert.equal(s.controller.report().completedRequests, 1);
});
test('budget rejection makes no provider call', async t => {
  const s = setup(t, undefined, { ...config, maxTaskCost: 1n });
  const task = s.chief.create('Question', [source]); s.chief.approve(task.id);
  assert.equal((await s.chief.run(task.id)).status, 'failed'); assert.equal(s.calls(), 0);
});
test('restart retains uncertain reservations and never reruns interrupted task', t => {
  const s = setup(t);
  const task = s.chief.create('Question', [source]);
  const tasks = s.file.read([]); tasks[0].status = 'running'; s.file.write(tasks);
  s.controller.reserve(task.id, 'gpt-5.4-mini', 1000n, false);
  const ledger = new FileExecutionLedger(new JsonFile(join(s.dir, 'ledger.json')));
  assert.equal(ledger.list()[0].status, 'uncertain');
  assert.equal(new BudgetController(config, ledger).report().reservedSpending, 1000n);
  assert.equal(new ChiefOfStaff(s.gateway, s.file, 'gpt-5.4-mini', 1200).get(task.id).status, 'failed');
});
test('HTTP validation, approval, cancellation, and not-found responses', async t => {
  const s = setup(t); const app = buildServer(s.controller, s.chief); t.after(() => { void app.close(); });
  assert.equal((await app.inject({ method: 'POST', url: '/research/tasks', payload: {} })).statusCode, 400);
  assert.equal((await app.inject('/research/tasks/missing')).statusCode, 404);
  const response = await app.inject({ method: 'POST', url: '/research/tasks', payload: { question: 'Question', sources: [source] } });
  assert.equal(response.statusCode, 201); const id = response.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/research/tasks/${id}/run` })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `/research/tasks/${id}/approve` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/research/tasks/${id}/cancel` })).json().status, 'cancelled');
  assert.equal(s.calls(), 0);
});
test('source limits and duplicate source IDs are rejected', t => {
  const s = setup(t);
  assert.throws(() => s.chief.create('Question', [source, source]));
  assert.throws(() => s.chief.create('Question', [{ ...source, text: 'a'.repeat(6001) }]));
});
