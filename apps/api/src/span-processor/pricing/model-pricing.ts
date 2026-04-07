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
    // GPT-4o family
    'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
    'gpt-4o-2024-05-13': { inputPer1k: 0.005, outputPer1k: 0.015 },
    'gpt-4o-2024-08-06': { inputPer1k: 0.0025, outputPer1k: 0.01 },
    'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4o-mini-2024-07-18': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    // GPT-4.1 family
    'gpt-4.1': { inputPer1k: 0.002, outputPer1k: 0.008 },
    'gpt-4.1-mini': { inputPer1k: 0.0004, outputPer1k: 0.0016 },
    'gpt-4.1-nano': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
    // o-series reasoning models
    'o1': { inputPer1k: 0.015, outputPer1k: 0.06 },
    'o1-mini': { inputPer1k: 0.003, outputPer1k: 0.012 },
    'o1-preview': { inputPer1k: 0.015, outputPer1k: 0.06 },
    'o3': { inputPer1k: 0.01, outputPer1k: 0.04 },
    'o3-mini': { inputPer1k: 0.0011, outputPer1k: 0.0044 },
    'o4-mini': { inputPer1k: 0.0011, outputPer1k: 0.0044 },
    // Legacy GPT-4
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
    // Claude 4 family
    'claude-opus-4-6': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-sonnet-4-6': { inputPer1k: 0.003, outputPer1k: 0.015 },
    // Claude 3.5 family
    'claude-3-5-sonnet-20241022': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-5-sonnet-20240620': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-5-haiku': { inputPer1k: 0.0008, outputPer1k: 0.004 },
    // Claude 3 family
    'claude-3-opus-20240229': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-3-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-3-sonnet-20240229': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-haiku-20240307': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
    'claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  },
  google: {
    'gemini-2.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.01 },
    'gemini-2.5-flash': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gemini-2.0-flash': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
    'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
    'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
    'gemini-1.0-pro': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  },
  mistral: {
    'mistral-large-latest': { inputPer1k: 0.002, outputPer1k: 0.006 },
    'mistral-large': { inputPer1k: 0.002, outputPer1k: 0.006 },
    'mistral-medium-latest': { inputPer1k: 0.0027, outputPer1k: 0.0081 },
    'mistral-small-latest': { inputPer1k: 0.0002, outputPer1k: 0.0006 },
    'mistral-small': { inputPer1k: 0.0002, outputPer1k: 0.0006 },
    'codestral': { inputPer1k: 0.0003, outputPer1k: 0.0009 },
    'open-mixtral-8x22b': { inputPer1k: 0.002, outputPer1k: 0.006 },
    'open-mixtral-8x7b': { inputPer1k: 0.0007, outputPer1k: 0.0007 },
    'open-mistral-7b': { inputPer1k: 0.00025, outputPer1k: 0.00025 },
  },
  cohere: {
    'command-r-plus': { inputPer1k: 0.002_5, outputPer1k: 0.01 },
    'command-r': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'command': { inputPer1k: 0.001, outputPer1k: 0.002 },
    'command-light': { inputPer1k: 0.0003, outputPer1k: 0.0006 },
  },
  deepseek: {
    'deepseek-chat': { inputPer1k: 0.00014, outputPer1k: 0.00028 },
    'deepseek-reasoner': { inputPer1k: 0.00055, outputPer1k: 0.00219 },
    'deepseek-coder': { inputPer1k: 0.00014, outputPer1k: 0.00028 },
  },
  // Ollama models run locally — zero API cost
  ollama: {
    '*': { inputPer1k: 0, outputPer1k: 0 },
  },
  // Local/self-hosted models — zero API cost
  local: {
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
