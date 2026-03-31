import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleProxyRequest } from '../src/proxy';
import type { SpanEmitter } from '../src/span-emitter';

// Mock upstream fetch
let upstreamFetch: ReturnType<typeof vi.fn>;
const mockEmitter = {
  emit: vi.fn().mockResolvedValue(undefined),
} as unknown as SpanEmitter;

describe('handleProxyRequest (non-streaming)', () => {
  beforeEach(() => {
    upstreamFetch = vi.fn();
    global.fetch = upstreamFetch as unknown as typeof fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards request to upstream and returns response', async () => {
    const upstreamBody = {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    upstreamFetch.mockResolvedValue(new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const requestBody = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    };

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody,
      requestHeaders: {
        'authorization': 'Bearer sk-test',
        'content-type': 'application/json',
      },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    // Verify upstream was called correctly
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.method).toBe('POST');

    // Verify response is forwarded
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.choices[0].message.content).toBe('Hello!');

    // Verify span was emitted
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.projectId).toBe('proj-1');
    expect(span.provider).toBe('openai');
    expect(span.model).toBe('gpt-4o');
    expect(span.output).toBe('Hello!');
    expect(span.inputTokens).toBe(5);
    expect(span.outputTokens).toBe(3);
    expect(span.status).toBe('success');
  });

  it('forwards upstream errors and emits error span', async () => {
    upstreamFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'Rate limited' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [], stream: false },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(429);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('error');
  });

  it('returns 502 when upstream is unreachable', async () => {
    upstreamFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [], stream: false },
      requestHeaders: {},
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(502);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('error');
    expect(span.errorMessage).toContain('ECONNREFUSED');
  });
});

describe('handleProxyRequest (streaming)', () => {
  beforeEach(() => {
    upstreamFetch = vi.fn();
    global.fetch = upstreamFetch as unknown as typeof fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams SSE chunks to client and emits span after completion', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    upstreamFetch.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const result = await handleProxyRequest({
      provider: 'openai',
      projectId: 'proj-1',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'https://api.openai.com',
      requestBody: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: true },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter: mockEmitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');

    // Consume the response stream to trigger span emission
    const reader = result.body!.getReader();
    let fullText = '';
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value);
    }

    // Verify chunks were forwarded
    expect(fullText).toContain('data: {"choices"');
    expect(fullText).toContain('[DONE]');

    // Wait for async span emission
    await new Promise((r) => setTimeout(r, 50));

    // Verify span was emitted with accumulated data
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
    const span = (mockEmitter.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(span.status).toBe('success');
    expect(span.output).toBe('Hello world');
    expect(span.inputTokens).toBe(5);
    expect(span.outputTokens).toBe(2);
  });
});
