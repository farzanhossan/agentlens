import { describe, expect, it } from 'vitest'
import { matchLLM } from '../registry'

describe('matchLLM', () => {
  it('matches OpenAI chat completions', () => {
    const r = matchLLM('https://api.openai.com/v1/chat/completions')
    expect(r?.provider).toBe('openai')
    expect(r?.parser).toBe('openai')
  })

  it('matches Anthropic messages', () => {
    const r = matchLLM('https://api.anthropic.com/v1/messages')
    expect(r?.provider).toBe('anthropic')
  })

  it('matches Gemini', () => {
    const r = matchLLM('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent')
    expect(r?.provider).toBe('gemini')
  })

  it('matches Cohere v2 chat', () => {
    const r = matchLLM('https://api.cohere.com/v2/chat')
    expect(r?.provider).toBe('cohere')
  })

  it('matches Mistral chat completions', () => {
    const r = matchLLM('https://api.mistral.ai/v1/chat/completions')
    expect(r?.provider).toBe('mistral')
  })

  it('returns null for unknown host', () => {
    expect(matchLLM('https://google.com')).toBeNull()
  })

  it('returns null for known host but unknown path', () => {
    expect(matchLLM('https://api.openai.com/v1/files')).toBeNull()
  })

  it('returns null (no throw) for invalid URL', () => {
    expect(matchLLM('not-a-url')).toBeNull()
  })
})
