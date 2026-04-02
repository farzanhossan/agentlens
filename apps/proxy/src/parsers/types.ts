// src/parsers/types.ts

export interface ParsedRequest {
  model: string;
  input: string;             // serialized prompt/messages
  isStreaming: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ParsedResponse {
  output: string;            // completion text
  usage?: TokenUsage;
}

export interface ProviderParser {
  /** Extract model, input, and streaming flag from the request body. */
  parseRequest(body: unknown): ParsedRequest;

  /** Extract completion text and token usage from a non-streaming response body. */
  parseResponse(body: unknown): ParsedResponse;

  /** Reconstruct a full ParsedResponse from accumulated SSE data lines. */
  parseStreamChunks(dataLines: string[]): ParsedResponse;

  /** Compute cost in USD. Returns undefined if model is not in pricing table. */
  computeCost(model: string, usage: TokenUsage): number | undefined;
}

/** Maps provider names to their upstream base URLs. */
export const PROVIDER_UPSTREAMS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};
