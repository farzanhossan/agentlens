export type ParserName = 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'mistral'

export type SpanStatus = 'success' | 'error' | 'timeout'

export interface LLMEndpoint {
  provider: string
  parser: ParserName
  paths: string[]
}

export interface ParsedSpan {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  inputText: string
  outputText: string
  isStream: boolean
  error?: string
}

export interface RawSpanPayload {
  provider: string
  parser: ParserName
  request: unknown
  response: unknown
  latency: number
  status: number
  isStream: boolean
}

export interface ErrorPayload {
  provider: string
  request: unknown
  error: string
  latency: number
}

export interface AgentLensConfig {
  apiKey: string
  /**
   * Project UUID. Required by the AgentLens ingest contract — every span
   * carries this so the server can route to the right project.
   */
  projectId: string
  endpoint?: string
  debug?: boolean
  pii?: boolean
  flushIntervalMs?: number
  maxBatchSize?: number
}

export interface TransportConfig {
  apiKey: string
  projectId: string
  endpoint: string
  flushIntervalMs?: number
  maxBatchSize?: number
  debug?: boolean
  pii?: boolean
}

/**
 * Wire-format span sent to the AgentLens ingest endpoint. Matches the
 * server-side Zod schema used by both the API controller and the
 * Cloudflare ingest worker.
 */
export interface OutboundSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  projectId: string
  /** Human-friendly span name (e.g. "openai.chat", "anthropic.messages"). */
  name: string
  model: string
  provider: string
  /** Raw LLM prompt text (PII-scrubbed if pii=true). */
  input: string
  /** Raw LLM completion text (PII-scrubbed if pii=true). */
  output: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  latencyMs: number
  status: SpanStatus
  errorMessage?: string
  metadata: Record<string, unknown>
  startedAt: string
  endedAt: string
  isStream: boolean
}
