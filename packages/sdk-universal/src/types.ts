export type ParserName = 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'mistral'

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
  endpoint?: string
  debug?: boolean
  pii?: boolean
  flushIntervalMs?: number
  maxBatchSize?: number
}

export interface TransportConfig {
  apiKey: string
  endpoint: string
  flushIntervalMs?: number
  maxBatchSize?: number
  debug?: boolean
  pii?: boolean
}

export interface OutboundSpan extends ParsedSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  timestamp: string
  latency: number
  status: number
}
