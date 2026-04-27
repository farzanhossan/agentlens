/**
 * Status of a completed span. Mirrors the PostgreSQL enum in the API schema.
 */
export type SpanStatus = 'success' | 'error' | 'timeout';

/**
 * Canonical wire-format for a single span sent to the ingest endpoint.
 *
 * NOTE: `input` and `output` carry raw LLM prompt/completion text.
 * They are forwarded to Elasticsearch by the ingest worker and are
 * intentionally absent from the PostgreSQL spans table.
 */
export interface SpanData {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  /** ID of the AgentLens project this span belongs to. */
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  /** Raw LLM prompt or tool input (stored in Elasticsearch only). */
  input?: string;
  /** Raw LLM completion or tool output (stored in Elasticsearch only). */
  output?: string;
  /** Agent name for ES aggregations. Auto-set on root spans by the tracer. */
  agentName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status: SpanStatus;
  errorMessage?: string;
  metadata: Record<string, unknown>;
  startedAt: string; // ISO-8601
  endedAt?: string; // ISO-8601
}

/**
 * Ambient context stored in AsyncLocalStorage for the duration of a trace.
 */
export interface TraceContext {
  traceId: string;
  /** The currently active (innermost) span. */
  currentSpanId: string;
}

/**
 * Configuration passed to `AgentLens.init()`.
 */
export interface AgentLensConfig {
  /** Raw API key (e.g. `proj_live_abc123`). Sent as `X-API-Key` header. */
  apiKey: string;
  /** AgentLens project ID (UUID). Attached to every span. */
  projectId: string;
  /**
   * Base URL of your AgentLens API.
   * - Cloud:       omit (defaults to https://api-agentlens.techmatbd.com)
   * - Self-hosted: set to your own API URL, e.g. "https://api.example.com"
   */
  endpoint?: string;
  /**
   * How often (ms) the buffer flushes if the batch-size limit is not hit.
   * @default 500
   */
  flushIntervalMs?: number;
  /**
   * Maximum number of spans per flush batch.
   * @default 100
   */
  maxBatchSize?: number;
  /**
   * When true, PII patterns are redacted from `input` and `output` before
   * buffering. Adds a small CPU cost on the hot path.
   * @default false
   */
  redactPII?: boolean;
}
