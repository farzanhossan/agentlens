/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { patchHttps } from '../interceptors/https'
import { LLM_REGISTRY } from '../registry'
import type { Transport } from '../transport'

/**
 * The https interceptor matches on hostname against LLM_REGISTRY. We register
 * 127.0.0.1 as an OpenAI-like endpoint for the duration of these tests.
 *
 * Crucially we use `require('http')` rather than ESM `import * as http`:
 * the patcher mutates the CJS exports object, and an ESM namespace import
 * holds a different reference. Real CJS-based HTTP clients (axios, got,
 * node-fetch v2) go through `require('http')`, so this test mirrors them.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type HttpModule = typeof import('http')
const http = require('http') as HttpModule
const TEST_HOST = '127.0.0.1'

describe('patchHttps', () => {
  let server: Server
  let port = 0
  let savedEntry: (typeof LLM_REGISTRY)[string] | undefined
  let lastRequestBody = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        lastRequestBody = Buffer.concat(chunks).toString('utf8')
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            model: 'gpt-4o-mini',
            choices: [{ message: { content: 'hi back', role: 'assistant' } }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, TEST_HOST, resolve))
    port = (server.address() as AddressInfo).port

    savedEntry = LLM_REGISTRY[TEST_HOST]
    LLM_REGISTRY[TEST_HOST] = {
      provider: 'openai',
      parser: 'openai',
      paths: ['/v1/chat/completions'],
    }
  })

  afterAll(async () => {
    if (savedEntry === undefined) {
      delete LLM_REGISTRY[TEST_HOST]
    } else {
      LLM_REGISTRY[TEST_HOST] = savedEntry
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('intercepts http.request, buffers req body, parses res body, emits span', async () => {
    const transport = { push: vi.fn(), pushError: vi.fn() }
    patchHttps(transport as unknown as Transport)

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: TEST_HOST,
          port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          res.on('data', () => undefined)
          res.on('end', () => resolve())
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      req.write(JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }))
      req.end()
    })

    // Give the interceptor's end listener a tick to run after the test's end listener
    await new Promise((r) => setTimeout(r, 20))

    expect(lastRequestBody).toContain('"role":"user"')
    expect(transport.push).toHaveBeenCalledTimes(1)
    const payload = transport.push.mock.calls[0][0] as {
      provider: string
      parser: string
      request: Record<string, unknown>
      response: Record<string, unknown>
      status: number
      isStream: boolean
    }
    expect(payload.provider).toBe('openai')
    expect(payload.status).toBe(200)
    expect(payload.isStream).toBe(false)
    expect((payload.response as { usage: { prompt_tokens: number } }).usage.prompt_tokens).toBe(3)
  })

  it('does not double-patch — second patchHttps is a no-op', () => {
    const transport = { push: vi.fn(), pushError: vi.fn() }
    patchHttps(transport as unknown as Transport)
    const httpMod = require('http') as { __agentlens_patched?: boolean }
    expect(httpMod.__agentlens_patched).toBe(true)
    patchHttps(transport as unknown as Transport)
    expect(httpMod.__agentlens_patched).toBe(true)
  })

  it('passes non-LLM requests through unintercepted', async () => {
    const transport = { push: vi.fn(), pushError: vi.fn() }
    patchHttps(transport as unknown as Transport)

    const noopServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.end('{}')
    })
    await new Promise<void>((resolve) => noopServer.listen(0, TEST_HOST, resolve))
    const noopPort = (noopServer.address() as AddressInfo).port

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { hostname: TEST_HOST, port: noopPort, path: '/some/other/path', method: 'GET' },
        (res) => {
          res.on('data', () => undefined)
          res.on('end', () => resolve())
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      req.end()
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(transport.push).not.toHaveBeenCalled()
    await new Promise<void>((resolve) => noopServer.close(() => resolve()))
  })
})
