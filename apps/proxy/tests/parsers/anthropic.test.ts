// tests/parsers/anthropic.test.ts
import { describe, it, expect } from 'vitest';
import { AnthropicParser } from '../../src/parsers/anthropic';

const parser = new AnthropicParser();

describe('AnthropicParser', () => {
  describe('parseRequest', () => {
    it('extracts model, messages with system, and streaming flag', () => {
      const body = {
        model: 'claude-3-5-sonnet-20241022',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      const result = parser.parseRequest(body);
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.input).toBe('You are helpful.\n\nHello');
      expect(result.isStreaming).toBe(false);
    });

    it('handles missing system prompt', () => {
      const body = {
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const result = parser.parseRequest(body);
      expect(result.input).toBe('Hi');
      expect(result.isStreaming).toBe(false);
    });

    it('handles content block arrays in messages', () => {
      const body = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] },
        ],
      };
      const result = parser.parseRequest(body);
      expect(result.input).toBe('Hello world');
    });
  });

  describe('parseResponse', () => {
    it('extracts text and usage', () => {
      const body = {
        id: 'msg_abc',
        model: 'claude-3-5-sonnet-20241022',
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Hi there!');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('joins multiple text blocks', () => {
      const body = {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: ' Part 2' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = parser.parseResponse(body);
      expect(result.output).toBe('Part 1 Part 2');
    });
  });

  describe('parseStreamChunks', () => {
    it('accumulates content deltas and extracts usage from message_delta', () => {
      const dataLines = [
        '{"type":"message_start","message":{"id":"msg_1","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":10,"output_tokens":0}}}',
        '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
        '{"type":"content_block_stop","index":0}',
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
        '{"type":"message_stop"}',
      ];
      const result = parser.parseStreamChunks(dataLines);
      expect(result.output).toBe('Hello world');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });
  });

  describe('computeCost', () => {
    it('computes cost for known model', () => {
      const cost = parser.computeCost('claude-3-5-sonnet-20241022', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      // $3/M input + $15/M output = $18
      expect(cost).toBeCloseTo(18);
    });

    it('matches model prefix for unknown suffix', () => {
      const cost = parser.computeCost('claude-3-5-sonnet-99991231', {
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(cost).toBeCloseTo(3);
    });

    it('returns undefined for unknown model', () => {
      expect(parser.computeCost('unknown', { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
    });
  });
});
