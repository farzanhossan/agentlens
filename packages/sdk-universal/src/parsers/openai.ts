import type { ParsedSpan } from '../types'

const OPENAI_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0000025, output: 0.000010 },
  'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
  'gpt-4-turbo': { input: 0.000010, output: 0.000030 },
  'gpt-4': { input: 0.000030, output: 0.000060 },
  'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },
  'text-embedding-3-small': { input: 0.00000002, output: 0 },
  'text-embedding-3-large': { input: 0.00000013, output: 0 },
}

function lookupCost(model: string): { input: number; output: number } {
  if (OPENAI_COSTS[model]) return OPENAI_COSTS[model]
  // Permit version-suffixed model names like "gpt-4o-2024-08-06"
  for (const key of Object.keys(OPENAI_COSTS)) {
    if (model.startsWith(key)) return OPENAI_COSTS[key]
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
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content
            .map((part) => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
            .join('')
        }
        return ''
      })
      .join('\n')
  }
  if (typeof request.prompt === 'string') return request.prompt
  if (Array.isArray(request.input)) return (request.input as unknown[]).map((x) => String(x)).join('\n')
  if (typeof request.input === 'string') return request.input
  return ''
}

function extractOutputText(response: Record<string, unknown> | null): string {
  if (!response) return ''
  const choices = response.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: { content?: string }; text?: string }
    if (first.message?.content) return first.message.content
    if (typeof first.text === 'string') return first.text
  }
  // embeddings: no text output
  return ''
}

export function parseOpenAI(args: {
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
  const costUsd = inputTokens * cost.input + outputTokens * cost.output

  return {
    model,
    provider: 'openai',
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    inputText: extractInputText(request),
    outputText: extractOutputText(response),
    isStream,
  }
}

export function parseOpenAIStream(args: {
  request: Record<string, unknown> | null
  outputText: string
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}): ParsedSpan {
  const { request, outputText, usage } = args
  const model = (request?.model as string) ?? 'unknown'
  const inputTokens = usage.prompt_tokens ?? 0
  const outputTokens = usage.completion_tokens ?? 0
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens
  const cost = lookupCost(model)

  return {
    model,
    provider: 'openai',
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText,
    isStream: true,
  }
}
