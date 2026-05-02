import type { LLMEndpoint, ParserName } from '../types'
import type { Transport } from '../transport'

interface OpenAIStreamUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

interface AnthropicStreamUsage {
  input_tokens?: number
  output_tokens?: number
}

interface ParsedStream {
  outputText: string
  usage: Record<string, number | undefined>
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

  // Synthesize a response shape compatible with each parser
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
  if (parser === 'anthropic') return parseAnthropicSSE(raw)
  return parseOpenAISSE(raw)
}

function parseOpenAISSE(raw: string): ParsedStream {
  let outputText = ''
  let usage: OpenAIStreamUsage = {}

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '' || data === '[DONE]') continue
    try {
      const evt = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; text?: string }>
        usage?: OpenAIStreamUsage
      }
      const choice = evt.choices?.[0]
      if (choice?.delta?.content) outputText += choice.delta.content
      else if (typeof choice?.text === 'string') outputText += choice.text
      if (evt.usage) usage = evt.usage
    } catch {
      continue
    }
  }

  return { outputText, usage: usage as Record<string, number | undefined> }
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
        message?: { usage?: AnthropicStreamUsage }
        usage?: AnthropicStreamUsage
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

  return {
    outputText,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
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
          input_tokens: parsed.usage.input_tokens ?? 0,
          output_tokens: parsed.usage.output_tokens ?? 0,
        },
      }
    case 'openai':
    case 'mistral':
      return {
        model,
        choices: [{ message: { content: parsed.outputText, role: 'assistant' } }],
        usage: {
          prompt_tokens: parsed.usage.prompt_tokens ?? 0,
          completion_tokens: parsed.usage.completion_tokens ?? 0,
          total_tokens:
            parsed.usage.total_tokens ??
            (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0),
        },
      }
    case 'gemini':
      return {
        modelVersion: model,
        candidates: [{ content: { parts: [{ text: parsed.outputText }] } }],
        usageMetadata: {
          promptTokenCount: parsed.usage.prompt_tokens ?? 0,
          candidatesTokenCount: parsed.usage.completion_tokens ?? 0,
          totalTokenCount:
            (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0),
        },
      }
    case 'cohere':
      return {
        text: parsed.outputText,
        meta: {
          billed_units: {
            input_tokens: parsed.usage.input_tokens ?? 0,
            output_tokens: parsed.usage.output_tokens ?? 0,
          },
        },
      }
  }
}
