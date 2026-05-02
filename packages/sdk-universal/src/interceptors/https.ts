import { matchHostPath } from '../registry'
import type { Transport } from '../transport'
import type { LLMEndpoint } from '../types'

type RequestFn = (...args: unknown[]) => unknown

interface PatchableModule {
  request: RequestFn
  __agentlens_patched?: boolean
}

interface RequestOptions {
  host?: string
  hostname?: string
  path?: string
  method?: string
  headers?: Record<string, string>
}

export function patchHttps(transport: Transport): void {
  if (typeof process === 'undefined' || typeof require === 'undefined') {
    // Browser / non-Node — nothing to patch
    return
  }

  try {
    patchModule('https', transport)
    patchModule('http', transport)
  } catch {
    // require may be unavailable in some bundled environments — just skip
  }
}

function patchModule(name: 'http' | 'https', transport: Transport): void {
  let mod: PatchableModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require(name) as PatchableModule
  } catch {
    return
  }
  if (mod.__agentlens_patched) return

  const original: RequestFn = mod.request.bind(mod)
  mod.request = function patchedRequest(...args: unknown[]): unknown {
    const ctx = extractContext(args)
    if (!ctx) return original(...args)

    const start = Date.now()
    const requestChunks: Buffer[] = []
    const responseChunks: Buffer[] = []

    const req = original(...args) as NodeJS.WritableStream & {
      write: (chunk: unknown, ...rest: unknown[]) => boolean
      on: (event: string, listener: (...a: unknown[]) => void) => unknown
    }

    const originalWrite = req.write.bind(req)
    req.write = function (chunk: unknown, ...rest: unknown[]): boolean {
      try {
        if (chunk) requestChunks.push(toBuffer(chunk))
      } catch {
        // ignore
      }
      return originalWrite(chunk, ...(rest as []))
    }

    req.on('response', (...resArgs: unknown[]) => {
      const res = resArgs[0] as NodeJS.ReadableStream & {
        statusCode?: number
        on: (event: string, listener: (...a: unknown[]) => void) => unknown
      }
      res.on('data', (chunk: unknown) => {
        try {
          responseChunks.push(toBuffer(chunk))
        } catch {
          // ignore
        }
      })
      res.on('end', () => {
        const latency = Date.now() - start
        const requestText = Buffer.concat(requestChunks).toString('utf8')
        const responseText = Buffer.concat(responseChunks).toString('utf8')
        const requestBody = safeParse(requestText)
        const responseBody = safeParse(responseText)
        if (responseBody) {
          transport.push({
            provider: ctx.llm.provider,
            parser: ctx.llm.parser,
            request: requestBody,
            response: responseBody,
            latency,
            status: res.statusCode ?? 0,
            isStream: requestBody?.stream === true,
          })
        }
      })
    })

    req.on('error', (...errArgs: unknown[]) => {
      const err = errArgs[0] as Error | undefined
      const requestText = Buffer.concat(requestChunks).toString('utf8')
      transport.pushError({
        provider: ctx.llm.provider,
        request: safeParse(requestText),
        error: err?.message ?? String(err),
        latency: Date.now() - start,
      })
    })

    return req
  } as RequestFn
  mod.__agentlens_patched = true
}

interface ExtractedCtx {
  llm: LLMEndpoint
}

function extractContext(args: unknown[]): ExtractedCtx | null {
  // Signatures supported:
  //   request(url[, options][, callback])
  //   request(options[, callback])
  let host: string | undefined
  let path: string | undefined

  const first = args[0]
  if (typeof first === 'string') {
    try {
      const u = new URL(first)
      host = u.hostname
      path = u.pathname + u.search
    } catch {
      return null
    }
  } else if (first instanceof URL) {
    host = first.hostname
    path = first.pathname + first.search
  } else if (first && typeof first === 'object') {
    const opts = first as RequestOptions
    host = opts.hostname ?? opts.host
    path = opts.path ?? '/'
  }

  if (args.length > 1 && typeof args[1] === 'object' && args[1] !== null && !(args[1] instanceof URL)) {
    const opts = args[1] as RequestOptions
    if (!host) host = opts.hostname ?? opts.host
    if (!path || path === '/') path = opts.path ?? path
  }

  if (!host || !path) return null
  // Strip query for path-prefix matching
  const pathOnly = path.split('?')[0]
  const llm = matchHostPath(host, pathOnly)
  if (!llm) return null
  return { llm }
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk))
}

function safeParse(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}
