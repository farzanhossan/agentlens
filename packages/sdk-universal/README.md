# @farzanhossans/agentlens

Universal AI agent observability — **one line** to trace every LLM call.

Patches `globalThis.fetch` and Node's `http`/`https` so every call to OpenAI,
Anthropic, Gemini, Cohere, or Mistral is captured automatically. No SDK
wrappers. No code changes inside your call sites.

## Install

```bash
pnpm add @farzanhossans/agentlens
# or: npm i @farzanhossans/agentlens
```

## Quickstart

### 1. Cloud — zero config

```ts
import { AgentLens } from '@farzanhossans/agentlens'

AgentLens.init({
  apiKey:    'proj_xxx',                          // from your dashboard
  projectId: '00000000-0000-0000-0000-000000000000',
})
```

### 2. Self-hosted — point at your own ingest endpoint

```ts
import { AgentLens } from '@farzanhossans/agentlens'

AgentLens.init({
  apiKey:    'proj_xxx',
  projectId: '<your-project-uuid>',
  endpoint:  'https://agentlens.your-company.com/v1/spans',
})
```

### 3. Debug mode — logs each captured span to stdout

```ts
AgentLens.init({
  apiKey:    'proj_xxx',
  projectId: '<your-project-uuid>',
  debug:     true,
})
```

### 4. Disable PII scrubbing (only for trusted internal data)

```ts
AgentLens.init({
  apiKey:    'proj_xxx',
  projectId: '<your-project-uuid>',
  pii:       false,
})
```

## What gets captured

Each emitted span contains:

- `spanId`, `traceId`, `parentSpanId?` (auto-linked by `trace()`)
- `projectId`, `name` (e.g. `openai.chat`, `anthropic.messages`)
- `provider`, `model`
- `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`
- `input` and `output` text (PII-scrubbed by default)
- `latencyMs`, `status` (`success | error | timeout`)
- `startedAt`, `endedAt`, `metadata` (carries `httpStatus`)
- `isStream` flag — streaming responses are tapped via `ReadableStream.tee()`
  (fetch) or `IncomingMessage.push` hook (axios/got/node-fetch) so the bytes
  the user reads are unchanged. Brotli/gzip/deflate responses are auto-decompressed.

## Supported providers

All five providers support both streaming and non-streaming responses.

| Provider  | Hosts                                  | Endpoints                                                      | Streaming |
| --------- | -------------------------------------- | -------------------------------------------------------------- | --------- |
| OpenAI    | `api.openai.com`                       | `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`    | ✅        |
| Anthropic | `api.anthropic.com`                    | `/v1/messages`                                                 | ✅        |
| Gemini    | `generativelanguage.googleapis.com`    | `/v1beta/models`, `/v1/models`                                 | ✅        |
| Cohere    | `api.cohere.com`                       | `/v1/chat`, `/v1/generate`, `/v2/chat` (v1 + v2 stream shapes) | ✅        |
| Mistral   | `api.mistral.ai`                       | `/v1/chat/completions`                                         | ✅        |

## Grouping calls with `trace()`

Wrap a logical unit of work (an agent step, a multi-call retrieval, etc.) in
`AgentLens.trace(name, fn)`. Every LLM call inside `fn` — including async ones
and across nested traces — is auto-tagged with the same `traceId` and gets
`parentSpanId` set to the trace's span. Built on Node's `AsyncLocalStorage`,
so it composes with `Promise.all`, `setTimeout`, async generators, etc.

```ts
import { AgentLens } from '@farzanhossans/agentlens'

AgentLens.init({ apiKey: 'proj_xxx', projectId: '<your-project-uuid>' })

await AgentLens.trace('classify-then-rephrase', async () => {
  const classification = await openai.chat.completions.create({ ... })
  // ↑ span emitted with parentSpanId = the trace's spanId
  const rephrased = await anthropic.messages.create({ ... })
  // ↑ same trace, same parentSpanId
})
```

Nested traces nest:

```ts
await AgentLens.trace('outer', async () => {
  await AgentLens.trace('inner', async () => {
    await openai.chat.completions.create({ ... })
    // child of `inner`, which is child of `outer`, all sharing one traceId
  })
})
```

## PII scrubbing

Enabled by default. Strips emails, phone numbers, SSNs, credit cards, IPv4
addresses, and obvious API-key shapes from `input` / `output` before spans
leave your process. Pass `pii: false` to disable.

## Self-hosted flow

1. Deploy AgentLens via Docker Compose on your own server.
2. Open your own dashboard → create a project → copy the API key and project UUID.
3. `AgentLens.init({ apiKey, projectId, endpoint })` pointing at your own ingest URL.
4. Spans flow: your app → your worker → your DB. Nothing touches AgentLens cloud.

## API

```ts
AgentLens.init(config: {
  apiKey: string             // required — your project API key
  projectId: string          // required — your project UUID
  endpoint?: string          // default: https://ingest.agentlens.dev/v1/spans
  debug?: boolean            // default: false — log captured spans to stdout
  pii?: boolean              // default: true — scrub input/output text
  flushIntervalMs?: number   // default: 500
  maxBatchSize?: number      // default: 50
}): void

AgentLens.flush(): Promise<void>   // force-flush pending spans
AgentLens.shutdown(): void         // stop the flush timer

AgentLens.trace<T>(name: string, fn: () => Promise<T>): Promise<T>
// re-exports from @farzanhossans/agentlens-core:
getCurrentTrace(), getCurrentTraceId(), getCurrentSpanId(), runWithTrace(ctx, fn)
```

## Requirements

Node ≥ 18 (the SDK uses `AsyncLocalStorage`, `globalThis.fetch`, and `crypto.randomUUID`).

## License

MIT
