import type { ParsedSpan } from '../types'

const COHERE_COSTS: Record<string, { input: number; output: number }> = {
  'command-r-plus': { input: 0.000003, output: 0.000015 },
  'command-r': { input: 0.0000005, output: 0.0000015 },
  'command': { input: 0.000001, output: 0.000002 },
  'command-light': { input: 0.0000003, output: 0.0000006 },
}

function lookupCost(model: string): { input: number; output: number } {
  if (COHERE_COSTS[model]) return COHERE_COSTS[model]
  for (const key of Object.keys(COHERE_COSTS)) {
    if (model.startsWith(key)) return COHERE_COSTS[key]
  }
  return { input: 0, output: 0 }
}

function extractInputText(request: Record<string, unknown> | null): string {
  if (!request) return ''
  if (typeof request.message === 'string') return request.message
  if (typeof request.prompt === 'string') return request.prompt
  const messages = request.messages
  if (Array.isArray(messages)) {
    return messages
      .map((m) => {
        const content = (m as { content?: unknown }).content
        if (typeof content === 'string') return content
        return ''
      })
      .join('\n')
  }
  return ''
}

function extractOutputText(response: Record<string, unknown> | null): string {
  if (!response) return ''
  if (typeof response.text === 'string') return response.text
  // v2 chat format: message.content[].text
  const message = response.message as { content?: Array<{ text?: string }> } | undefined
  if (message?.content && Array.isArray(message.content)) {
    return message.content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
  }
  // generate format
  const generations = response.generations
  if (Array.isArray(generations) && generations.length > 0) {
    const first = generations[0] as { text?: string }
    if (typeof first.text === 'string') return first.text
  }
  return ''
}

export function parseCohere(args: {
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  isStream: boolean
}): ParsedSpan {
  const { request, response, isStream } = args
  const model = (request?.model as string) ?? 'unknown'

  // Cohere v1 uses meta.billed_units {input_tokens, output_tokens}
  // Cohere v2 uses usage.tokens {input_tokens, output_tokens}
  const meta = (response?.meta ?? {}) as { billed_units?: { input_tokens?: number; output_tokens?: number } }
  const usage = (response?.usage ?? {}) as { tokens?: { input_tokens?: number; output_tokens?: number } }
  const tokens = meta.billed_units ?? usage.tokens ?? {}
  const inputTokens = tokens.input_tokens ?? 0
  const outputTokens = tokens.output_tokens ?? 0
  const cost = lookupCost(model)

  return {
    model,
    provider: 'cohere',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText: extractOutputText(response),
    isStream,
  }
}
