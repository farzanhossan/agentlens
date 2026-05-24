import { matchLLM } from '../registry'
import { captureSSEStream } from '../streaming/sse'
import type { Transport } from '../transport'

interface PatchedFlag {
  __agentlens_patched?: boolean
}

export function patchFetch(transport: Transport): void {
  const original = globalThis.fetch
  if (!original) return

  // Avoid double-patching
  if ((original as unknown as PatchedFlag).__agentlens_patched) return

  // Stash the original so the transport can use it without recursing through us
  ;(globalThis as { __agentlens_originalFetch?: typeof fetch }).__agentlens_originalFetch = original

  const patched: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    const llm = matchLLM(url)
    if (!llm) return original(input, init)

    const start = Date.now()
    let requestBody: Record<string, unknown> | null = null

    const rawBody = init?.body ?? null
    if (typeof rawBody === 'string') {
      try {
        requestBody = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        requestBody = null
      }
    } else if (rawBody && rawBody instanceof ArrayBuffer) {
      try {
        const text = new TextDecoder().decode(rawBody)
        requestBody = JSON.parse(text) as Record<string, unknown>
      } catch {
        requestBody = null
      }
    }

    const isStream = requestBody?.stream === true

    try {
      const response = await original(input, init)
      const latency = Date.now() - start

      if (isStream && response.body) {
        const [userStream, ourStream] = response.body.tee()
        // fire-and-forget background read
        void captureSSEStream(ourStream, {
          llm,
          requestBody,
          latency,
          transport,
        })
        return new Response(userStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }

      const clone = response.clone()
      const responseBody = (await clone.json().catch(() => null)) as Record<string, unknown> | null
      if (responseBody) {
        transport.push({
          provider: llm.provider,
          parser: llm.parser,
          request: requestBody,
          response: responseBody,
          latency,
          status: response.status,
          isStream: false,
        })
      }
      return response
    } catch (err) {
      transport.pushError({
        provider: llm.provider,
        request: requestBody,
        error: err instanceof Error ? err.message : String(err),
        latency: Date.now() - start,
      })
      throw err
    }
  }

  ;(patched as unknown as PatchedFlag).__agentlens_patched = true
  globalThis.fetch = patched
}
