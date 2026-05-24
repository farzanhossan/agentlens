import { randomUUID } from 'crypto'
import { getCurrentTraceId, runWithTrace } from '@farzanhossans/agentlens-core'
import { patchFetch } from './interceptors/fetch'
import { patchHttps } from './interceptors/https'
import { Transport } from './transport'
import type { AgentLensConfig } from './types'

const DEFAULT_ENDPOINT = 'https://ingest.agentlens.dev/v1/spans'

let initialized = false
let transport: Transport | null = null

export const AgentLens = {
  init(config: AgentLensConfig): void {
    if (initialized) return
    if (!config?.apiKey) {
      throw new Error('AgentLens.init requires an apiKey')
    }
    if (!config?.projectId) {
      throw new Error('AgentLens.init requires a projectId')
    }
    initialized = true

    transport = new Transport({
      apiKey: config.apiKey,
      projectId: config.projectId,
      endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
      debug: config.debug ?? false,
      pii: config.pii ?? true,
      flushIntervalMs: config.flushIntervalMs,
      maxBatchSize: config.maxBatchSize,
    })

    patchFetch(transport)
    patchHttps(transport)
  },

  async flush(): Promise<void> {
    if (!transport) return
    await transport.flush()
  },

  shutdown(): void {
    if (!transport) return
    transport.shutdown()
    transport = null
    initialized = false
  },

  /**
   * Wraps `fn` in a named trace context. Any LLM calls made inside `fn`
   * (including async ones) are auto-tagged with this trace's `traceId` and
   * get `parentSpanId` set to this trace's `spanId`. Nested `trace()` calls
   * become child spans automatically.
   *
   * Use this to group multiple LLM calls that belong to the same agent run.
   */
  trace<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    const spanId = randomUUID()
    const traceId = getCurrentTraceId() ?? randomUUID()
    return runWithTrace({ traceId, currentSpanId: spanId }, fn)
  },
}

export type { AgentLensConfig, ParsedSpan, OutboundSpan } from './types'
export { matchLLM, LLM_REGISTRY } from './registry'
export { scrubPII, scrubObject } from './pii/scrubber'
export {
  getCurrentTrace,
  getCurrentTraceId,
  getCurrentSpanId,
  runWithTrace,
} from '@farzanhossans/agentlens-core'
