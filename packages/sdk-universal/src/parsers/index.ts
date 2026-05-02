import type { ParsedSpan, ParserName } from '../types'
import { parseAnthropic } from './anthropic'
import { parseCohere } from './cohere'
import { parseGemini } from './gemini'
import { parseMistral } from './mistral'
import { parseOpenAI } from './openai'

export { parseAnthropic, parseAnthropicStream } from './anthropic'
export { parseCohere } from './cohere'
export { parseGemini } from './gemini'
export { parseMistral } from './mistral'
export { parseOpenAI, parseOpenAIStream } from './openai'

export function parseSpan(args: {
  parser: ParserName
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  isStream: boolean
}): ParsedSpan {
  switch (args.parser) {
    case 'openai':
      return parseOpenAI(args)
    case 'anthropic':
      return parseAnthropic(args)
    case 'gemini':
      return parseGemini(args)
    case 'cohere':
      return parseCohere(args)
    case 'mistral':
      return parseMistral(args)
  }
}
