/**
 * Raw span data as it arrives in the BullMQ job payload from the ingest worker.
 * Field names mirror @farzanhossans/agentlens-core SpanData and the CF Worker SpanPayload.
 */
export interface RawSpanData {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  /** LLM prompt text — stored only in Elasticsearch, never in PostgreSQL. */
  input?: string;
  /** LLM completion text — stored only in Elasticsearch, never in PostgreSQL. */
  output?: string;
  /** Agent name sent by SDKs/proxy for ES aggregations. */
  agentName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  metadata: Record<string, unknown>;
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 */
  endedAt?: string;
}

/**
 * Fully validated, PII-scrubbed, and cost-enriched span ready for persistence.
 */
export interface ProcessedSpan extends RawSpanData {
  /** Computed by model-pricing.ts; undefined if model is unknown. */
  costUsd: number | undefined;
  /** Denormalized from the parent trace for ES agent-level aggregations. */
  agentName?: string;
}

/** Shape of a BullMQ job pushed by the ingest worker. */
export interface SpanJobData {
  span: RawSpanData;
  projectId: string;
}
