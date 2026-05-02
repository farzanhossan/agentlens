import type { ParsedSpan } from '../types'

const MISTRAL_COSTS: Record<string, { input: number; output: number }> = {
  'mistral-large': { input: 0.000002, output: 0.000006 },
  'mistral-medium': { input: 0.0000027, output: 0.0000081 },
  'mistral-small': { input: 0.0000002, output: 0.0000006 },
  'open-mistral-7b': { input: 0.00000025, output: 0.00000025 },
  'open-mixtral-8x7b': { input: 0.0000007, output: 0.0000007 },
  'open-mixtral-8x22b': { input: 0.000002, output: 0.000006 },
}

function lookupCost(model: string): { input: number; output: number } {
  if (MISTRAL_COSTS[model]) return MISTRAL_COSTS[model]
  for (const key of Object.keys(MISTRAL_COSTS)) {
    if (model.startsWith(key)) return MISTRAL_COSTS[key]
  }
  return { input: 0, output: 0 }
}

function extractInputText(request: Record<string, unknown> | null): string {
  if (!request) return ''
  const messages = request.messages
  if (Array.isArray(messages)) {
    return messages
      .map((m) => {
        const content = (m as { content?: unknown }).content
        return typeof content === 'string' ? content : ''
      })
      .join('\n')
  }
  return ''
}

function extractOutputText(response: Record<string, unknown> | null): string {
  if (!response) return ''
  const choices = response.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: { content?: string } }
    if (first.message?.content) return first.message.content
  }
  return ''
}

export function parseMistral(args: {
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  isStream: boolean
}): ParsedSpan {
  const { request, response, isStream } = args
  const model = (response?.model as string) ?? (request?.model as string) ?? 'unknown'

  const usage = (response?.usage ?? {}) as {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  const inputTokens = usage.prompt_tokens ?? 0
  const outputTokens = usage.completion_tokens ?? 0
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens
  const cost = lookupCost(model)

  return {
    model,
    provider: 'mistral',
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText: extractOutputText(response),
    isStream,
  }
}
