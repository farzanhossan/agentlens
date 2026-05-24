import { randomUUID } from 'crypto'
import { getCurrentSpanId, getCurrentTraceId } from '@farzanhossans/agentlens-core'
import { parseSpan } from './parsers'
import { scrubPII } from './pii/scrubber'
import type {
  ErrorPayload,
  OutboundSpan,
  ParsedSpan,
  RawSpanPayload,
  SpanStatus,
  TransportConfig,
} from './types'

const DEFAULT_FLUSH_INTERVAL_MS = 500
const DEFAULT_MAX_BATCH_SIZE = 50
const MAX_RETRIES = 3

export class Transport {
  private readonly config: Required<TransportConfig>
  private queue: OutboundSpan[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing = false
  private exitHandlerRegistered = false

  constructor(config: TransportConfig) {
    this.config = {
      apiKey: config.apiKey,
      projectId: config.projectId,
      endpoint: config.endpoint,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      debug: config.debug ?? false,
      pii: config.pii ?? true,
    }
    this.startTimer()
    this.registerExitHandler()
  }

  push(payload: RawSpanPayload): void {
    const startedAt = new Date(Date.now() - payload.latency).toISOString()
    const endedAt = new Date().toISOString()
    let parsed: ParsedSpan
    try {
      parsed = parseSpan({
        parser: payload.parser,
        request: (payload.request ?? null) as Record<string, unknown> | null,
        response: (payload.response ?? null) as Record<string, unknown> | null,
        isStream: payload.isStream,
      })
    } catch (err) {
      if (this.config.debug) {
        // eslint-disable-next-line no-console
        console.warn('[agentlens] parser failed', err)
      }
      return
    }

    const outbound = this.toOutbound(parsed, payload, startedAt, endedAt)
    this.enqueue(outbound)
  }

  pushError(payload: ErrorPayload): void {
    const ids = this.resolveIds()
    const startedAt = new Date(Date.now() - payload.latency).toISOString()
    const endedAt = new Date().toISOString()
    const span: OutboundSpan = {
      spanId: ids.spanId,
      traceId: ids.traceId,
      parentSpanId: ids.parentSpanId,
      projectId: this.config.projectId,
      name: `${payload.provider}.error`,
      model: 'unknown',
      provider: payload.provider,
      input: this.scrub(this.stringifyRequest(payload.request)),
      output: '',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMs: payload.latency,
      status: 'error',
      errorMessage: payload.error,
      metadata: { httpStatus: 0 },
      startedAt,
      endedAt,
      isStream: false,
    }
    this.enqueue(span)
  }

  async flush(): Promise<void> {
    if (this.flushing) return
    if (this.queue.length === 0) return

    this.flushing = true
    const batch = this.queue.splice(0, this.queue.length)

    try {
      await this.send(batch)
    } catch {
      // silent — never crash
    } finally {
      this.flushing = false
    }
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private toOutbound(
    parsed: ParsedSpan,
    payload: RawSpanPayload,
    startedAt: string,
    endedAt: string,
  ): OutboundSpan {
    const ids = this.resolveIds()
    const status: SpanStatus = payload.status >= 200 && payload.status < 400 ? 'success' : 'error'
    return {
      spanId: ids.spanId,
      traceId: ids.traceId,
      parentSpanId: ids.parentSpanId,
      projectId: this.config.projectId,
      name: spanNameFor(payload),
      model: parsed.model,
      provider: parsed.provider,
      input: this.scrub(parsed.inputText),
      output: this.scrub(parsed.outputText),
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      totalTokens: parsed.totalTokens,
      costUsd: parsed.costUsd,
      latencyMs: payload.latency,
      status,
      errorMessage: parsed.error,
      metadata: { httpStatus: payload.status },
      startedAt,
      endedAt,
      isStream: parsed.isStream,
    }
  }

  /**
   * Resolves the trace-context IDs to stamp on an outbound span.
   *
   * - `spanId` is always fresh per LLM call (the call IS the leaf span).
   * - `traceId` reuses the surrounding `trace()` block's traceId if any,
   *   else a new one (the standalone LLM call is its own single-span trace).
   * - `parentSpanId` is the surrounding trace's currentSpanId, or undefined
   *   when there is no enclosing `trace()`.
   *
   * AsyncLocalStorage propagates through the patched fetch's promise chain,
   * so this still resolves correctly for streamed spans emitted from the
   * background `captureSSEStream()` reader.
   */
  private resolveIds(): { spanId: string; traceId: string; parentSpanId?: string } {
    return {
      spanId: randomUUID(),
      traceId: getCurrentTraceId() ?? randomUUID(),
      parentSpanId: getCurrentSpanId(),
    }
  }

  private scrub(text: string): string {
    if (!this.config.pii) return text
    return scrubPII(text)
  }

  private stringifyRequest(request: unknown): string {
    if (request == null) return ''
    if (typeof request === 'string') return request
    try {
      return JSON.stringify(request)
    } catch {
      return ''
    }
  }

  private enqueue(span: OutboundSpan): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[agentlens] span', {
        name: span.name,
        model: span.model,
        provider: span.provider,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        costUsd: span.costUsd,
        latencyMs: span.latencyMs,
        isStream: span.isStream,
      })
    }
    this.queue.push(span)
    if (this.queue.length >= this.config.maxBatchSize) {
      void this.flush()
    }
  }

  private startTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.flush()
    }, this.config.flushIntervalMs)
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      ;(this.timer as { unref: () => void }).unref()
    }
  }

  private registerExitHandler(): void {
    if (this.exitHandlerRegistered) return
    if (typeof process === 'undefined' || typeof process.on !== 'function') return
    this.exitHandlerRegistered = true
    process.on('beforeExit', () => {
      void this.flush()
    })
  }

  private async send(batch: OutboundSpan[]): Promise<void> {
    const body = JSON.stringify({ spans: batch })
    let attempt = 0
    let delay = 100

    while (attempt < MAX_RETRIES) {
      try {
        const res = await this.doFetch(body)
        if (res.ok) return
        if (res.status >= 400 && res.status < 500) {
          if (this.config.debug) {
            // eslint-disable-next-line no-console
            console.warn('[agentlens] flush rejected', res.status)
          }
          return
        }
      } catch {
        // network error — retry
      }
      attempt++
      if (attempt < MAX_RETRIES) {
        await sleep(delay)
        delay *= 2
      }
    }
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.warn('[agentlens] flush gave up after', MAX_RETRIES, 'attempts')
    }
  }

  private async doFetch(body: string): Promise<{ ok: boolean; status: number }> {
    const f =
      (globalThis as { __agentlens_originalFetch?: typeof fetch }).__agentlens_originalFetch ??
      globalThis.fetch
    if (!f) {
      throw new Error('fetch unavailable')
    }
    const res = await f(this.config.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Hosted ingest expects X-API-Key. Send Authorization too for any
        // gateways that may sit in front (some Cloudflare workers want it).
        'x-api-key': this.config.apiKey,
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body,
    })
    return { ok: res.ok, status: res.status }
  }
}

function spanNameFor(payload: RawSpanPayload): string {
  const req = payload.request as Record<string, unknown> | null
  // Detect endpoint kind from the request shape, no URL parsing needed.
  if (req && Array.isArray(req.messages)) return `${payload.provider}.chat`
  if (req && (typeof req.prompt === 'string' || typeof req.input === 'string')) {
    return `${payload.provider}.completion`
  }
  if (req && (req.input !== undefined || req.contents !== undefined)) {
    return `${payload.provider}.embedding`
  }
  return `${payload.provider}.call`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
