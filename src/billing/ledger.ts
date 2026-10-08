import { Microdollars } from "./money.js";

export type ExecutionStatus = "reserved" | "completed" | "failed" | "uncertain" | "rejected";

export interface ExecutionRecord {
  id: string;
  taskId: string;
  model: string;
  status: ExecutionStatus;
  reservedCost: Microdollars;
  reportedCost?: Microdollars;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  rejectionReason?: string;
}

export interface ExecutionLedger {
  list(): readonly ExecutionRecord[];
  reserve(record: ExecutionRecord): void;
  complete(id: string, details: Pick<ExecutionRecord, "reportedCost" | "inputTokens" | "cachedInputTokens" | "outputTokens">): void;
  fail(id: string, error: string): void;
  markUncertain(id: string, error: string): void;
  reject(record: ExecutionRecord): void;
}

/** Development implementation. Replace with a transaction-backed PostgreSQL ledger in production. */
export class InMemoryExecutionLedger implements ExecutionLedger {
  private readonly records: ExecutionRecord[] = [];

  list(): readonly ExecutionRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  reserve(record: ExecutionRecord): void {
    this.records.push({ ...record });
  }

  complete(id: string, details: Pick<ExecutionRecord, "reportedCost" | "inputTokens" | "cachedInputTokens" | "outputTokens">): void {
    this.update(id, { status: "completed", completedAt: new Date(), ...details });
  }

  fail(id: string, error: string): void {
    this.update(id, { status: "failed", completedAt: new Date(), error });
  }

  markUncertain(id: string, error: string): void {
    this.update(id, { status: "uncertain", completedAt: new Date(), error });
  }

  reject(record: ExecutionRecord): void {
    this.records.push({ ...record });
  }

  private update(id: string, change: Partial<ExecutionRecord>): void {
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) throw new Error(`Unknown execution ${id}.`);
    this.records[index] = { ...this.records[index], ...change };
  }
}