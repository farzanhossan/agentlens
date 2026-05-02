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

### 1. Cloud — zero config (default)

```ts
import { AgentLens } from '@farzanhossans/agentlens'

AgentLens.init({ apiKey: 'proj_xxx' })
```

### 2. Self-hosted — point at your own ingest endpoint

```ts
import { AgentLens } from '@farzanhossans/agentlens'

AgentLens.init({
  apiKey: 'proj_xxx', // key from your own AgentLens dashboard
  endpoint: 'https://agentlens.your-company.com/v1/spans',
})
```

### 3. Self-hosted + debug mode (logs each captured span to stdout)

```ts
AgentLens.init({
  apiKey: 'proj_xxx',
  endpoint: 'https://agentlens.your-company.com/v1/spans',
  debug: true,
})
```

### 4. Disable PII scrubbing (only for trusted internal data)

```ts
AgentLens.init({
  apiKey: 'proj_xxx',
  pii: false,
})
```

## What gets captured

For every matched LLM HTTP call:

- `provider` and `model`
- `inputTokens`, `outputTokens`, `totalTokens`
- `costUsd` (calculated from a built-in price table per provider)
- `inputText` and `outputText` (PII-scrubbed by default)
- `latency` and `status`
- `isStream` flag — streaming responses are tapped via `ReadableStream.tee()` so
  the stream you read is byte-identical to the original

## Supported providers

| Provider  | Hosts                                  | Endpoints                                                      |
| --------- | -------------------------------------- | -------------------------------------------------------------- |
| OpenAI    | `api.openai.com`                       | `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`    |
| Anthropic | `api.anthropic.com`                    | `/v1/messages`                                                 |
| Gemini    | `generativelanguage.googleapis.com`    | `/v1beta/models`, `/v1/models`                                 |
| Cohere    | `api.cohere.com`                       | `/v1/chat`, `/v1/generate`, `/v2/chat`                         |
| Mistral   | `api.mistral.ai`                       | `/v1/chat/completions`                                         |

## PII scrubbing

Enabled by default. Strips emails, phone numbers, SSNs, credit cards, IPv4
addresses, and obvious API-key shapes from `inputText` / `outputText` before
spans leave your process. Pass `pii: false` to disable.

## Self-hosted flow

1. Deploy AgentLens via Docker Compose on your own server
2. Open your own dashboard → create a project → copy the API key
3. `AgentLens.init({ apiKey, endpoint })` pointing at your own ingest URL
4. Spans flow: your app → your worker → your DB. Nothing touches AgentLens cloud.

## API

```ts
AgentLens.init(config: {
  apiKey: string
  endpoint?: string       // default: https://ingest.agentlens.dev/v1/spans
  debug?: boolean         // default: false
  pii?: boolean           // default: true
  flushIntervalMs?: number // default: 500
  maxBatchSize?: number   // default: 50
}): void

AgentLens.flush(): Promise<void>   // force-flush pending spans
AgentLens.shutdown(): void         // stop the flush timer
```

## License

MIT
