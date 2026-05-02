import type { LLMEndpoint } from './types'

export const LLM_REGISTRY: Record<string, LLMEndpoint> = {
  'api.openai.com': {
    provider: 'openai',
    parser: 'openai',
    paths: ['/v1/chat/completions', '/v1/completions', '/v1/embeddings'],
  },
  'api.anthropic.com': {
    provider: 'anthropic',
    parser: 'anthropic',
    paths: ['/v1/messages'],
  },
  'generativelanguage.googleapis.com': {
    provider: 'gemini',
    parser: 'gemini',
    paths: ['/v1beta/models', '/v1/models'],
  },
  'api.cohere.com': {
    provider: 'cohere',
    parser: 'cohere',
    paths: ['/v1/chat', '/v1/generate', '/v2/chat'],
  },
  'api.mistral.ai': {
    provider: 'mistral',
    parser: 'mistral',
    paths: ['/v1/chat/completions'],
  },
}

export function matchLLM(url: string): LLMEndpoint | null {
  try {
    const parsed = new URL(url)
    const entry = LLM_REGISTRY[parsed.hostname]
    if (!entry) return null
    const pathMatch = entry.paths.some((p) => parsed.pathname.startsWith(p))
    return pathMatch ? entry : null
  } catch {
    return null
  }
}

export function matchHostPath(host: string, path: string): LLMEndpoint | null {
  const entry = LLM_REGISTRY[host]
  if (!entry) return null
  const pathMatch = entry.paths.some((p) => path.startsWith(p))
  return pathMatch ? entry : null
}
