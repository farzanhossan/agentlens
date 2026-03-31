// tests/integration/proxy-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { gunzipSync } from 'node:zlib';

describe('Proxy integration flow', () => {
  let mockUpstreamServer: ReturnType<typeof serve>;
  let mockIngestServer: ReturnType<typeof serve>;
  let capturedSpans: unknown[] = [];

  beforeAll(async () => {
    // Mock LLM upstream
    const upstream = new Hono();
    upstream.post('/v1/chat/completions', async (c) => {
      return c.json({
        id: 'chatcmpl-test',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Integration test response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      });
    });
    mockUpstreamServer = serve({ fetch: upstream.fetch, port: 19001 });

    // Mock ingest endpoint — handles gzip-compressed payloads from SpanEmitter
    const ingest = new Hono();
    ingest.post('/v1/spans', async (c) => {
      const raw = await c.req.arrayBuffer();
      const decompressed = gunzipSync(Buffer.from(raw));
      const body = JSON.parse(decompressed.toString()) as { spans: unknown[] };
      capturedSpans.push(...body.spans);
      return c.json({ accepted: true, count: body.spans.length }, 202);
    });
    mockIngestServer = serve({ fetch: ingest.fetch, port: 19002 });

    // Wait for servers to start
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(() => {
    mockUpstreamServer?.close();
    mockIngestServer?.close();
  });

  it('proxies a non-streaming request end-to-end', async () => {
    // Import the proxy handler and emitter
    const { handleProxyRequest } = await import('../../src/proxy');
    const { SpanEmitter } = await import('../../src/span-emitter');

    const emitter = new SpanEmitter('http://localhost:19002/v1/spans');

    const response = await handleProxyRequest({
      provider: 'openai',
      projectId: 'test-project',
      upstreamPath: '/v1/chat/completions',
      upstreamBaseUrl: 'http://localhost:19001',
      requestBody: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello integration test' }],
      },
      requestHeaders: { 'authorization': 'Bearer sk-test' },
      emitter,
      bufferMaxSize: 10 * 1024 * 1024,
    });

    // Verify response
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe('Integration test response');

    // Wait for async span emission
    await new Promise((r) => setTimeout(r, 300));

    // Verify span was captured by mock ingest
    expect(capturedSpans.length).toBeGreaterThanOrEqual(1);
    const span = capturedSpans[capturedSpans.length - 1] as Record<string, unknown>;
    expect(span.projectId).toBe('test-project');
    expect(span.provider).toBe('openai');
    expect(span.model).toBe('gpt-4o');
    expect(span.status).toBe('success');
    expect(span.inputTokens).toBe(10);
    expect(span.outputTokens).toBe(8);
  });
});
