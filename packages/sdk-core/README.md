# @agentlens/core

[![npm](https://img.shields.io/npm/v/@agentlens/core?color=6366f1)](https://www.npmjs.com/package/@agentlens/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1.svg)](../../LICENSE)

The framework-agnostic core tracer for AgentLens. Handles span lifecycle, batching, gzip transport, PII scrubbing, and async context propagation.

> **Looking for auto-instrumentation?** See [`@agentlens/openai`](../sdk-openai) or [`@agentlens/anthropic`](../sdk-anthropic) to trace without changing your LLM call sites.

---

## Install

```bash
npm install @agentlens/core
# or
pnpm add @agentlens/core
# or
yarn add @agentlens/core
```

---

## Quick Start

```typescript
import { AgentLens } from '@agentlens/core'

AgentLens.init({
  apiKey: 'proj_live_abc123',
  projectId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
})

const answer = await AgentLens.trace('answer-question', async (span) => {
  span.setInput(userQuestion)
  const result = await myLLMCall(userQuestion)
  span.setOutput(result.text)
  return result
})
```

---

## API Reference

### `AgentLens.init(config)`

Initialises the SDK. Must be called once before any tracing. Safe to call multiple times — subsequent calls are no-ops unless `shutdown()` has been called first.

```typescript
AgentLens.init(config: AgentLensConfig): void
```

#### Config options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | `string` | **Yes** | — | Your project API key (`proj_live_…`). Sent as `X-API-Key` header on every flush. |
| `projectId` | `string` | **Yes** | — | Your AgentLens project UUID. Attached to every span. |
| `endpoint` | `string` | No | `https://ingest.agentlens.dev` | Ingest endpoint. Override for self-hosted deployments. |
| `flushIntervalMs` | `number` | No | `500` | How often (ms) the span buffer is flushed to the ingest endpoint. |
| `maxBatchSize` | `number` | No | `100` | Maximum spans per flush batch. Flush triggers early if this is reached. |
| `redactPII` | `boolean` | No | `false` | When `true`, PII patterns are scrubbed from `input` and `output` before the span is queued. |

---

### `AgentLens.trace(name, fn)`

Wraps an async function in a named span. Automatically handles timing, error recording, and async context so nested calls become child spans.

```typescript
AgentLens.trace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>
```

**Example — nested spans:**

```typescript
const result = await AgentLens.trace('handle-ticket', async (outer) => {
  outer.setInput(ticketText)

  // This becomes a child span of 'handle-ticket'
  const intent = await AgentLens.trace('classify-intent', async (inner) => {
    inner.setInput(ticketText)
    const res = await openai.chat.completions.create({ ... })
    inner.setOutput(res.choices[0].message.content ?? '')
    return res.choices[0].message.content
  })

  outer.setOutput(`Classified as: ${intent}`)
  return intent
})
```

**Behaviour:**
- If `fn` throws, the span is marked `status: 'error'` and the error is re-thrown.
- Spans are queued automatically; no manual `end()` call needed.
- Throws `Error` if `init()` has not been called.

---

### `AgentLens.flush()`

Flushes all buffered spans to the ingest endpoint immediately. Returns a promise that resolves when the HTTP request completes.

```typescript
AgentLens.flush(): Promise<void>
```

Useful before process exit or at the end of a Lambda invocation.

---

### `AgentLens.shutdown()`

Flushes remaining spans and tears down the flush interval. The SDK can be re-initialised with `init()` after shutdown.

```typescript
AgentLens.shutdown(): Promise<void>
```

---

### Span methods

The `Span` object passed to `AgentLens.trace()` callbacks — and returned by `new Span()` for manual use.

#### `span.setInput(data: string): this`

Stores the LLM prompt or tool input. Sent to Elasticsearch only (never stored in PostgreSQL).

```typescript
span.setInput(JSON.stringify(messages))
```

#### `span.setOutput(data: string): this`

Stores the LLM completion or tool output. Sent to Elasticsearch only.

```typescript
span.setOutput(response.choices[0].message.content ?? '')
```

#### `span.setModel(model: string, provider?: string): this`

Records which model and provider were used for this span.

```typescript
span.setModel('gpt-4o', 'openai')
span.setModel('claude-3-5-sonnet-20241022', 'anthropic')
```

#### `span.setTokens(inputTokens: number, outputTokens: number, costUsd?: number): this`

Records token counts and optionally the USD cost.

```typescript
span.setTokens(usage.prompt_tokens, usage.completion_tokens, 0.0045)
```

#### `span.setError(error: Error | string): this`

Marks the span as failed and records the error message. Sets `status` to `'error'`.

```typescript
span.setError(new Error('rate limit exceeded'))
```

#### `span.setMetadata(key: string, value: unknown): this`

Attaches arbitrary key-value metadata to the span.

```typescript
span.setMetadata('userId', req.user.id)
span.setMetadata('featureFlag', 'v2-prompt')
```

#### `span.end(): void`

Closes the span and records `endedAt` / `latencyMs`. Called automatically by `AgentLens.trace()` — only needed when using `new Span()` manually.

---

## PII Scrubbing

When `redactPII: true` is set in `init()`, the SDK scans `input` and `output` text before queuing the span and replaces detected patterns with `[REDACTED]`.

**Patterns detected:**

| Pattern | Example input | Redacted output |
|---------|--------------|-----------------|
| Email addresses | `user@example.com` | `[REDACTED_EMAIL]` |
| Phone numbers | `+1 (555) 867-5309` | `[REDACTED_PHONE]` |
| Credit card numbers | `4111 1111 1111 1111` | `[REDACTED_CC]` |
| Social Security Numbers | `123-45-6789` | `[REDACTED_SSN]` |
| IP addresses | `192.168.1.1` | `[REDACTED_IP]` |
| Bearer tokens / API keys | `Bearer sk-abc...` | `[REDACTED_TOKEN]` |

Scrubbing happens in-process before the span ever leaves your infrastructure, making it safe for GDPR and HIPAA workloads.

---

## Batching and Transport

Spans are buffered in-memory and flushed in batches to reduce HTTP overhead:

1. Every `flushIntervalMs` ms (default 500ms), the buffer is drained.
2. If the buffer reaches `maxBatchSize` spans (default 100), an early flush is triggered.
3. Each flush serialises spans to JSON, gzip-compresses the payload, and POSTs to `{endpoint}/v1/spans` with `Content-Encoding: gzip`.
4. The ingest endpoint (Cloudflare Worker) validates the HMAC signature, rate-limits the request, and enqueues a BullMQ job for async processing.

Failed flushes are logged to `console.warn` and **not** retried — spans are dropped rather than causing backpressure in your application.

---

## Graceful Shutdown

For long-running servers, `enableShutdownHooks()` handles SIGTERM automatically. For scripts and Lambda functions, call `shutdown()` explicitly:

```typescript
// AWS Lambda
export const handler = async (event: APIGatewayEvent) => {
  AgentLens.init({ apiKey: 'proj_xxx', projectId: 'my-fn' })

  try {
    return await processEvent(event)
  } finally {
    await AgentLens.flush() // ensure spans are sent before Lambda freezes
  }
}

// Long-running process
process.on('SIGTERM', async () => {
  await AgentLens.shutdown()
  process.exit(0)
})
```
