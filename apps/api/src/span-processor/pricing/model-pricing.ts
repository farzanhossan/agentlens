/**
 * Model pricing table for span cost calculation.
 * Prices are USD per 1,000 tokens (input / output), as of 2024-Q2.
 */

export interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

/**
 * Two-level lookup: provider → model slug → pricing.
 * Stored in lowercase for case-insensitive resolution.
 */
const PRICING_TABLE: Record<string, Record<string, ModelPricing>> = {
  openai: {
    'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
    'gpt-4o-2024-05-13': { inputPer1k: 0.005, outputPer1k: 0.015 },
    'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4o-mini-2024-07-18': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
    'gpt-4-turbo-2024-04-09': { inputPer1k: 0.01, outputPer1k: 0.03 },
    'gpt-4-turbo-preview': { inputPer1k: 0.01, outputPer1k: 0.03 },
    'gpt-4': { inputPer1k: 0.03, outputPer1k: 0.06 },
    'gpt-4-32k': { inputPer1k: 0.06, outputPer1k: 0.12 },
    'gpt-3.5-turbo': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
    'gpt-3.5-turbo-0125': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
    'gpt-3.5-turbo-instruct': { inputPer1k: 0.0015, outputPer1k: 0.002 },
  },
  anthropic: {
    'claude-3-5-sonnet-20240620': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-opus-20240229': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-3-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-3-sonnet-20240229': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-haiku-20240307': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
    'claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  },
  // Ollama models run locally — zero API cost
  ollama: {
    '*': { inputPer1k: 0, outputPer1k: 0 },
  },
};

/**
 * Returns pricing for a given provider + model, or `undefined` if unknown.
 *
 * Resolution order:
 * 1. Exact match on `provider` + `model` (case-insensitive).
 * 2. Versioned suffix stripped (e.g. `gpt-4o-2024-99-99` → `gpt-4o`).
 * 3. Wildcard `*` entry in the provider table (used for Ollama).
 */
export function getPricing(
  provider: string,
  model: string,
): ModelPricing | undefined {
  const providerKey = provider.toLowerCase();
  const modelKey = model.toLowerCase();
  const providerTable = PRICING_TABLE[providerKey];
  if (!providerTable) return undefined;

  // Exact match
  if (providerTable[modelKey]) return providerTable[modelKey];

  // Strip date suffix: -YYYY-MM-DD
  const stripped = modelKey.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (providerTable[stripped]) return providerTable[stripped];

  // Wildcard
  return providerTable['*'];
}

/**
 * Computes the USD cost for a single API call.
 *
 * @returns Cost in USD, or `undefined` if the model is not in the pricing table.
 */
export function computeCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = getPricing(provider, model);
  if (!pricing) return undefined;
  return (inputTokens / 1_000) * pricing.inputPer1k +
    (outputTokens / 1_000) * pricing.outputPer1k;
}
