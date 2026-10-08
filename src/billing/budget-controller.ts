import { randomUUID } from "node:crypto";
import { BudgetConfig } from "../config.js";
import { ExecutionLedger, ExecutionRecord } from "./ledger.js";
import { Microdollars } from "./money.js";

export class BudgetRejectedError extends Error {}

export interface BudgetReport {
  estimatedUsage: Microdollars;
  reservedSpending: Microdollars;
  remainingBudget: Microdollars;
  completedRequests: number;
  failedRequests: number;
  usageByModel: Record<string, Microdollars>;
}

export class BudgetController {
  public constructor(private readonly config: BudgetConfig, private readonly ledger: ExecutionLedger) {}

  reserve(taskId: string, model: string, estimatedCost: Microdollars, autonomous: boolean): ExecutionRecord {
    const execution: ExecutionRecord = {
      id: randomUUID(), taskId, model, status: "rejected", reservedCost: 0n, startedAt: new Date()
    };
    try {
      if (autonomous && !this.config.autonomousRunsEnabled) throw new BudgetRejectedError("Autonomous runs are disabled.");
      const records = this.ledger.list();
      const taskAttempts = records.filter((record) => record.taskId === taskId && record.status !== "rejected").length;
      if (taskAttempts >= this.config.maxModelCallsPerTask) throw new BudgetRejectedError("Task model-call limit reached.");
      const taskCommitment = total(records.filter((record) => record.taskId === taskId), "task");
      if (taskCommitment + estimatedCost > this.config.maxTaskCost) throw new BudgetRejectedError("Task budget would be exceeded.");
      const report = this.report();
      if (report.estimatedUsage + report.reservedSpending + estimatedCost > this.config.monthlyBudget) {
        throw new BudgetRejectedError("Monthly application budget would be exceeded.");
      }
      const activeRuns = records.filter((record) => record.status === "reserved").length;
      if (activeRuns >= this.config.maxConcurrentRuns) throw new BudgetRejectedError("Global concurrent-run limit reached.");
      execution.status = "reserved";
      execution.reservedCost = estimatedCost;
      this.ledger.reserve(execution);
      return execution;
    } catch (error) {
      execution.rejectionReason = error instanceof Error ? error.message : "Budget authorization failed.";
      this.ledger.reject(execution);
      throw error;
    }
  }

  report(): BudgetReport {
    const month = new Date().toISOString().slice(0, 7);
    const records = this.ledger.list().filter(record => record.startedAt.toISOString().slice(0, 7) === month || record.status === "uncertain" || record.status === "reserved");
    const completed = records.filter((record) => record.status === "completed");
    const estimatedUsage = completed.reduce((sum, record) => sum + (record.reportedCost ?? record.reservedCost), 0n);
    const reservedSpending = records.filter((record) => record.status === "reserved" || record.status === "uncertain")
      .reduce((sum, record) => sum + record.reservedCost, 0n);
    const usageByModel: Record<string, Microdollars> = {};
    for (const record of completed) {
      usageByModel[record.model] = (usageByModel[record.model] ?? 0n) + (record.reportedCost ?? record.reservedCost);
    }
    return {
      estimatedUsage,
      reservedSpending,
      remainingBudget: this.config.monthlyBudget - estimatedUsage - reservedSpending,
      completedRequests: completed.length,
      failedRequests: records.filter((record) => record.status === "failed").length,
      usageByModel
    };
  }
}

function total(records: readonly ExecutionRecord[], scope: "task"): Microdollars {
  void scope;
  return records.filter((record) => record.status === "completed" || record.status === "reserved" || record.status === "uncertain")
    .reduce((sum, record) => sum + (record.status === "completed" ? (record.reportedCost ?? record.reservedCost) : record.reservedCost), 0n);
}