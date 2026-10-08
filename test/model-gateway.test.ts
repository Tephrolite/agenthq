import assert from "node:assert/strict";
import test from "node:test";
import { BudgetController, BudgetRejectedError } from "../src/billing/budget-controller.js";
import { InMemoryExecutionLedger } from "../src/billing/ledger.js";
import { usdToMicrodollars } from "../src/billing/money.js";
import { BudgetConfig } from "../src/config.js";
import { ModelClient, ModelGateway, ProviderOutcomeUncertainError, ProviderRequestNotSentError } from "../src/model/model-gateway.js";

const config = (overrides: Partial<BudgetConfig> = {}): BudgetConfig => ({
  monthlyBudget: usdToMicrodollars("5", "test"), maxTaskCost: usdToMicrodollars("0.10", "test"),
  maxModelCallsPerTask: 6, maxConcurrentRuns: 1, autonomousRunsEnabled: false,
  modelTimeoutMs: 1_000, maxOutputTokens: 1_200, ...overrides
});

const successfulClient: ModelClient = { execute: async () => ({ outputText: "ok", usage: { inputTokens: 1_000, outputTokens: 1_000 } }) };

function setup(overrides: Partial<BudgetConfig> = {}, client: ModelClient = successfulClient) {
  const ledger = new InMemoryExecutionLedger();
  const controller = new BudgetController(config(overrides), ledger);
  return { ledger, controller, gateway: new ModelGateway(config(overrides), controller, ledger, client) };
}

const request = (overrides = {}) => ({ taskId: "task-1", model: "gpt-5.4-mini", input: "hello", maximumInputTokens: 1_000, maximumOutputTokens: 1_000, ...overrides });

test("allows a request within budget", async () => {
  const { gateway, controller } = setup();
  await gateway.execute(request());
  assert.equal(controller.report().completedRequests, 1);
});

test("rejects a request over the task budget", async () => {
  const { gateway } = setup({ maxTaskCost: usdToMicrodollars("0.001", "test") });
  await assert.rejects(gateway.execute(request()), BudgetRejectedError);
});

test("rejects a request exceeding the monthly budget", async () => {
  const { gateway } = setup({ monthlyBudget: usdToMicrodollars("0.001", "test") });
  await assert.rejects(gateway.execute(request()), BudgetRejectedError);
});

test("rejects the seventh request for a task", async () => {
  const { gateway } = setup({ maxTaskCost: usdToMicrodollars("1", "test") });
  for (let index = 0; index < 6; index += 1) await gateway.execute(request());
  await assert.rejects(gateway.execute(request()), BudgetRejectedError);
});

test("concurrent calls cannot consume the same reserved budget", async () => {
  let release: (() => void) | undefined;
  const waitingClient: ModelClient = { execute: async () => new Promise((resolve) => { release = () => resolve({ outputText: "ok", usage: { inputTokens: 1, outputTokens: 1 } }); }) };
  const { gateway } = setup({ maxConcurrentRuns: 1, maxTaskCost: usdToMicrodollars("1", "test") }, waitingClient);
  const first = gateway.execute(request());
  await assert.rejects(gateway.execute(request({ taskId: "task-2" })), BudgetRejectedError);
  release?.();
  await first;
});

test("rejects unknown model pricing", async () => {
  const { gateway } = setup();
  await assert.rejects(gateway.execute(request({ model: "unknown" })));
});

test("retains reservation for missing usage data", async () => {
  const { gateway, controller } = setup({}, { execute: async () => ({ outputText: "ok" }) });
  await assert.rejects(gateway.execute(request()), ProviderOutcomeUncertainError);
  assert.notEqual(controller.report().reservedSpending, 0n);
});

test("known failures release spending while uncertain outcomes retain it", async () => {
  const failed = setup({}, { execute: async () => { throw new ProviderRequestNotSentError("invalid request"); } });
  await assert.rejects(failed.gateway.execute(request()));
  assert.equal(failed.controller.report().reservedSpending, 0n);
  assert.equal(failed.controller.report().failedRequests, 1);

  const uncertain = setup({}, { execute: async () => { throw new Error("connection closed after dispatch"); } });
  await assert.rejects(uncertain.gateway.execute(request()));
  assert.notEqual(uncertain.controller.report().reservedSpending, 0n);
});

test("autonomous runs are disabled by default", async () => {
  const { gateway } = setup();
  await assert.rejects(gateway.execute(request({ autonomous: true })), BudgetRejectedError);
});