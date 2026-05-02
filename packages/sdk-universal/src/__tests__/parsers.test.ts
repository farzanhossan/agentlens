import { describe, expect, it } from 'vitest'
import { parseAnthropic } from '../parsers/anthropic'
import { parseCohere } from '../parsers/cohere'
import { parseGemini } from '../parsers/gemini'
import { parseMistral } from '../parsers/mistral'
import { parseOpenAI, parseOpenAIStream } from '../parsers/openai'

describe('parseOpenAI', () => {
  it('parses chat.completions response with tokens and cost', () => {
    const result = parseOpenAI({
      request: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      response: {
        model: 'gpt-4o',
        choices: [{ message: { content: 'hello there' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      isStream: false,
    })

    expect(result.model).toBe('gpt-4o')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
    expect(result.totalTokens).toBe(15)
    // 10 * 0.0000025 + 5 * 0.00001 = 0.000075
    expect(result.costUsd).toBeCloseTo(0.000075, 8)
    expect(result.inputText).toBe('hi')
    expect(result.outputText).toBe('hello there')
  })

  it('handles version-suffixed model names in cost lookup', () => {
    const result = parseOpenAI({
      request: { model: 'gpt-4o-2024-08-06', messages: [] },
      response: {
        model: 'gpt-4o-2024-08-06',
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      },
      isStream: false,
    })
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('returns 0 cost for unknown model', () => {
    const result = parseOpenAI({
      request: { model: 'nonsense', messages: [] },
      response: { model: 'nonsense', usage: { prompt_tokens: 1, completion_tokens: 1 } },
      isStream: false,
    })
    expect(result.costUsd).toBe(0)
  })
})

describe('parseOpenAIStream', () => {
  it('assembles output text from stream tokens', () => {
    const result = parseOpenAIStream({
      request: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
      outputText: 'hello world',
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    })
    expect(result.isStream).toBe(true)
    expect(result.outputText).toBe('hello world')
    expect(result.inputTokens).toBe(4)
    expect(result.outputTokens).toBe(2)
  })
})

describe('parseAnthropic', () => {
  it('parses messages response with tokens and cost', () => {
    const result = parseAnthropic({
      request: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] },
      response: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      isStream: false,
    })

    expect(result.provider).toBe('anthropic')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
    // 10 * 0.000003 + 5 * 0.000015 = 0.000105
    expect(result.costUsd).toBeCloseTo(0.000105, 8)
    expect(result.outputText).toBe('hello')
  })

  it('extracts system + messages into inputText', () => {
    const result = parseAnthropic({
      request: {
        model: 'claude-haiku-4-5',
        system: 'be helpful',
        messages: [{ role: 'user', content: 'hi' }],
      },
      response: {
        model: 'claude-haiku-4-5',
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      isStream: false,
    })
    expect(result.inputText).toContain('be helpful')
    expect(result.inputText).toContain('hi')
  })
})

describe('parseGemini', () => {
  it('extracts content + usage', () => {
    const result = parseGemini({
      request: {
        contents: [{ parts: [{ text: 'hi' }] }],
      },
      response: {
        modelVersion: 'gemini-1.5-flash',
        candidates: [{ content: { parts: [{ text: 'hello' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      },
      isStream: false,
    })
    expect(result.outputText).toBe('hello')
    expect(result.inputTokens).toBe(5)
    expect(result.outputTokens).toBe(3)
    expect(result.totalTokens).toBe(8)
  })
})

describe('parseCohere', () => {
  it('parses v1 chat response', () => {
    const result = parseCohere({
      request: { model: 'command-r-plus', message: 'hi' },
      response: {
        text: 'hello',
        meta: { billed_units: { input_tokens: 8, output_tokens: 4 } },
      },
      isStream: false,
    })
    expect(result.outputText).toBe('hello')
    expect(result.inputTokens).toBe(8)
    expect(result.outputTokens).toBe(4)
    expect(result.costUsd).toBeGreaterThan(0)
  })
})

describe('parseMistral', () => {
  it('parses chat response (OpenAI-shaped)', () => {
    const result = parseMistral({
      request: { model: 'mistral-large-latest', messages: [{ role: 'user', content: 'hi' }] },
      response: {
        model: 'mistral-large-latest',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
      isStream: false,
    })
    expect(result.outputText).toBe('hello')
    expect(result.totalTokens).toBe(7)
    expect(result.costUsd).toBeGreaterThan(0)
  })
})
