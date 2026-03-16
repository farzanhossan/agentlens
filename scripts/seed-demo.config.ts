/**
 * Seed configuration — tweak these values to customise the demo dataset.
 */

export type AgentName =
  | 'customer-support-agent'
  | 'code-review-agent'
  | 'data-extraction-agent'
  | 'email-draft-agent';

export interface ModelWeight {
  model: string;
  provider: 'openai' | 'anthropic';
  weight: number; // cumulative probability 0–1
  inputCostPer1k: number;
  outputCostPer1k: number;
}

export interface SeedConfig {
  // ── Org / project ────────────────────────────────────────────────────────
  orgName: string;
  orgSlug: string;
  projectName: string;
  userEmail: string;
  userPassword: string;

  // ── Data volume ──────────────────────────────────────────────────────────
  traceCount: number;
  daysBack: number;

  // ── Status distribution (must sum to 1) ──────────────────────────────────
  successRate: number;
  errorRate: number;
  timeoutRate: number;

  // ── Latency (ms) ─────────────────────────────────────────────────────────
  latencyMeanMs: number;
  latencyStdDevMs: number;
  latencyMinMs: number;
  latencyMaxMs: number;

  // ── Token ranges ─────────────────────────────────────────────────────────
  inputTokensMin: number;
  inputTokensMax: number;
  outputTokensMin: number;
  outputTokensMax: number;

  // ── Model mix (weights must sum to 1) ────────────────────────────────────
  models: ModelWeight[];

  // ── Time-of-day distribution ─────────────────────────────────────────────
  peakHourStart: number; // UTC hour, inclusive
  peakHourEnd: number; // UTC hour, inclusive
  weekdayMultiplier: number; // relative volume vs weekend (1.0 = same)
}

export const seedConfig: SeedConfig = {
  orgName: 'Demo Corp',
  orgSlug: 'demo-corp',
  projectName: 'customer-support-agent',
  userEmail: 'demo@agentlens.dev',
  userPassword: 'Demo1234!',

  traceCount: 500,
  daysBack: 30,

  successRate: 0.92,
  errorRate: 0.05,
  timeoutRate: 0.03,

  latencyMeanMs: 1800,
  latencyStdDevMs: 600,
  latencyMinMs: 800,
  latencyMaxMs: 4500,

  inputTokensMin: 200,
  inputTokensMax: 2000,
  outputTokensMin: 50,
  outputTokensMax: 800,

  // Cumulative weights for model selection
  models: [
    { model: 'gpt-4o',               provider: 'openai',    weight: 0.40, inputCostPer1k: 0.005,   outputCostPer1k: 0.015  },
    { model: 'gpt-4o-mini',          provider: 'openai',    weight: 0.75, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
    { model: 'claude-3-5-sonnet',    provider: 'anthropic', weight: 0.95, inputCostPer1k: 0.003,   outputCostPer1k: 0.015  },
    { model: 'claude-3-haiku',       provider: 'anthropic', weight: 1.00, inputCostPer1k: 0.00025, outputCostPer1k: 0.00125},
  ],

  peakHourStart: 9,
  peakHourEnd: 18,
  weekdayMultiplier: 3,
};
