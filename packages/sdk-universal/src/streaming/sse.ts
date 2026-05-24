import type { LLMEndpoint, ParserName } from '../types'
import type { Transport } from '../transport'

/**
 * Normalized stream parse result. Each per-provider parser extracts the
 * provider's native event shape into this common form so the synthesizer
 * can rebuild the right non-streaming response shape per provider.
 */
interface ParsedStream {
  outputText: string
  inputTokens: number
  outputTokens: number
}

export async function captureSSEStream(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    llm: LLMEndpoint
    requestBody: Record<string, unknown> | null
    latency: number
    transport: Transport
  }
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let raw = ''

  try {
    let done = false
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      if (chunk.value) raw += decoder.decode(chunk.value, { stream: true })
    }
    raw += decoder.decode()
  } catch {
    return
  }

  const parsed = parseStream(raw, ctx.llm.parser)
  const response = synthesizeResponse(parsed, ctx.llm.parser, ctx.requestBody)

  ctx.transport.push({
    provider: ctx.llm.provider,
    parser: ctx.llm.parser,
    request: ctx.requestBody,
    response,
    latency: ctx.latency,
    status: 200,
    isStream: true,
  })
}

function parseStream(raw: string, parser: ParserName): ParsedStream {
  switch (parser) {
    case 'anthropic':
      return parseAnthropicSSE(raw)
    case 'gemini':
      return parseGeminiSSE(raw)
    case 'cohere':
      return parseCohereSSE(raw)
    case 'openai':
    case 'mistral':
      return parseOpenAISSE(raw)
  }
}

function parseOpenAISSE(raw: string): ParsedStream {
  let outputText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '' || data === '[DONE]') continue
    try {
      const evt = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; text?: string }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const choice = evt.choices?.[0]
      if (choice?.delta?.content) outputText += choice.delta.content
      else if (typeof choice?.text === 'string') outputText += choice.text
      if (evt.usage) {
        if (typeof evt.usage.prompt_tokens === 'number') inputTokens = evt.usage.prompt_tokens
        if (typeof evt.usage.completion_tokens === 'number') outputTokens = evt.usage.completion_tokens
      }
    } catch {
      continue
    }
  }

  return { outputText, inputTokens, outputTokens }
}

function parseAnthropicSSE(raw: string): ParsedStream {
  let outputText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '' || data === '[DONE]') continue
    try {
      const evt = JSON.parse(data) as {
        type?: string
        delta?: { type?: string; text?: string }
        message?: { usage?: { input_tokens?: number; output_tokens?: number } }
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
        outputText += evt.delta.text
      }
      const u = evt.message?.usage ?? evt.usage
      if (u) {
        if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens
        if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens
      }
    } catch {
      continue
    }
  }

  return { outputText, inputTokens, outputTokens }
}

/**
 * Gemini streaming events are an SSE-ish format where each `data: ` line
 * carries a full Gemini response chunk with `candidates[].content.parts[].text`
 * and optional `usageMetadata.{promptTokenCount, candidatesTokenCount}`.
 *
 * Some Gemini endpoints (alt=sse) wrap chunks in `data: `; others emit a
 * JSON array. We handle both: split on newlines, strip `data: ` prefix if
 * present, parse each JSON object.
 */
function parseGeminiSSE(raw: string): ParsedStream {
  let outputText = ''
  let inputTokens = 0
  let outputTokens = 0

  const candidates = extractGeminiJsonChunks(raw)
  for (const evt of candidates) {
    const evtCandidates = (evt as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates
    if (Array.isArray(evtCandidates)) {
      for (const c of evtCandidates) {
        const parts = c.content?.parts
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p.text === 'string') outputText += p.text
          }
        }
      }
    }
    const usage = (evt as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata
    if (usage) {
      if (typeof usage.promptTokenCount === 'number') inputTokens = usage.promptTokenCount
      if (typeof usage.candidatesTokenCount === 'number') outputTokens = usage.candidatesTokenCount
    }
  }

  return { outputText, inputTokens, outputTokens }
}

