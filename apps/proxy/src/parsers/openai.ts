// src/parsers/openai.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

interface ModelPricing {
  inputCostPer1k: number;
  outputCostPer1k: number;
}

const PRICING: Record<string, ModelPricing> = {
  'gpt-4o':             { inputCostPer1k: 0.005,  outputCostPer1k: 0.015 },
  'gpt-4o-mini':        { inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  'gpt-4-turbo':        { inputCostPer1k: 0.01,   outputCostPer1k: 0.03 },
  'gpt-4':              { inputCostPer1k: 0.03,   outputCostPer1k: 0.06 },
  'gpt-3.5-turbo':      { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
  'o1':                 { inputCostPer1k: 0.015,  outputCostPer1k: 0.06 },
  'o1-mini':            { inputCostPer1k: 0.003,  outputCostPer1k: 0.012 },
  'o3':                 { inputCostPer1k: 0.01,   outputCostPer1k: 0.04 },
  'o3-mini':            { inputCostPer1k: 0.0011, outputCostPer1k: 0.0044 },
  'o4-mini':            { inputCostPer1k: 0.0011, outputCostPer1k: 0.0044 },
};

export class OpenAIParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    return {
      model: String(b.model || 'unknown'),
      input: JSON.stringify(b.messages || b.prompt || ''),
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    const b = body as Record<string, unknown>;
    const choices = b.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const output = String(message?.content || '');

    const usage = b.usage as Record<string, number> | undefined;
    return {
      output,
      usage: usage
        ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
        : undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    let output = '';
    let usage: TokenUsage | undefined;

    for (const line of dataLines) {
      if (line === '[DONE]') break;
      try {
        const chunk = JSON.parse(line);
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          output += delta.content;
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      } catch {
        // skip unparseable lines
      }
    }

    return { output, usage };
  }

  computeCost(model: string, usage: TokenUsage): number | undefined {
    const pricing = PRICING[model];
    if (!pricing) return undefined;
    return (
      (usage.inputTokens / 1000) * pricing.inputCostPer1k +
      (usage.outputTokens / 1000) * pricing.outputCostPer1k
    );
  }
}
