/**
 * Matches @farzanhossans/agentlens-core SpanData — the canonical wire format sent by SDKs.
 */
export interface SpanPayload {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  /** AgentLens project ID (UUID). */
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  /** Raw LLM prompt or tool input — forwarded to Elasticsearch, not PostgreSQL. */
  input?: string;
  /** Raw LLM completion or tool output — forwarded to Elasticsearch, not PostgreSQL. */
  output?: string;
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
 * Cloudflare Worker environment bindings.
 * Declared in wrangler.toml and injected at runtime.
 */
export interface Env {
  /** NestJS API base URL — spans are forwarded here directly. */
  API_URL: string;
  /**
   * Shared HMAC-SHA256 secret used to verify API keys at the edge.
   * Set via `wrangler secret put HMAC_SECRET`.
   */
  HMAC_SECRET: string;
  /**
   * Shared secret between CF Worker and NestJS API.
   * Worker sends this in X-Worker-Secret; API validates it.
   * Set via `wrangler secret put WORKER_SECRET`.
   */
  WORKER_SECRET: string;
  ENVIRONMENT: string;
}

/**
 * Values set on the Hono context by successful middleware.
 * Use `c.get('projectId')` inside route handlers.
 */
export interface ContextVars {
  projectId: string;
}
