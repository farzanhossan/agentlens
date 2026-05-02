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
    initialized = true

    transport = new Transport({
      apiKey: config.apiKey,
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

  trace<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return fn()
  },
}

export type { AgentLensConfig, ParsedSpan, OutboundSpan } from './types'
export { matchLLM, LLM_REGISTRY } from './registry'
export { scrubPII, scrubObject } from './pii/scrubber'
