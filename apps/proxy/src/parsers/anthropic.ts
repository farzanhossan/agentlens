// src/parsers/anthropic.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-3-5-sonnet':  { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-3-5-haiku':   { inputPerMillion: 0.8,   outputPerMillion: 4 },
  'claude-3-opus':      { inputPerMillion: 15,    outputPerMillion: 75 },
  'claude-3-sonnet':    { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-3-haiku':     { inputPerMillion: 0.25,  outputPerMillion: 1.25 },
  'claude-4-sonnet':    { inputPerMillion: 3,     outputPerMillion: 15 },
  'claude-4-opus':      { inputPerMillion: 15,    outputPerMillion: 75 },
};

function extractMessageText(messages: unknown[]): string {
  return messages
    .map((m: unknown) => {
      const msg = m as Record<string, unknown>;
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return (msg.content as Array<Record<string, unknown>>)
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text))
          .join('');
      }
      return '';
    })
    .join('\n');
}

function matchPricing(model: string): ModelPricing | undefined {
  if (PRICING[model]) return PRICING[model];
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return undefined;
}

export class AnthropicParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    const system = typeof b.system === 'string' ? b.system : '';
    const messages = Array.isArray(b.messages) ? b.messages : [];
    const userText = extractMessageText(messages);
    const input = system ? `${system}\n\n${userText}` : userText;

    return {
      model: String(b.model || 'unknown'),
      input,
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    const b = body as Record<string, unknown>;
    const content = Array.isArray(b.content) ? b.content : [];
    const output = (content as Array<Record<string, unknown>>)
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text))
      .join('');

    const usage = b.usage as Record<string, number> | undefined;
    return {
      output,
      usage: usage
        ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
        : undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    let output = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of dataLines) {
      try {
        const event = JSON.parse(line);
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message?.usage?.input_tokens || 0;
            break;
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta') {
              output += event.delta.text;
            }
            break;
          case 'message_delta':
            outputTokens = event.usage?.output_tokens || 0;
            break;
        }
      } catch {
        // skip unparseable lines
      }
    }

    return {
      output,
      usage: { inputTokens, outputTokens },
    };
  }

  computeCost(model: string, usage: TokenUsage): number | undefined {
    const pricing = matchPricing(model);
    if (!pricing) return undefined;
    return (
      (usage.inputTokens * pricing.inputPerMillion +
        usage.outputTokens * pricing.outputPerMillion) /
      1_000_000
    );
  }
}
