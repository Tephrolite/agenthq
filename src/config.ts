import { Microdollars, usdToMicrodollars } from "./billing/money.js";

export interface BudgetConfig {
  monthlyBudget: Microdollars;
  maxTaskCost: Microdollars;
  maxModelCallsPerTask: number;
  maxConcurrentRuns: number;
  autonomousRunsEnabled: boolean;
  modelTimeoutMs: number;
  maxOutputTokens: number;
}

function positiveInteger(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function loadBudgetConfig(env: NodeJS.ProcessEnv = process.env): BudgetConfig {
  const autonomousValue = required(env, "AGENT_HQ_AUTONOMOUS_RUNS_ENABLED");
  if (autonomousValue !== "true" && autonomousValue !== "false") {
    throw new Error("AGENT_HQ_AUTONOMOUS_RUNS_ENABLED must be true or false.");
  }

  const monthlyBudget = usdToMicrodollars(required(env, "AGENT_HQ_MONTHLY_BUDGET_USD"), "AGENT_HQ_MONTHLY_BUDGET_USD");
  const maxTaskCost = usdToMicrodollars(required(env, "AGENT_HQ_MAX_TASK_COST_USD"), "AGENT_HQ_MAX_TASK_COST_USD");
  if (monthlyBudget <= 0n || maxTaskCost <= 0n) {
    throw new Error("Budget amounts must be greater than zero.");
  }

  return {
    monthlyBudget,
    maxTaskCost,
    maxModelCallsPerTask: positiveInteger(env.AGENT_HQ_MAX_MODEL_CALLS_PER_TASK, "AGENT_HQ_MAX_MODEL_CALLS_PER_TASK"),
    maxConcurrentRuns: positiveInteger(env.AGENT_HQ_MAX_CONCURRENT_RUNS, "AGENT_HQ_MAX_CONCURRENT_RUNS"),
    autonomousRunsEnabled: autonomousValue === "true",
    modelTimeoutMs: positiveInteger(env.AGENT_HQ_MODEL_TIMEOUT_MS ?? "30000", "AGENT_HQ_MODEL_TIMEOUT_MS"),
    maxOutputTokens: positiveInteger(env.AGENT_HQ_MAX_OUTPUT_TOKENS ?? "1200", "AGENT_HQ_MAX_OUTPUT_TOKENS")
  };
}