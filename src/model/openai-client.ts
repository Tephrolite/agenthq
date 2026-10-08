import OpenAI from "openai";
import { ModelClient, ModelResponse, ProviderRequestNotSentError } from "./model-gateway.js";

/**
 * Production adapter used only by ModelGateway. It deliberately exposes no
 * retries, tools, handoffs, or autonomous agent capabilities.
 */
export class OpenAIResponsesClient implements ModelClient {
  private readonly client: OpenAI;

  public constructor(apiKey: string) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for live execution.");
    this.client = new OpenAI({ apiKey, maxRetries: 0 });
  }

  async execute(request: { model: string; input: string; maxOutputTokens: number; signal: AbortSignal; responseSchema?: Record<string, unknown> }): Promise<ModelResponse> {
    try {
      const response = await this.client.responses.create({
        model: request.model,
        input: request.input,
        store: false,
        text: request.responseSchema ? { format: { type: "json_schema", name: "research_brief", strict: true, schema: request.responseSchema } } : undefined,
        max_output_tokens: request.maxOutputTokens
      }, { signal: request.signal });
      return {
        outputText: response.output_text,
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
          // OpenAI includes reasoning tokens in output_tokens; retain that total for billing.
          outputTokens: response.usage.output_tokens
        } : undefined
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError && error.status !== undefined && error.status < 500) {
        throw new ProviderRequestNotSentError(error.message);
      }
      throw error;
    }
  }
}