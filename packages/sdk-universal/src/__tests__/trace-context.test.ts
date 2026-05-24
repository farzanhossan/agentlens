import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLens } from '../index'

describe('trace() context propagation', () => {
  let originalFetch: typeof fetch | undefined
  let captured: Array<Record<string, unknown>> = []

  beforeEach(() => {
    originalFetch = globalThis.fetch
    captured = []
    const fake = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('ingest.example')) {
        const body = JSON.parse(init?.body as string) as { spans: Array<Record<string, unknown>> }
        for (const s of body.spans) captured.push(s)
        return new Response('{}', { status: 200 })
      }
      return new Response(
        JSON.stringify({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    globalThis.fetch = fake as unknown as typeof fetch
  })

  afterEach(async () => {
    await AgentLens.flush()
    AgentLens.shutdown()
    if (originalFetch) globalThis.fetch = originalFetch
    delete (globalThis as { __agentlens_originalFetch?: unknown }).__agentlens_originalFetch
    delete (globalThis.fetch as unknown as { __agentlens_patched?: boolean }).__agentlens_patched
  })

  it('standalone LLM call gets a fresh traceId and no parent', async () => {
    AgentLens.init({
      apiKey: 'k',
      projectId: 'p-trace-test',
      endpoint: 'https://ingest.example/spans',
      flushIntervalMs: 50,
      pii: false,
    })

    await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    })

    await AgentLens.flush()
    expect(captured).toHaveLength(1)
    expect(typeof captured[0].spanId).toBe('string')
    expect(typeof captured[0].traceId).toBe('string')
    expect(captured[0].parentSpanId).toBeUndefined()
  })

  it('LLM call inside trace() is parented to the trace span and shares its traceId', async () => {
    AgentLens.init({
      apiKey: 'k',
      projectId: 'p-trace-test',
      endpoint: 'https://ingest.example/spans',
      flushIntervalMs: 50,
      pii: false,
    })

    await AgentLens.trace('agent-run', async () => {
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'a' }] }),
      })
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'b' }] }),
      })
    })

    await AgentLens.flush()
    expect(captured).toHaveLength(2)
    // Both LLM spans share the surrounding trace's traceId
    expect(captured[0].traceId).toBe(captured[1].traceId)
    // Both LLM spans share the same parentSpanId (the surrounding trace span)
    expect(captured[0].parentSpanId).toBe(captured[1].parentSpanId)
    expect(typeof captured[0].parentSpanId).toBe('string')
    // The two LLM calls themselves have distinct spanIds
    expect(captured[0].spanId).not.toBe(captured[1].spanId)
  })

  it('nested trace() blocks produce nested parentage and a shared traceId', async () => {
    AgentLens.init({
      apiKey: 'k',
      projectId: 'p-trace-test',
      endpoint: 'https://ingest.example/spans',
      flushIntervalMs: 50,
      pii: false,
    })

    let innerTraceId: string | undefined
    let innerParent: string | undefined
    let outerSpanCaptured: { traceId?: string; parentSpanId?: string } = {}

    await AgentLens.trace('outer', async () => {
      const { getCurrentTraceId, getCurrentSpanId } = await import('../index')
      outerSpanCaptured = {
        traceId: getCurrentTraceId(),
        parentSpanId: getCurrentSpanId(),
      }
      await AgentLens.trace('inner', async () => {
        innerTraceId = getCurrentTraceId()
        innerParent = getCurrentSpanId()
        await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
        })
      })
    })

    await AgentLens.flush()
    // Inner trace inherits outer's traceId
    expect(innerTraceId).toBe(outerSpanCaptured.traceId)
    // Inner trace's currentSpanId is different from outer's (it has its own spanId)
    expect(innerParent).not.toBe(outerSpanCaptured.parentSpanId)
    // The LLM call inside inner was parented to the inner trace's spanId
    expect(captured).toHaveLength(1)
    expect(captured[0].parentSpanId).toBe(innerParent)
    expect(captured[0].traceId).toBe(outerSpanCaptured.traceId)
  })
})
