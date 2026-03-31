// tests/parsers/generic.test.ts
import { describe, it, expect } from 'vitest';
import { GenericParser } from '../../src/parsers/generic';

const parser = new GenericParser();

describe('GenericParser', () => {
  it('captures raw body as input and marks model unknown', () => {
    const body = { some: 'data', model: 'custom-llm' };
    const result = parser.parseRequest(body);
    expect(result.model).toBe('unknown');
    expect(result.input).toBe(JSON.stringify(body));
    expect(result.isStreaming).toBe(false);
  });

  it('detects streaming from stream field', () => {
    const body = { prompt: 'hello', stream: true };
    expect(parser.parseRequest(body).isStreaming).toBe(true);
  });

  it('captures raw response body as output', () => {
    const body = { text: 'response here' };
    const result = parser.parseResponse(body);
    expect(result.output).toBe(JSON.stringify(body));
    expect(result.usage).toBeUndefined();
  });

  it('joins stream data lines as raw output', () => {
    const result = parser.parseStreamChunks(['chunk1', 'chunk2', '[DONE]']);
    expect(result.output).toBe('chunk1\nchunk2\n[DONE]');
    expect(result.usage).toBeUndefined();
  });

  it('always returns undefined for cost', () => {
    expect(parser.computeCost('any', { inputTokens: 100, outputTokens: 50 })).toBeUndefined();
  });
});
