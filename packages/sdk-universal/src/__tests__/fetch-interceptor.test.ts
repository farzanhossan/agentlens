import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { patchFetch } from '../interceptors/fetch'
import { Transport } from '../transport'

function createTransport() {
  return new Transport({
    apiKey: 'k',
    endpoint: 'https://ingest.example/spans',
    flushIntervalMs: 60_000,
    maxBatchSize: 1000,
  })
}

describe('patchFetch', () => {
  let originalFetch: typeof fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    delete (globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch
    delete (globalThis.fetch as unknown as { __agentlens_patched?: boolean })?.__agentlens_patched
  })

  it('passes non-LLM calls through untouched', async () => {
    const upstream = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    globalThis.fetch = upstream as unknown as typeof fetch

    const t = createTransport()
    const pushSpy = vi.spyOn(t, 'push')
    patchFetch(t)

    const res = await fetch('https://example.com/api')
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(pushSpy).not.toHaveBeenCalled()
    t.shutdown()
  })

  it('intercepts an OpenAI call and pushes a span', async () => {
    const upstream = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    globalThis.fetch = upstream as unknown as typeof fetch

    const t = createTransport()
    const pushSpy = vi.spyOn(t, 'push')
    patchFetch(t)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    })
    const body = await res.json()
    expect(body.model).toBe('gpt-4o-mini')
    expect(pushSpy).toHaveBeenCalledOnce()
    const arg = pushSpy.mock.calls[0][0]
    expect(arg.provider).toBe('openai')
    expect(arg.isStream).toBe(false)
    t.shutdown()
  })

  it('on streaming response, returns a working stream to caller AND captures', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: [DONE]\n\n'
    const enc = new TextEncoder()
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(sse))
        controller.close()
      },
    })

    const upstream = vi.fn(
      async () => new Response(responseStream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    globalThis.fetch = upstream as unknown as typeof fetch

    const t = createTransport()
    const pushSpy = vi.spyOn(t, 'push')
    patchFetch(t)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o-mini', stream: true, messages: [] }),
    })
    const userText = await res.text()
    expect(userText).toContain('hel')
    expect(userText).toContain('lo')

    // background SSE capture is async — wait a tick
    await new Promise((r) => setTimeout(r, 20))
    expect(pushSpy).toHaveBeenCalledOnce()
    const arg = pushSpy.mock.calls[0][0]
    expect(arg.isStream).toBe(true)
    expect((arg.response as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe('hello')
    t.shutdown()
  })

  it('re-throws errors from upstream and records an error span', async () => {
    const upstream = vi.fn(async () => {
      throw new Error('connection refused')
    })
    globalThis.fetch = upstream as unknown as typeof fetch

    const t = createTransport()
    const errSpy = vi.spyOn(t, 'pushError')
    patchFetch(t)

    await expect(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o' }),
      }),
    ).rejects.toThrow('connection refused')

    expect(errSpy).toHaveBeenCalledOnce()
    expect(errSpy.mock.calls[0][0].error).toBe('connection refused')
    t.shutdown()
  })
})
