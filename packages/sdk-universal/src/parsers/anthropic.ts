import type { ParsedSpan } from '../types'

const ANTHROPIC_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 0.000015, output: 0.000075 },
  'claude-sonnet-4-6': { input: 0.000003, output: 0.000015 },
  'claude-haiku-4-5': { input: 0.00000025, output: 0.00000125 },
  'claude-3-opus': { input: 0.000015, output: 0.000075 },
  'claude-3-sonnet': { input: 0.000003, output: 0.000015 },
  'claude-3-haiku': { input: 0.00000025, output: 0.00000125 },
  'claude-3-5-sonnet': { input: 0.000003, output: 0.000015 },
  'claude-3-5-haiku': { input: 0.000001, output: 0.000005 },
}

function lookupCost(model: string): { input: number; output: number } {
  if (ANTHROPIC_COSTS[model]) return ANTHROPIC_COSTS[model]
  for (const key of Object.keys(ANTHROPIC_COSTS)) {
    if (model.startsWith(key)) return ANTHROPIC_COSTS[key]
  }
  return { input: 0, output: 0 }
}

function extractInputText(request: Record<string, unknown> | null): string {
  if (!request) return ''
  const parts: string[] = []
  if (typeof request.system === 'string') parts.push(request.system)
  const messages = request.messages
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') parts.push(content)
      else if (Array.isArray(content)) {
        for (const block of content) {
          const text = (block as { text?: unknown }).text
          if (typeof text === 'string') parts.push(text)
        }
      }
    }
  }
  return parts.join('\n')
}

function extractOutputText(response: Record<string, unknown> | null): string {
  if (!response) return ''
  const content = response.content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as { type?: string; text?: string }
        return b.type === 'text' && typeof b.text === 'string' ? b.text : ''
      })
      .join('')
  }
  return ''
}

export function parseAnthropic(args: {
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  isStream: boolean
}): ParsedSpan {
  const { request, response, isStream } = args
  const model = (response?.model as string) ?? (request?.model as string) ?? 'unknown'
  const usage = (response?.usage ?? {}) as { input_tokens?: number; output_tokens?: number }

  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const totalTokens = inputTokens + outputTokens
  const cost = lookupCost(model)

  return {
    model,
    provider: 'anthropic',
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText: extractOutputText(response),
    isStream,
  }
}

export function parseAnthropicStream(args: {
  request: Record<string, unknown> | null
  outputText: string
  usage: { input_tokens?: number; output_tokens?: number }
}): ParsedSpan {
  const { request, outputText, usage } = args
  const model = (request?.model as string) ?? 'unknown'
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cost = lookupCost(model)

  return {
    model,
    provider: 'anthropic',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText,
    isStream: true,
  }
}
