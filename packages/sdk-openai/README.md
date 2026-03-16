# @farzanhossans/agentlens-openai

[![npm](https://img.shields.io/npm/v/@farzanhossans/agentlens-openai?color=6366f1)](https://www.npmjs.com/package/@farzanhossans/agentlens-openai)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1.svg)](../../LICENSE)

Auto-instrumentation for the [OpenAI Node.js SDK](https://github.com/openai/openai-node). Monkey-patches the OpenAI prototype so every API call is traced — without changing a single line of your existing code.

---

## Install

```bash
npm install @farzanhossans/agentlens-core @farzanhossans/agentlens-openai
```

---

## Setup

```typescript
import { AgentLens } from '@farzanhossans/agentlens-core'
import '@farzanhossans/agentlens-openai'          // ← auto-patches on import

AgentLens.init({
  apiKey: 'proj_live_abc123',
  projectId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
})

// Nothing else needed. All calls below are now traced:
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const res = await openai.chat.completions.create({ model: 'gpt-4o', messages })
```

Import order matters: `@farzanhossans/agentlens-openai` must be imported before creating any `OpenAI` client instances.

---

## What gets captured automatically

### `chat.completions.create` — non-streaming

| Field | Source |
|-------|--------|
| `name` | `"openai.chat.completions"` |
| `model` | `params.model` |
| `provider` | `"openai"` |
| `input` | `JSON.stringify(params.messages)` |
| `output` | `choices[0].message.content` |
| `inputTokens` | `usage.prompt_tokens` |
| `outputTokens` | `usage.completion_tokens` |
| `costUsd` | Computed from model pricing table |
| `latencyMs` | Wall-clock time of the HTTP call |
| `status` | `"success"` or `"error"` |
| `errorMessage` | Error message if the call throws |

### `chat.completions.create` — streaming (`stream: true`)

The patcher wraps the returned `Stream<ChatCompletionChunk>` in an async generator that accumulates delta content. The span is closed when the stream is fully consumed.

Token counts are recorded from the final chunk when `stream_options: { include_usage: true }` is passed. Without it, token counts are omitted for streaming calls.

### `completions.create` — legacy text completions

| Field | Source |
|-------|--------|
| `name` | `"openai.completions"` |
| `input` | `params.prompt` (string prompts only) |
| `output` | `choices[0].text` |

### `embeddings.create`

| Field | Source |
|-------|--------|
| `name` | `"openai.embeddings"` |
| `input` | `params.input` (serialised to string if array) |
| `inputTokens` | `usage.prompt_tokens` |
| `costUsd` | Computed from model pricing table |

---

## Supported models and pricing

Cost is calculated automatically using the table below (USD per 1,000 tokens, as of 2024-Q2):

| Model | Input / 1k tokens | Output / 1k tokens |
|-------|------------------|--------------------|
| `gpt-4o` | $0.005 | $0.015 |
| `gpt-4o-mini` | $0.00015 | $0.0006 |
| `gpt-4-turbo` | $0.01 | $0.03 |
| `gpt-4` | $0.03 | $0.06 |
| `gpt-4-32k` | $0.06 | $0.12 |
| `gpt-3.5-turbo` | $0.0005 | $0.0015 |
| `gpt-3.5-turbo-instruct` | $0.0015 | $0.002 |
| `text-embedding-3-small` | $0.00002 | — |
| `text-embedding-3-large` | $0.00013 | — |
| `text-embedding-ada-002` | $0.0001 | — |

If a model isn't in the table, `costUsd` is recorded as `undefined`. Versioned model names (e.g. `gpt-4o-2024-05-13`) are normalised to their base name for pricing lookups.

---

## Unpatching (testing)

The patcher exposes `unpatch()` to restore the original OpenAI methods. Use this in test teardown:

```typescript
import { patch, unpatch, patches } from '@farzanhossans/agentlens-openai/patcher'
import OpenAI from 'openai'

beforeEach(() => {
  patch(OpenAI)  // pass the constructor to ensure correct ESM prototype
})

afterEach(() => {
  unpatch()
})
```

To mock the underlying OpenAI call in unit tests, replace `patches[N].original` after calling `patch()`:

```typescript
import { patches } from '@farzanhossans/agentlens-openai/patcher'
import { vi } from 'vitest'

// patches[0] = chat completions, patches[1] = legacy completions, patches[2] = embeddings
patches[0]!.original = vi.fn().mockResolvedValue(mockChatCompletion)
```

---

## Known limitations

- **`stream_options.include_usage`** must be explicitly set to `true` to capture token counts in streaming responses. OpenAI does not emit usage by default for streams.
- **Parallel tool calls** (`tool_calls` in the message) are recorded as part of the raw `output` JSON but not parsed into structured fields.
- **Images in messages** (`content: [{ type: 'image_url', ... }]`) are included in the serialised `input` and subject to PII scrubbing if `redactPII: true` is set.
- The patcher targets the **prototype chain** of the OpenAI class. If OpenAI releases a breaking SDK version that restructures the `chat.completions` resource, repatch may be needed.
