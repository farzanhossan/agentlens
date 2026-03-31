// tests/parsers/openai.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAIParser } from '../../src/parsers/openai';

const parser = new OpenAIParser();

describe('OpenAIParser', () => {
  describe('parseRequest', () => {
    it('extracts model, messages, and streaming flag', () => {
      const body = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        stream: false,
      };
      const result = parser.parseRequest(body);
      expect(result.model).toBe('gpt-4o');
      expect(result.input).toBe(JSON.stringify(body.messages));
      expect(result.isStreaming).toBe(false);
    });

    it('defaults isStreaming to false when stream is absent', () => {
      const body = { model: 'gpt-4o', messages: [] };
      expect(parser.parseRequest(body).isStreaming).toBe(false);
    });

    it('detects streaming request', () => {
      const body = { model: 'gpt-4o', messages: [], stream: true };
      expect(parser.parseRequest(body).isStreaming).toBe(true);
    });
  });

  describe('parseResponse', () => {
    it('extracts completion text and usage', () => {
      const body = {
        id: 'chatcmpl-abc',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi there!');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('handles missing usage gracefully', () => {
      const body = {
        choices: [{ message: { content: 'Hi' } }],
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi');
      expect(result.usage).toBeUndefined();
    });
  });

  describe('parseStreamChunks', () => {
    it('accumulates delta content and extracts usage from final chunk', () => {
      const dataLines = [
        '{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":""}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
        '{"id":"chatcmpl-1","choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        '[DONE]',
      ];
      const result = parser.parseStreamChunks(dataLines);
      expect(result.output).toBe('Hello world');
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    });
  });

  describe('computeCost', () => {
    it('computes cost for known model', () => {
      const cost = parser.computeCost('gpt-4o', { inputTokens: 1000, outputTokens: 1000 });
      // gpt-4o: input $0.005/1k, output $0.015/1k
      expect(cost).toBeCloseTo(0.005 + 0.015);
    });

    it('returns undefined for unknown model', () => {
      expect(parser.computeCost('unknown-model', { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
    });
  });
});
