import { randomUUID } from 'crypto'
import { getCurrentSpanId, getCurrentTraceId } from '@farzanhossans/agentlens-core'
import { parseSpan } from './parsers'
import { scrubPII } from './pii/scrubber'
import type {
  ErrorPayload,
  OutboundSpan,
  ParsedSpan,
  RawSpanPayload,
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

    const outbound = this.toOutbound(parsed, payload.latency, payload.status)
    this.enqueue(outbound)
  }

  pushError(payload: ErrorPayload): void {
    const ids = this.resolveIds()
    const span: OutboundSpan = {
      spanId: ids.spanId,
      traceId: ids.traceId,
      parentSpanId: ids.parentSpanId,
      model: 'unknown',
      provider: payload.provider,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      inputText: this.scrub(this.stringifyRequest(payload.request)),
      outputText: '',
      isStream: false,
      error: payload.error,
      latency: payload.latency,
      status: 0,
      timestamp: new Date().toISOString(),
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

  private toOutbound(parsed: ParsedSpan, latency: number, status: number): OutboundSpan {
    const ids = this.resolveIds()
    return {
      ...parsed,
      spanId: ids.spanId,
      traceId: ids.traceId,
      parentSpanId: ids.parentSpanId,
      inputText: this.scrub(parsed.inputText),
      outputText: this.scrub(parsed.outputText),
      latency,
      status,
      timestamp: new Date().toISOString(),
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
        model: span.model,
        provider: span.provider,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        costUsd: span.costUsd,
        latency: span.latency,
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
    // Don't keep the Node event loop alive on this interval alone
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
        // 4xx — don't retry, drop
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
    // Use the ORIGINAL fetch, not a patched one. The interceptor stores the
    // original on globalThis under a private key so we don't intercept ourselves.
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
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body,
    })
    return { ok: res.ok, status: res.status }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
