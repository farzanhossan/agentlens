import { describe, expect, it, vi } from 'vitest'
import { captureSSEStream } from '../streaming/sse'
import type { Transport } from '../transport'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

function mockTransport(): { push: ReturnType<typeof vi.fn>; pushError: ReturnType<typeof vi.fn> } {
  return { push: vi.fn(), pushError: vi.fn() }
}

describe('captureSSEStream — per-provider round-trip', () => {
  it('openai: extracts assembled text + tokens from delta + usage events', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(sse), {
      llm: { provider: 'openai', parser: 'openai', paths: [] },
      requestBody: { model: 'gpt-4o-mini', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      latency: 10,
      transport: t as unknown as Transport,
    })

    expect(t.push).toHaveBeenCalledTimes(1)
    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      model: string
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    expect(resp.choices[0].message.content).toBe('Hello world')
    expect(resp.usage.prompt_tokens).toBe(5)
    expect(resp.usage.completion_tokens).toBe(2)
  })

  it('anthropic: extracts text from content_block_delta + usage from message_delta', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
      'data: {"type":"message_delta","usage":{"input_tokens":4,"output_tokens":2}}\n\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(sse), {
      llm: { provider: 'anthropic', parser: 'anthropic', paths: [] },
      requestBody: { model: 'claude-3-5-sonnet-20240620', stream: true },
      latency: 10,
      transport: t as unknown as Transport,
    })

    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      content: Array<{ text: string }>
      usage: { input_tokens: number; output_tokens: number }
    }
    expect(resp.content[0].text).toBe('Hi there')
    expect(resp.usage.input_tokens).toBe(4)
    expect(resp.usage.output_tokens).toBe(2)
  })

  it('gemini: parses candidates.parts text + usageMetadata token counts', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(sse), {
      llm: { provider: 'gemini', parser: 'gemini', paths: [] },
      requestBody: { model: 'gemini-1.5-flash', stream: true },
      latency: 10,
      transport: t as unknown as Transport,
    })

    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number }
    }
    expect(resp.candidates[0].content.parts[0].text).toBe('Hello')
    expect(resp.usageMetadata.promptTokenCount).toBe(3)
    expect(resp.usageMetadata.candidatesTokenCount).toBe(2)
  })

  it('cohere v1: handles text-generation + stream-end with meta.billed_units', async () => {
    const ndjson = [
      '{"event_type":"text-generation","text":"Hel"}\n',
      '{"event_type":"text-generation","text":"lo"}\n',
      '{"event_type":"stream-end","response":{"text":"Hello","meta":{"billed_units":{"input_tokens":2,"output_tokens":2}}}}\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(ndjson), {
      llm: { provider: 'cohere', parser: 'cohere', paths: [] },
      requestBody: { model: 'command-r', stream: true },
      latency: 10,
      transport: t as unknown as Transport,
    })

    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      text: string
      meta: { billed_units: { input_tokens: number; output_tokens: number } }
    }
    expect(resp.text).toBe('Hello')
    expect(resp.meta.billed_units.input_tokens).toBe(2)
    expect(resp.meta.billed_units.output_tokens).toBe(2)
  })

  it('cohere v2: handles content-delta + message-end usage.tokens', async () => {
    const sse = [
      'event: content-delta\n',
      'data: {"delta":{"message":{"content":{"text":"Hey"}}}}\n\n',
      'event: message-end\n',
      'data: {"delta":{"usage":{"tokens":{"input_tokens":1,"output_tokens":1}}}}\n\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(sse), {
      llm: { provider: 'cohere', parser: 'cohere', paths: [] },
      requestBody: { model: 'command-r', stream: true },
      latency: 10,
      transport: t as unknown as Transport,
    })

    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      text: string
      meta: { billed_units: { input_tokens: number; output_tokens: number } }
    }
    expect(resp.text).toBe('Hey')
    expect(resp.meta.billed_units.input_tokens).toBe(1)
    expect(resp.meta.billed_units.output_tokens).toBe(1)
  })

  it('mistral: reuses OpenAI SSE shape', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]
    const t = mockTransport()
    await captureSSEStream(streamOf(sse), {
      llm: { provider: 'mistral', parser: 'mistral', paths: [] },
      requestBody: { model: 'mistral-small', stream: true },
      latency: 10,
      transport: t as unknown as Transport,
    })

    const payload = t.push.mock.calls[0][0] as { response: Record<string, unknown> }
    const resp = payload.response as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    expect(resp.choices[0].message.content).toBe('Bonjour')
    expect(resp.usage.prompt_tokens).toBe(2)
    expect(resp.usage.completion_tokens).toBe(1)
  })
})