function extractGeminiJsonChunks(raw: string): unknown[] {
  const out: unknown[] = []
  // Format 1: SSE `data: {...}` lines
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const body = line.slice(6).trim()
    if (!body || body === '[DONE]') continue
    try {
      out.push(JSON.parse(body))
    } catch {
      continue
    }
  }
  if (out.length > 0) return out
  // Format 2: a single JSON array of chunks
  try {
    const parsed = JSON.parse(raw.trim()) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    // fall through
  }
  return out
}

/**
 * Cohere streaming covers two shapes:
 * - v1 (`/v1/chat` with `stream: true`): newline-delimited JSON, each line
 *   `{event_type: "text-generation", text: "..."}` plus a final
 *   `{event_type: "stream-end", response: {meta: {billed_units: {...}}}}`.
 * - v2 (`/v2/chat`): SSE-style `event: content-delta` / `message-end` with
 *   `data: {delta: {message: {content: {text}}}}` and final
 *   `data: {delta: {usage: {tokens: {input_tokens, output_tokens}}}}`.
 */
function parseCohereSSE(raw: string): ParsedStream {
  let outputText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const body = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed
    if (!body || body === '[DONE]' || body.startsWith('event:')) continue
    let evt: Record<string, unknown>
    try {
      evt = JSON.parse(body) as Record<string, unknown>
    } catch {
      continue
    }

    // v1 text-generation event
    if (evt.event_type === 'text-generation' && typeof evt.text === 'string') {
      outputText += evt.text
    }
    // v1 stream-end carries the final response with meta.billed_units
    if (evt.event_type === 'stream-end') {
      const resp = evt.response as
        | { meta?: { billed_units?: { input_tokens?: number; output_tokens?: number } } }
        | undefined
      const billed = resp?.meta?.billed_units
      if (billed) {
        if (typeof billed.input_tokens === 'number') inputTokens = billed.input_tokens
        if (typeof billed.output_tokens === 'number') outputTokens = billed.output_tokens
      }
    }

    // v2 content-delta
    const delta = evt.delta as
      | { message?: { content?: { text?: string } }; usage?: { tokens?: { input_tokens?: number; output_tokens?: number } } }
      | undefined
    const text = delta?.message?.content?.text
    if (typeof text === 'string') outputText += text
    const tokens = delta?.usage?.tokens
    if (tokens) {
      if (typeof tokens.input_tokens === 'number') inputTokens = tokens.input_tokens
      if (typeof tokens.output_tokens === 'number') outputTokens = tokens.output_tokens
    }
  }

  return { outputText, inputTokens, outputTokens }
}

function synthesizeResponse(
  parsed: ParsedStream,
  parser: ParserName,
  request: Record<string, unknown> | null
): Record<string, unknown> {
  const model = (request?.model as string) ?? 'unknown'
  switch (parser) {
    case 'anthropic':
      return {
        model,
        content: [{ type: 'text', text: parsed.outputText }],
        usage: {
          input_tokens: parsed.inputTokens,
          output_tokens: parsed.outputTokens,
        },
      }
    case 'openai':
    case 'mistral':
      return {
        model,
        choices: [{ message: { content: parsed.outputText, role: 'assistant' } }],
        usage: {
          prompt_tokens: parsed.inputTokens,
          completion_tokens: parsed.outputTokens,
          total_tokens: parsed.inputTokens + parsed.outputTokens,
        },
      }
    case 'gemini':
      return {
        modelVersion: model,
        candidates: [{ content: { parts: [{ text: parsed.outputText }] } }],
        usageMetadata: {
          promptTokenCount: parsed.inputTokens,
          candidatesTokenCount: parsed.outputTokens,
          totalTokenCount: parsed.inputTokens + parsed.outputTokens,
        },
      }
    case 'cohere':
      // Use v1 meta.billed_units shape — the non-streaming Cohere parser
      // reads meta.billed_units first, then falls back to usage.tokens.
      return {
        text: parsed.outputText,
        meta: {
          billed_units: {
            input_tokens: parsed.inputTokens,
            output_tokens: parsed.outputTokens,
          },
        },
      }
  }
}
