import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { AgentLens } from '@agentlens/core';
import { patch, patches, unpatch } from '../patcher.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let capturedSpans: unknown[] = [];

function initSDK(): void {
  AgentLens.init({
    apiKey: 'test-key',
    projectId: 'proj-test-uuid',
    endpoint: 'http://localhost:9999',
    flushIntervalMs: 999_999,
    maxBatchSize: 999_999,
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  capturedSpans = [];
  vi.spyOn(AgentLens, '_pushSpan').mockImplementation((span) => {
    capturedSpans.push(span);
  });
  initSDK();
  // Pass the ESM OpenAI class explicitly so require() vs import() use the same proto
  patch(OpenAI);
});

afterEach(async () => {
  unpatch();
  if (AgentLens._isInitialized()) {
    await AgentLens.shutdown();
  }
  vi.restoreAllMocks();
});

// ── chat.completions.create (non-streaming) ───────────────────────────────────

describe('chat.completions.create — non-streaming', () => {
  it('captures model, input messages, output text, and token counts', async () => {
    const mockCompletion = {
      id: 'chatcmpl-abc',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello, world!', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      system_fingerprint: null,
    };

    patches[0].original = vi.fn().mockResolvedValue(mockCompletion);

    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Say hello' },
    ];

    const result = await client.chat.completions.create({ model: 'gpt-4o', messages });

    expect(result.choices[0]?.message.content).toBe('Hello, world!');
    expect(capturedSpans).toHaveLength(1);

    const span = capturedSpans[0] as Record<string, unknown>;
    expect(span['name']).toBe('openai.chat.completions');
    expect(span['model']).toBe('gpt-4o');
    expect(span['provider']).toBe('openai');
    expect(span['status']).toBe('success');
    expect(span['output']).toBe('Hello, world!');
    expect(span['inputTokens']).toBe(10);
    expect(span['outputTokens']).toBe(5);
    expect(span['input']).toContain('Say hello');
    expect(typeof span['latencyMs']).toBe('number');
  });

  it('sets status=error and captures errorMessage when the call throws', async () => {
    patches[0].original = vi.fn().mockRejectedValue(new Error('rate limit exceeded'));

    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });

    await expect(
      client.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    ).rejects.toThrow('rate limit exceeded');

    expect(capturedSpans).toHaveLength(1);
    const span = capturedSpans[0] as Record<string, unknown>;
    expect(span['status']).toBe('error');
    expect(span['errorMessage']).toBe('rate limit exceeded');
  });
});

// ── chat.completions.create (streaming) ──────────────────────────────────────

describe('chat.completions.create — streaming', () => {
  it('buffers chunks and records reconstructed output when stream ends', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      makeChunk('Hello'),
      makeChunk(', '),
      makeChunk('world!'),
    ];

    patches[0].original = vi.fn().mockResolvedValue(asyncIterableFrom(chunks));

    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });

    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    // Consume the stream
    const received: string[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      received.push(chunk.choices[0]?.delta?.content ?? '');
    }

    expect(received.join('')).toBe('Hello, world!');
    expect(capturedSpans).toHaveLength(1);

    const span = capturedSpans[0] as Record<string, unknown>;
    expect(span['name']).toBe('openai.chat.completions');
    expect(span['output']).toBe('Hello, world!');
    expect(span['status']).toBe('success');
  });

  it('sets status=error if the stream throws mid-iteration', async () => {
    patches[0].original = vi.fn().mockResolvedValue(throwingIterable());

    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });

    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [],
      stream: true,
    });

    await expect(async () => {
      for await (const _ of stream as unknown as AsyncIterable<unknown>) {
        void _;
      }
    }).rejects.toThrow('stream error');

    expect(capturedSpans).toHaveLength(1);
    const span = capturedSpans[0] as Record<string, unknown>;
    expect(span['status']).toBe('error');
    expect(span['errorMessage']).toBe('stream error');
  });
});

// ── embeddings.create ─────────────────────────────────────────────────────────

describe('embeddings.create', () => {
  it('captures model and token usage', async () => {
    const mockResponse: OpenAI.CreateEmbeddingResponse = {
      object: 'list',
      model: 'text-embedding-3-small',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    };

    // patches[0]=chat, patches[1]=legacy-completions, patches[2]=embeddings
    patches[2].original = vi.fn().mockResolvedValue(mockResponse);

    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });

    await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'embed this text',
    });

    expect(capturedSpans).toHaveLength(1);
    const span = capturedSpans[0] as Record<string, unknown>;
    expect(span['name']).toBe('openai.embeddings');
    expect(span['model']).toBe('text-embedding-3-small');
    expect(span['inputTokens']).toBe(8);
    expect(span['input']).toBe('embed this text');
  });
});

// ── No-op when SDK not initialized ───────────────────────────────────────────

describe('uninitialised SDK', () => {
  it('does not throw and still returns the OpenAI result', async () => {
    await AgentLens.shutdown(); // reset the singleton

    const mockResult = {
      id: 'chatcmpl-x',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      system_fingerprint: null,
    };

    patches[0].original = vi.fn().mockResolvedValue(mockResult);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new OpenAI({ apiKey: 'sk-test', maxRetries: 0 });

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.choices[0]?.message.content).toBe('hi');
    expect(capturedSpans).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AgentLens.init()'));

    warnSpy.mockRestore();
  });
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeChunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content },
        finish_reason: null,
        logprobs: null,
      },
    ],
    system_fingerprint: null,
  };
}

function* asyncIterableFrom<T>(items: T[]): Iterable<T> {
  for (const item of items) yield item;
}

function* throwingIterable(): Iterable<never> {
  throw new Error('stream error');
  // unreachable — satisfies TypeScript
  yield undefined as never;
}
