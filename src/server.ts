import { resolve } from "node:path";
import { ChiefOfStaff, Source, WorkflowError } from "./research/chief-of-staff.js";
import { JsonFile } from "./storage/json-file.js";
import { ModelGateway } from "./model/model-gateway.js";
import { OpenAIResponsesClient } from "./model/openai-client.js";
import { assertPricedModel } from "./billing/pricing.js";
import Fastify from "fastify";
import { BudgetController } from "./billing/budget-controller.js";
import { FileExecutionLedger } from "./billing/ledger.js";
import { microdollarsToUsd } from "./billing/money.js";
import { loadBudgetConfig } from "./config.js";

export function buildServer(controller: BudgetController, chief?: ChiefOfStaff) {
  const app = Fastify({ logger: true });
  app.get("/budget/report", async () => {
    const report = controller.report();
    return {
      estimatedUsageUsd: microdollarsToUsd(report.estimatedUsage),
      reservedSpendingUsd: microdollarsToUsd(report.reservedSpending),
      remainingBudgetUsd: microdollarsToUsd(report.remainingBudget),
      completedRequests: report.completedRequests,
      failedRequests: report.failedRequests,
      usageByModelUsd: Object.fromEntries(Object.entries(report.usageByModel).map(([model, amount]) => [model, microdollarsToUsd(amount)]))
    };
  });
  if (chief) {
    app.setErrorHandler((error, _request, reply) => {
      const status = error instanceof WorkflowError ? error.statusCode : (error as { statusCode?: number }).statusCode ?? 500;
      reply.code(status).send({ error: status < 500 ? (error as Error).message : "Internal server error." });
    });
    app.post<{ Body: { question: string; sources: Source[] } }>("/research/tasks", {
      schema: { body: { type: "object", additionalProperties: false, required: ["question", "sources"],
        properties: { question: { type: "string", minLength: 1, maxLength: 1000 }, sources: { type: "array", minItems: 1, maxItems: 5,
          items: { type: "object", additionalProperties: false, required: ["id", "title", "url", "text"],
            properties: { id: { type: "string", minLength: 1, maxLength: 100 }, title: { type: "string", minLength: 1, maxLength: 300 },
              url: { type: "string", maxLength: 2000 }, text: { type: "string", minLength: 1, maxLength: 6000 } } } } } } }
    }, async (request, reply) => reply.code(201).send(chief.create(request.body.question, request.body.sources)));
    app.get<{ Params: { id: string } }>("/research/tasks/:id", async request => chief.get(request.params.id));
    app.post<{ Params: { id: string } }>("/research/tasks/:id/approve", async request => chief.approve(request.params.id));
    app.post<{ Params: { id: string } }>("/research/tasks/:id/run", async request => chief.run(request.params.id));
    app.post<{ Params: { id: string } }>("/research/tasks/:id/cancel", async request => chief.cancel(request.params.id));
  }
  return app;
}

if (process.argv[1]?.endsWith("server.js")) {
  const config = loadBudgetConfig();
  const data = resolve(process.env.AGENT_HQ_DATA_DIR ?? "data");
  const ledger = new FileExecutionLedger(new JsonFile(resolve(data, "executions.json")));
  const controller = new BudgetController(config, ledger);
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  assertPricedModel(model);
  const client = new OpenAIResponsesClient(process.env.OPENAI_API_KEY ?? "");
  const chief = new ChiefOfStaff(new ModelGateway(config, controller, ledger, client),
    new JsonFile(resolve(data, "research.json")), model, Math.min(1200, config.maxOutputTokens));
  const app = buildServer(controller, chief);
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: "127.0.0.1" });
}