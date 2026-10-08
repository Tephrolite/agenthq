import { BudgetController } from "../billing/budget-controller.js";
import { ExecutionLedger } from "../billing/ledger.js";
import { calculateModelCost, estimateModelCost, assertPricedModel, TokenUsage } from "../billing/pricing.js";
import { BudgetConfig } from "../config.js";

export interface ModelRequest {
  taskId: string;
  model: string;
  input: string;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  autonomous?: boolean;
  responseSchema?: Record<string, unknown>;
}

export interface ModelResponse {
  outputText: string;
  usage?: TokenUsage;
}

export interface ModelClient {
  execute(request: { model: string; input: string; maxOutputTokens: number; signal: AbortSignal; responseSchema?: Record<string, unknown> }): Promise<ModelResponse>;
}

export class ProviderOutcomeUncertainError extends Error {}
export class ProviderRequestNotSentError extends Error {}

/** The sole authorized boundary for model execution. Inject a client; do not instantiate clients elsewhere. */
export class ModelGateway {
  public constructor(
    private readonly config: BudgetConfig,
    private readonly controller: BudgetController,
    private readonly ledger: ExecutionLedger,
    private readonly client: ModelClient
  ) {}

  async execute(request: ModelRequest): Promise<ModelResponse> {
    assertPricedModel(request.model);
    if (!Number.isSafeInteger(request.maximumInputTokens) || request.maximumInputTokens < 1) {
      throw new Error("maximumInputTokens must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(request.maximumOutputTokens) || request.maximumOutputTokens < 1 || request.maximumOutputTokens > this.config.maxOutputTokens) {
      throw new Error(`maximumOutputTokens must be between 1 and ${this.config.maxOutputTokens}.`);
    }

    if (Buffer.byteLength(request.input, "utf8") + (request.responseSchema ? Buffer.byteLength(JSON.stringify(request.responseSchema), "utf8") : 0) + 256 > request.maximumInputTokens) {
      throw new Error("Input exceeds the conservative UTF-8 byte token bound plus framing allowance.");
    }

    const estimatedCost = estimateModelCost(request.model, request.maximumInputTokens, request.maximumOutputTokens);
    const execution = this.controller.reserve(request.taskId, request.model, estimatedCost, request.autonomous ?? false);
    const signal = AbortSignal.timeout(this.config.modelTimeoutMs);
    try {
      const response = await this.client.execute({
        model: request.model,
        input: request.input,
        maxOutputTokens: request.maximumOutputTokens,
        signal,
        responseSchema: request.responseSchema
      });
      if (!response.usage) {
        this.ledger.markUncertain(execution.id, "Provider returned no usage data; reservation retained.");
        throw new ProviderOutcomeUncertainError("Provider returned no usage data; execution reservation is retained.");
      }
      this.ledger.complete(execution.id, {
        reportedCost: calculateModelCost(request.model, response.usage),
        inputTokens: response.usage.inputTokens,
        cachedInputTokens: response.usage.cachedInputTokens,
        outputTokens: response.usage.outputTokens
      });
      return response;
    } catch (error) {
      if (error instanceof ProviderOutcomeUncertainError) throw error;
      if (error instanceof ProviderRequestNotSentError) {
        this.ledger.fail(execution.id, error instanceof Error ? error.message : "Model request failed.");
      } else {
        // The request may have reached OpenAI, including after a timeout; preserve its reservation.
        this.ledger.markUncertain(execution.id, error instanceof Error ? error.message : "Unknown provider outcome.");
      }
      throw error;
    }
  }
}