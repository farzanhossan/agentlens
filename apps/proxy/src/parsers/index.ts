// src/parsers/index.ts
import type { ProviderParser } from './types';
import { OpenAIParser } from './openai';
import { AnthropicParser } from './anthropic';
import { GenericParser } from './generic';

const openai = new OpenAIParser();
const anthropic = new AnthropicParser();
const generic = new GenericParser();

const parsers: Record<string, ProviderParser> = {
  openai,
  anthropic,
};

export function getParser(provider: string): ProviderParser {
  return parsers[provider] || generic;
}

export type { ProviderParser, ParsedRequest, ParsedResponse, TokenUsage } from './types';
export { PROVIDER_UPSTREAMS } from './types';
