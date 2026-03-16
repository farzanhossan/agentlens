/**
 * @farzanhossans/agentlens-openai
 *
 * Importing this module automatically patches the OpenAI SDK so every
 * `chat.completions.create`, `completions.create`, and `embeddings.create`
 * call is traced via AgentLens.
 *
 * @example
 * ```ts
 * // Add this import ONCE in your app entry point, after AgentLens.init():
 * import '@farzanhossans/agentlens-openai';
 * ```
 *
 * No other code changes are needed.
 */

import { patch } from './patcher.js';

// Auto-apply on import
patch();

export { unpatch } from './patcher.js';
export { calculateCost, getPricingTable } from './pricing.js';
