# AgentLens Network-Layer Proxy

**Date:** 2026-03-31
**Status:** Approved

## Overview

Add a transparent HTTP proxy to AgentLens that sits between user applications and LLM APIs. Users configure a single env var (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, etc.) to route traffic through the proxy. Zero code changes, zero SDK installation required.

The proxy captures LLM requests and responses, extracts structured observability data (model, messages, tokens, cost, latency), and emits spans to the existing AgentLens ingest pipeline.

## Motivation

- **Zero-code integration** — change one env var, get full observability
- **Language-agnostic** — works with any language or framework that speaks HTTP
- **Infrastructure-level capture** — monitors all LLM traffic, including third-party tools without SDK support

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Standalone service (`apps/proxy`) | Clean separation, independent scaling, streaming-friendly |
| Deployment | Cloud-hosted + self-hosted | Cloud for fast onboarding, self-hosted for enterprise/privacy |
| Auth/routing | Project ID in URL path | Zero-code — no extra headers or API key registration |
| Data captured | SDK parity first, HTTP-level later | Reuses existing pipeline, tight scope |
| Streaming | Pass-through with tap | Preserves streaming UX, zero added latency |
| SDK future | Proxy = default, SDK = power tool | Proxy for onboarding, SDK for custom spans/metadata |
| Providers at launch | OpenAI + Anthropic + generic passthrough | Covers majority of usage, generic fallback for everything else |

## URL Structure

```
https://proxy.agentlens.dev/v1/p/{projectId}/{provider}/{...path}
```

Examples:
- `https://proxy.agentlens.dev/v1/p/abc123/openai/v1/chat/completions`
- `https://proxy.agentlens.dev/v1/p/abc123/anthropic/v1/messages`
- `https://proxy.agentlens.dev/v1/p/abc123/generic/v1/completions`

User configuration:
```bash
OPENAI_BASE_URL=https://proxy.agentlens.dev/v1/p/abc123/openai
ANTHROPIC_BASE_URL=https://proxy.agentlens.dev/v1/p/abc123/anthropic
```

## High-Level Architecture

```
┌──────────────┐         ┌──────────────────────┐         ┌─────────────┐
│  User's App  │──HTTP──▶│   AgentLens Proxy     │──HTTP──▶│  LLM API    │
│              │◀─HTTP───│   (apps/proxy)         │◀─HTTP───│  (OpenAI,   │
│  Just set    │         │                        │         │  Anthropic, │
│  base_url    │         │  - Route by provider   │         │  etc.)      │
└──────────────┘         │  - Stream passthrough  │         └─────────────┘
                         │  - Parse req/res       │
                         │  - Emit spans          │
                         └──────────┬─────────────┘
                                    │ POST /v1/spans
                                    ▼
                         ┌──────────────────────┐
                         │  Existing Pipeline    │
                         │  (Ingest → BullMQ →   │
                         │   Processor → DB/ES)  │
                         └──────────────────────┘
```

The proxy is stateless. It does not store data — it emits spans to the existing ingest pipeline. No new databases, queues, or storage.

## Request Flow

1. **Route parsing** — Extract `projectId`, `provider`, and remaining `path` from the URL.
2. **Project validation** — Verify `projectId` exists via cached lookup (in-memory TTL cache, default 60s). Return `401` if invalid.
3. **Build upstream request** — Map provider to upstream base URL:
   - `openai` → `https://api.openai.com`
   - `anthropic` → `https://api.anthropic.com`
   - `generic` → requires `X-AgentLens-Upstream` header in the request (e.g., `https://my-ollama:11434`). If missing, return `400`.
   - Forward remaining path, all headers (Authorization, Content-Type, etc.), and body unchanged.
4. **Forward & capture:**
   - **Non-streaming:** Forward request, wait for response, parse, emit span, return response.
   - **Streaming:** Forward request, pipe SSE chunks to client in real-time, accumulate chunks internally. On stream end, reconstruct full response, parse, emit span.
