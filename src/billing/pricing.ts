import { Microdollars } from "./money.js";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}

interface ModelPricing {
  inputMicrodollarsPerMillionTokens: bigint;
  cachedInputMicrodollarsPerMillionTokens: bigint;
  outputMicrodollarsPerMillionTokens: bigint;
}

const PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-5.4-mini": {
    inputMicrodollarsPerMillionTokens: 750_000n,
    cachedInputMicrodollarsPerMillionTokens: 75_000n,
    outputMicrodollarsPerMillionTokens: 4_500_000n
  }
};

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function costForTokens(tokens: number, rate: bigint): Microdollars {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new Error("Token counts must be non-negative safe integers.");
  }
  return ceilDivide(BigInt(tokens) * rate, 1_000_000n);
}

export function assertPricedModel(model: string): void {
  if (!PRICING[model]) {
    throw new Error(`Model ${model} has no configured pricing.`);
  }
}

export function calculateModelCost(model: string, usage: TokenUsage): Microdollars {
  assertPricedModel(model);
  const pricing = PRICING[model];
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  if (cachedInputTokens > usage.inputTokens) {
    throw new Error("Cached input tokens cannot exceed input tokens.");
  }

  return costForTokens(usage.inputTokens - cachedInputTokens, pricing.inputMicrodollarsPerMillionTokens)
    + costForTokens(cachedInputTokens, pricing.cachedInputMicrodollarsPerMillionTokens)
    + costForTokens(usage.outputTokens, pricing.outputMicrodollarsPerMillionTokens);
}

export function estimateModelCost(model: string, maximumInputTokens: number, maximumOutputTokens: number): Microdollars {
  // Cache usage is unknown before execution, so price all input at the higher uncached rate.
  return calculateModelCost(model, { inputTokens: maximumInputTokens, outputTokens: maximumOutputTokens });
}