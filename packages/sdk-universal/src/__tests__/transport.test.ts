import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transport } from '../transport'

describe('Transport', () => {
  let originalFetch: typeof fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
    delete (globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch
    vi.useRealTimers()
  })

  it('queues spans and flushes after the interval', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 200 })
    })
    ;(globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch = fakeFetch

    vi.useFakeTimers()
    const t = new Transport({
      apiKey: 'k',
      endpoint: 'https://x.example/spans',
      flushIntervalMs: 100,
    })

    t.push({
      provider: 'openai',
      parser: 'openai',
      request: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
      response: {
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      latency: 12,
      status: 200,
      isStream: false,
    })

    await vi.advanceTimersByTimeAsync(150)
    await t.flush()

    expect(fakeFetch).toHaveBeenCalled()
    expect(calls[0].url).toBe('https://x.example/spans')
    const body = JSON.parse(calls[0].init?.body as string)
    expect(body.spans).toHaveLength(1)
    expect(body.spans[0].provider).toBe('openai')
    expect(body.spans[0].outputText).toBe('hello')

    t.shutdown()
  })

  it('flushes immediately when batch reaches max size', async () => {
    const fakeFetch = vi.fn(async () => new Response('{}', { status: 200 }))
    ;(globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch = fakeFetch

    const t = new Transport({
      apiKey: 'k',
      endpoint: 'https://x.example/spans',
      flushIntervalMs: 60_000,
      maxBatchSize: 2,
    })

    for (let i = 0; i < 2; i++) {
      t.push({
        provider: 'openai',
        parser: 'openai',
        request: { model: 'gpt-4o-mini', messages: [] },
        response: { model: 'gpt-4o-mini', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
        latency: 1,
        status: 200,
        isStream: false,
      })
    }

    // Allow microtasks/promises in flush() to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    t.shutdown()
  })

  it('silently swallows network errors', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('network down')
    })
    ;(globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch = fakeFetch

    const t = new Transport({
      apiKey: 'k',
      endpoint: 'https://x.example/spans',
      flushIntervalMs: 60_000,
      maxBatchSize: 1,
    })

    expect(() =>
      t.push({
        provider: 'openai',
        parser: 'openai',
        request: { model: 'gpt-4o-mini' },
        response: { model: 'gpt-4o-mini', usage: { prompt_tokens: 1, completion_tokens: 1 } },
        latency: 1,
        status: 200,
        isStream: false,
      }),
    ).not.toThrow()

    await new Promise((r) => setTimeout(r, 50))
    t.shutdown()
  })

  it('pushError sends an error span shape', async () => {
    let capturedBody: string | null = null
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response('{}', { status: 200 })
    })
    ;(globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch = fakeFetch

    const t = new Transport({
      apiKey: 'k',
      endpoint: 'https://x.example/spans',
      flushIntervalMs: 60_000,
      maxBatchSize: 1,
    })

    t.pushError({
      provider: 'openai',
      request: { model: 'gpt-4o', messages: [] },
      error: 'boom',
      latency: 42,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(capturedBody).not.toBeNull()
    const body = JSON.parse(capturedBody as unknown as string)
    expect(body.spans[0].error).toBe('boom')
    expect(body.spans[0].latency).toBe(42)
    expect(body.spans[0].provider).toBe('openai')
    t.shutdown()
  })
})