5. **Span emission** — Construct span (same shape as SDK spans), POST to ingest endpoint async. Fire-and-forget — does not block the response.
6. **Error handling:**
   - Upstream error (4xx/5xx): forward to client as-is, emit span with `status: "error"`.
   - Proxy failure (can't reach upstream): return `502 Bad Gateway`, emit error span.
   - Span emission failure: log, do not affect the user's request.

**Key guarantee:** The proxy never breaks the user's LLM call. Tracing failures are silent.

## Streaming Implementation

**Detection:** Check `"stream": true` in request body via the provider parser's `isStreaming()`.

**Pass-through with tap:**
- Read upstream response as a readable stream.
- Use a `TransformStream` tee: one branch pipes to client, the other accumulates into a buffer.
- Client receives chunks with zero added latency.
- On stream end (SSE `[DONE]` or connection close), parse accumulated buffer and emit span.

**Edge cases:**
- Client disconnects mid-stream: abort upstream request, emit partial span with `status: "timeout"`.
- Upstream error mid-stream: forward error chunk, emit span with `status: "error"`.
- Very long streams: cap accumulation buffer at 10MB. If exceeded, still forward to client but emit span with truncated output and `metadata.truncated: true`.

## Provider Parsers

All parsers implement a shared interface:

```typescript
interface ProviderParser {
  parseRequest(body: unknown): ParsedRequest
  parseResponse(body: unknown): ParsedResponse
  computeCost(model: string, usage: TokenUsage): number
  isStreaming(request: Request): boolean
  parseStreamChunks(chunks: string[]): ParsedResponse
}
```

### OpenAI Parser
- Endpoints: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`
- Request: extract `model`, `messages`, `stream` flag
- Response: extract `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`
- Streaming: parse `data: {...}` SSE lines, accumulate `delta.content`, grab `usage` from final chunk
- Cost: reuse pricing table from `sdk-openai`

### Anthropic Parser
- Endpoints: `/v1/messages`
- Request: extract `model`, `system`, `messages`
- Response: extract `content[0].text`, `usage.input_tokens`, `usage.output_tokens`
- Streaming: parse SSE events (`content_block_delta`, `message_delta`, `message_stop`)
- Cost: reuse pricing table from `sdk-anthropic`

### Generic Passthrough
- No structured parsing
- Captures: raw request body, raw response body, HTTP status, latency
- Stored as span with `provider: "generic"`, `model: "unknown"`
- Users get timing, success/failure, and raw payloads in Elasticsearch

Adding new providers = adding a new parser file. Proxy core unchanged.

## Deployment

### Cloud-hosted
- Deploy `apps/proxy` as a containerized service alongside existing API
- URL: `proxy.agentlens.dev`
- Connects to ingest endpoint internally (same network)

### Self-hosted
- Same Docker image, different env vars
- Run: `docker run -e AGENTLENS_INGEST_URL=https://api.agentlens.dev/v1/spans -p 8080:8080 agentlens/proxy`
- Or add to user's docker-compose as a sidecar

### Configuration (env vars)

```bash
# Required
AGENTLENS_INGEST_URL=...              # Where to send spans

# Optional
PORT=8080                              # Listen port
PROJECT_VALIDATION_URL=...             # Endpoint to validate project IDs
PROJECT_CACHE_TTL_MS=60000             # Cache TTL for project validation
MAX_BODY_SIZE=10mb                     # Request body size limit
BUFFER_MAX_SIZE=10mb                   # Streaming accumulation cap
LOG_LEVEL=info                         # Logging verbosity
```

### Project validation modes
- **Connected mode:** Proxy calls AgentLens API to validate project IDs
- **Standalone mode:** Skip validation, trust any project ID. For air-gapped setups.

## Codebase Integration

### What changes in existing code
Nothing. The proxy emits spans in the exact same format as the SDK. The existing ingest endpoint, BullMQ queue, span processor, DB schema, and ES indexing all work unchanged. Dashboard displays proxy spans identically to SDK spans.

### New files

```
apps/proxy/
  src/
    index.ts              — Hono app bootstrap
    router.ts             — Route parsing (/v1/p/{projectId}/{provider}/...)
    proxy.ts              — Core forwarding logic (non-streaming + streaming)
    parsers/
      types.ts            — Shared ProviderParser interface
      openai.ts           — OpenAI request/response parser
      anthropic.ts        — Anthropic parser
      generic.ts          — Passthrough fallback
    span-emitter.ts       — Async span emission to ingest endpoint
    project-cache.ts      — In-memory TTL cache for project validation
    config.ts             — Env var configuration
  Dockerfile              — Container build
  package.json
  tsconfig.json
```

### Monorepo structure after

```
apps/
  api/              ← unchanged
  proxy/            ← NEW
  ingest-worker/    ← unchanged
packages/
  sdk-core/         ← unchanged
  sdk-openai/       ← unchanged
  sdk-anthropic/    ← unchanged
```

## SDK Relationship

- **Proxy** = default onboarding path. Zero code changes, one env var.
- **SDK** = power tool for advanced users who need custom spans, trace grouping, metadata annotations.
- Both can be used together: proxy captures LLM calls, SDK adds custom instrumentation on top.
- SDK is not deprecated. Both paths coexist.

## Testing Strategy

### Unit tests
- Provider parsers: verify extraction from sample request/response payloads
- Stream chunk parsing: feed SSE chunks, verify reconstructed response
- Route parsing: verify projectId/provider/path extraction
- Cost calculation: verify pricing accuracy

### Integration tests
- Full proxy flow with mocked upstream: verify client response unchanged, span emitted correctly
- Streaming flow: verify real-time chunk delivery and span emission on stream end
- Error scenarios: upstream 429, 500, timeout, client disconnect

### End-to-end test
- Proxy + ingest pipeline via docker-compose
- Request through proxy to mock LLM API
- Verify span appears in database with correct data

## Future Enhancements (not in scope)

- HTTP-level telemetry (headers, rate-limit info, network latency)
- Cloudflare Worker edge layer in front of the proxy for global distribution
- Per-project custom upstream URLs in dashboard
- Request/response transformation (prompt injection detection, content filtering)
- WebSocket support for real-time model APIs
