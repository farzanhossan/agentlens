import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpanEmitter } from '../src/span-emitter';

describe('SpanEmitter', () => {
  let emitter: SpanEmitter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchSpy as unknown as typeof fetch;
    emitter = new SpanEmitter('http://localhost:3001/v1/spans');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends span data as gzipped JSON to ingest endpoint', async () => {
    await emitter.emit({
      spanId: 'span-1',
      traceId: 'trace-1',
      projectId: 'proj-1',
      name: 'openai.chat.completions',
      model: 'gpt-4o',
      provider: 'openai',
      input: '["hello"]',
      output: 'world',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      latencyMs: 200,
      status: 'success',
      metadata: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.200Z',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3001/v1/spans');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Content-Encoding']).toBe('gzip');
    expect(options.headers['X-API-Key']).toBe('proxy-internal');
  });

  it('does not throw on fetch failure (fire-and-forget)', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    // Should not throw
    await emitter.emit({
      spanId: 's', traceId: 't', projectId: 'p', name: 'test',
      status: 'success', metadata: {}, startedAt: new Date().toISOString(),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
