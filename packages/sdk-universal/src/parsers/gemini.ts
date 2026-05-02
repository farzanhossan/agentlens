import type { ParsedSpan } from '../types'

const GEMINI_COSTS: Record<string, { input: number; output: number }> = {
  'gemini-1.5-pro': { input: 0.00000125, output: 0.000005 },
  'gemini-1.5-flash': { input: 0.000000075, output: 0.0000003 },
  'gemini-1.0-pro': { input: 0.0000005, output: 0.0000015 },
  'gemini-pro': { input: 0.0000005, output: 0.0000015 },
}

function lookupCost(model: string): { input: number; output: number } {
  if (GEMINI_COSTS[model]) return GEMINI_COSTS[model]
  for (const key of Object.keys(GEMINI_COSTS)) {
    if (model.startsWith(key)) return GEMINI_COSTS[key]
  }
  return { input: 0, output: 0 }
}

function extractInputText(request: Record<string, unknown> | null): string {
  if (!request) return ''
  const contents = request.contents
  if (!Array.isArray(contents)) return ''
  const parts: string[] = []
  for (const c of contents) {
    const innerParts = (c as { parts?: unknown }).parts
    if (Array.isArray(innerParts)) {
      for (const p of innerParts) {
        const text = (p as { text?: unknown }).text
        if (typeof text === 'string') parts.push(text)
      }
    }
  }
  return parts.join('\n')
}

function extractOutputText(response: Record<string, unknown> | null): string {
  if (!response) return ''
  const candidates = response.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return ''
  const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } }
  const parts = first.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
}

export function parseGemini(args: {
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  isStream: boolean
  modelHint?: string
}): ParsedSpan {
  const { request, response, isStream, modelHint } = args
  const model =
    (response?.modelVersion as string) ??
    modelHint ??
    (request?.model as string) ??
    'unknown'

  const usage = (response?.usageMetadata ?? {}) as {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }

  const inputTokens = usage.promptTokenCount ?? 0
  const outputTokens = usage.candidatesTokenCount ?? 0
  const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens
  const cost = lookupCost(model)

  return {
    model,
    provider: 'gemini',
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: inputTokens * cost.input + outputTokens * cost.output,
    inputText: extractInputText(request),
    outputText: extractOutputText(response),
    isStream,
  }
}
