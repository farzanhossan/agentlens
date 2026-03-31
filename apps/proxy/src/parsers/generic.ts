// src/parsers/generic.ts
import type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';

export class GenericParser implements ProviderParser {
  parseRequest(body: unknown): ParsedRequest {
    const b = body as Record<string, unknown>;
    return {
      model: 'unknown',
      input: JSON.stringify(body),
      isStreaming: Boolean(b.stream),
    };
  }

  parseResponse(body: unknown): ParsedResponse {
    return {
      output: JSON.stringify(body),
      usage: undefined,
    };
  }

  parseStreamChunks(dataLines: string[]): ParsedResponse {
    return {
      output: dataLines.join('\n'),
      usage: undefined,
    };
  }

  computeCost(_model: string, _usage: TokenUsage): number | undefined {
    return undefined;
  }
}
