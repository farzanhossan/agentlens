import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { matchHostPath } from '../registry'
import type { Transport } from '../transport'
import type { LLMEndpoint } from '../types'

/**
 * Intercepts Node `http` and `https` outbound requests so axios, got,
 * node-fetch v2, etc. are auto-traced.
 *
 * Body capture strategy: we hook `http.IncomingMessage.prototype.push`,
 * which is what the HTTP parser calls to deliver decoded body bytes to the
 * stream. This is the AUTHORITATIVE source — calling `res.on('data', ...)`
 * from a second listener can race with the consumer (e.g. axios) and yield
 * partial/garbled bytes on Node 22+. Hooking `.push` gives us the same
 * bytes the parser produced, before any flowing-mode delivery starts.
 *
 * Works in both CJS and ESM bundles because we use static `import` for
 * `node:http`/`node:https` instead of `require()` (which tsup's ESM
 * polyfill turns into a throwing stub).
 */

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

// Maps a native IncomingMessage instance → list of body chunks captured
// from the HTTP parser. WeakMap so we don't leak after the response is GC'd.
const responseChunkRegistry = new WeakMap<object, Buffer[]>()
let incomingMessagePatched = false

export function patchHttps(transport: Transport): void {
  patchIncomingMessage()
  patchModule(http as unknown as PatchableModule, 'http', transport)
  patchModule(https as unknown as PatchableModule, 'https', transport)
}

function patchIncomingMessage(): void {
  if (incomingMessagePatched) return
  // http.IncomingMessage and https.IncomingMessage share a prototype — patch once.
  const IncomingMessage = http.IncomingMessage
  if (!IncomingMessage?.prototype) return
  const proto = IncomingMessage.prototype
  // Do NOT bind — we need to invoke the original with the IncomingMessage
  // instance as `this` (so it can read its internal Symbol(kState)).
  // Disable lint because `this` is the runtime receiver, exactly what we want.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalPush = proto.push
  proto.push = function patchedPush(
    chunk: Buffer | string | null,
    encoding?: BufferEncoding,
  ): boolean {
    if (chunk !== null) {
      const chunks = responseChunkRegistry.get(this as object)
      if (chunks) {
        try {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk)
          } else if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk, encoding ?? 'utf8'))
          } else if (chunk && typeof chunk === 'object') {
            // Uint8Array, ArrayBuffer view — Buffer.from accepts these
            chunks.push(Buffer.from(chunk as unknown as Uint8Array))
          }
        } catch {
          // never let our instrumentation break the user's request
        }
      }
    }
    return originalPush.call(this, chunk as never, encoding as never)
  }
  incomingMessagePatched = true
}

function patchModule(
  mod: PatchableModule,
  name: 'http' | 'https',
  transport: Transport,
): void {
  if (mod.__agentlens_patched) return

  const original: RequestFn = mod.request.bind(mod)
  mod.request = function patchedRequest(...args: unknown[]): unknown {
    const ctx = extractContext(args)
    if (!ctx) return original(...args)

    const start = Date.now()
    const requestChunks: Buffer[] = []

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

    // prependListener so we run BEFORE axios's response handler — axios
    // deletes res.headers['content-encoding'] before piping through its
    // own zlib decompressor, so by the time a normal listener fires the
    // encoding is gone and we can't know to decompress the captured bytes.
    req.prependListener('response', (...resArgs: unknown[]) => {
      const res = resArgs[0] as NodeJS.ReadableStream & {
        statusCode?: number
        headers?: Record<string, string | undefined>
        on: (event: string, listener: (...a: unknown[]) => void) => unknown
      }

      // Snapshot content-encoding HERE (before axios deletes it).
      const contentEncoding = (res.headers?.['content-encoding'] ?? '').toLowerCase()

      // Register this response for body capture via IncomingMessage.push hook.
      const chunks: Buffer[] = []
      responseChunkRegistry.set(res as unknown as object, chunks)

      res.on('end', () => {
        const latency = Date.now() - start
        const requestText = Buffer.concat(requestChunks).toString('utf8')
        const rawResponse = Buffer.concat(chunks)
        const responseText = decompressIfNeeded(rawResponse, contentEncoding).toString('utf8')
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
        responseChunkRegistry.delete(res as unknown as object)
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
  // Suppress unused-name lint — we keep the param for clarity in stack traces.
  void name
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

  if (
    args.length > 1 &&
    typeof args[1] === 'object' &&
    args[1] !== null &&
    !(args[1] instanceof URL)
  ) {
    const opts = args[1] as RequestOptions
    if (!host) host = opts.hostname ?? opts.host
    if (!path || path === '/') path = opts.path ?? path
  }

  if (!host || !path) return null
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

/**
 * Decompress a captured response body when the original `content-encoding`
 * header was set. axios and similar libraries decompress transparently for
 * the caller, but we observe the raw bytes coming off the wire — if we
 * don't decompress, JSON.parse fails and no span is emitted.
 */
function decompressIfNeeded(buf: Buffer, encoding: string): Buffer {
  if (!buf.length) return buf
  try {
    switch (encoding) {
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(buf)
      case 'deflate':
        // Try the wrapped (zlib-headers) form first, then raw deflate.
        try {
          return zlib.inflateSync(buf)
        } catch {
          return zlib.inflateRawSync(buf)
        }
      case 'br':
        return zlib.brotliDecompressSync(buf)
      default:
        return buf
    }
  } catch {
    // If decompression fails, fall back to raw bytes — JSON.parse will
    // likely fail too and we just skip the span rather than crash.
    return buf
  }
}
