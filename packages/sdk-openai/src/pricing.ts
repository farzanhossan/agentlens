/**
 * Token cost table and calculator for OpenAI models.
 * Prices are in USD per 1,000 tokens as of 2024-Q2.
 * Update this map when OpenAI revises pricing.
 */

interface ModelPricing {
  /** USD cost per 1,000 input (prompt) tokens. */
  inputCostPer1k: number;
  /** USD cost per 1,000 output (completion) tokens. */
  outputCostPer1k: number;
}

const PRICING: Record<string, ModelPricing> = {
  // GPT-4o
  'gpt-4o': { inputCostPer1k: 0.005, outputCostPer1k: 0.015 },
  'gpt-4o-2024-05-13': { inputCostPer1k: 0.005, outputCostPer1k: 0.015 },
  // GPT-4o mini
  'gpt-4o-mini': { inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  'gpt-4o-mini-2024-07-18': { inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  // GPT-4 Turbo
  'gpt-4-turbo': { inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
  'gpt-4-turbo-2024-04-09': { inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
  'gpt-4-turbo-preview': { inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
  // GPT-4
  'gpt-4': { inputCostPer1k: 0.03, outputCostPer1k: 0.06 },
  'gpt-4-0613': { inputCostPer1k: 0.03, outputCostPer1k: 0.06 },
  'gpt-4-32k': { inputCostPer1k: 0.06, outputCostPer1k: 0.12 },
  // GPT-3.5 Turbo
  'gpt-3.5-turbo': { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
  'gpt-3.5-turbo-0125': { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
  'gpt-3.5-turbo-instruct': { inputCostPer1k: 0.0015, outputCostPer1k: 0.002 },
  // Embeddings
  'text-embedding-3-small': { inputCostPer1k: 0.00002, outputCostPer1k: 0 },
  'text-embedding-3-large': { inputCostPer1k: 0.00013, outputCostPer1k: 0 },
  'text-embedding-ada-002': { inputCostPer1k: 0.0001, outputCostPer1k: 0 },
};

/**
 * Calculates the USD cost for an OpenAI API call.
 *
 * @param model   - The model name as returned by the API (e.g. `'gpt-4o'`).
 * @param inputTokens  - Number of prompt / input tokens consumed.
 * @param outputTokens - Number of completion / output tokens generated.
 * @returns Total cost in USD, or `undefined` if the model is not in the
 *          pricing table.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  // Normalise versioned model names to their base counterpart when not found
  const pricing = PRICING[model] ?? PRICING[normalise(model)];
  if (!pricing) return undefined;

  return (
    (inputTokens / 1_000) * pricing.inputCostPer1k +
    (outputTokens / 1_000) * pricing.outputCostPer1k
  );
}

/**
 * Strips date suffixes (e.g. `-2024-05-13`) to find a base entry.
 * e.g. `gpt-4o-2024-99-99` → `gpt-4o`
 */
function normalise(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/** Returns the full pricing map (read-only). Useful for dashboards. */
export function getPricingTable(): Readonly<Record<string, ModelPricing>> {
  return PRICING;
}
