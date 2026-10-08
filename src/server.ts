import Fastify from "fastify";
import { BudgetController } from "./billing/budget-controller.js";
import { InMemoryExecutionLedger } from "./billing/ledger.js";
import { microdollarsToUsd } from "./billing/money.js";
import { loadBudgetConfig } from "./config.js";

export function buildServer(controller: BudgetController) {
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
  return app;
}

if (process.argv[1]?.endsWith("server.js")) {
  const config = loadBudgetConfig();
  const controller = new BudgetController(config, new InMemoryExecutionLedger());
  const app = buildServer(controller);
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: "127.0.0.1" });
}