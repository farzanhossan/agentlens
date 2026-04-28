<div align="center">

```
    _                    _   _
   / \   __ _  ___ _ __ | |_| |    ___ _ __  ___
  / _ \ / _` |/ _ \ '_ \| __| |   / _ \ '_ \/ __|
 / ___ \ (_| |  __/ | | | |_| |__|  __/ | | \__ \
/_/   \_\__, |\___|_| |_|\__|_____\___|_| |_|___/
        |___/
```

**Open-source observability for AI agents**

See every LLM call, what it cost, and why it failed — without changing your code.

[![npm](https://img.shields.io/npm/v/@farzanhossans/agentlens-core?color=6366f1&label=npm)](https://www.npmjs.com/package/@farzanhossans/agentlens-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-passing-22c55e.svg)](#)
[![Tests](https://img.shields.io/badge/tests-81%2F81-22c55e.svg)](#)
[![Discord](https://img.shields.io/badge/discord-join-6366f1.svg)](https://discord.gg/agentlens)

</div>

---

## Why AgentLens?

You're building AI agents that make dozens of LLM calls per session. Something breaks in production. You have no idea which call failed, how much it cost, or what the model actually said.

AgentLens fixes that. Point your LLM traffic at the proxy, and you get full visibility — traces, costs, errors, and session replay — **without touching your application code**.

---

## How It Works

AgentLens sits between your app and the LLM provider. There are three ways to integrate, from zero effort to full control:

### Option 1: Proxy (zero code changes)

Just change your base URL. That's it. No SDK, no imports, no wrappers.

```bash
# Before — your app talks directly to OpenAI
OPENAI_BASE_URL=https://api.openai.com

# After — route through AgentLens proxy
OPENAI_BASE_URL=http://localhost:8090/v1/p/{projectId}/openai
```

Every request is forwarded to OpenAI (or Anthropic), and AgentLens automatically captures the trace, tokens, cost, latency, and full input/output — then shows it all in the dashboard.

Works with **any language, any framework, any HTTP client**. If it can call an API, it works with AgentLens.

**Supported providers:**

| Provider | Proxy path |
|----------|-----------|
| OpenAI | `/v1/p/{projectId}/openai/v1/chat/completions` |
| Anthropic | `/v1/p/{projectId}/anthropic/v1/messages` |
| Any LLM API | `/v1/p/{projectId}/custom/...` + `X-AgentLens-Upstream` header |

Streaming responses are fully supported — AgentLens buffers transparently without adding latency.

**Trace grouping (optional):** If your agent makes multiple LLM calls per turn, you can group them into a single trace by passing optional headers:

| Header | Purpose |
|--------|---------|
| `X-AgentLens-Trace-Id` | Shared trace ID — all requests with the same value appear under one trace |
| `X-AgentLens-Parent-Span-Id` | Links this span as a child of a parent span |
| `X-AgentLens-Span-Name` | Custom span name (default: `openai.proxy`) |

These headers are stripped before forwarding to the LLM provider. Without them, each request creates its own trace — no change to existing behavior.

```typescript
// Example: group two LLM calls into one trace
const traceId = crypto.randomUUID()

// Call 1: extract data
await fetch(proxyUrl, {
  headers: { 'X-AgentLens-Trace-Id': traceId, 'X-AgentLens-Span-Name': 'extract-fields', ...auth },
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
})

// Call 2: generate response — same traceId
await fetch(proxyUrl, {
  headers: { 'X-AgentLens-Trace-Id': traceId, 'X-AgentLens-Span-Name': 'generate-reply', ...auth },
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
})
// Dashboard shows: 1 trace with 2 spans
```

Works with the SDK too — use `getCurrentTraceId()` and `getCurrentSpanId()` from `@farzanhossans/agentlens-core` to automatically propagate trace context.

### Option 2: SDK auto-instrumentation (one import)

If you want richer metadata or custom span names, add the SDK. One import auto-patches your LLM client:

```typescript
import { AgentLens } from '@farzanhossans/agentlens-core'
import '@farzanhossans/agentlens-openai'   // auto-patches OpenAI — that's it

AgentLens.init({ apiKey: 'proj_xxx', projectId: 'your-project-uuid' })

// Every OpenAI call is now traced automatically. No other changes needed.
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Summarise this ticket...' }],
})
```

```python
# Python — same idea
from agentlens import AgentLens
import agentlens.patchers.openai

AgentLens.init(api_key='proj_xxx', project_id='your-project-uuid')
# All OpenAI calls are now traced
```

### Option 3: Manual tracing (full control)

For complex agent flows where you want to name spans, add metadata, or create parent/child hierarchies:

```typescript
const result = await AgentLens.trace('classify-intent', async (span) => {
  span.setInput(JSON.stringify({ userMessage }))
  span.setMetadata('userId', user.id)

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: userMessage }],
  })

  span.setOutput(res.choices[0].message.content ?? '')
  return res
})
```

Nested `AgentLens.trace()` calls are automatically linked as parent/child spans.

---

## What You Get

### Trace Viewer
Full input/output timeline for every span in your agent run. See exactly what the model received and what it returned, with parent/child hierarchy.

### Cost Analytics
Token usage and dollar cost broken down by model, agent, and date. Instant aggregations across millions of spans powered by Elasticsearch. Monthly budget tracking with alerts.

### Error Clustering
Similar failures are auto-grouped with count badges and affected models. Spot patterns instantly instead of scrolling through logs. Powered by Elasticsearch `significant_terms` analysis.

### Full-Text Search
Search across all LLM prompts, completions, and agent names. Elasticsearch indexes every input/output with fuzzy matching — find the trace you need in seconds.

### Failure Alerts
Get notified via Slack, email, or webhook the moment something goes wrong:
- **Error rate** spikes above threshold
- **Cost** exceeds budget in a time window
- **P95 latency** crosses SLA
- **Failure count** hits limit

Real-time metric evaluation via Elasticsearch. Alert history with delivery status tracking. Test notifications before going live.

### Live Feed
Real-time trace stream via WebSocket. Watch agent calls as they happen.

### Session Replay
Step through any past agent run exactly as it happened. Group traces by session to see multi-turn conversations.

### Data Lifecycle Management
Automatic index lifecycle management with hot/warm/cold/delete phases. Per-project retention policies configurable from the dashboard (1–365 days). Old data is cleaned up automatically.

### PII Scrubbing
Emails, API keys, SSNs, and credit card numbers are auto-masked before data leaves your infrastructure. GDPR ready.

### System Health Monitoring
Sidebar indicator shows Elasticsearch status in real-time. When ES is unavailable, all analytics automatically fall back to PostgreSQL — zero downtime.

---

## Self-Hosting

Everything runs with a single `docker compose` command. No third-party accounts needed — no Vercel, no Cloudflare, no managed services.

```bash
git clone https://github.com/farzanhossan/agentlens
cd agentlens/infra
cp .env.prod.example .env
# Generate secrets: openssl rand -hex 32  →  paste into JWT_SECRET and HMAC_SECRET
docker compose -f docker-compose.prod.yml up -d --build
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:4021 |
| API | http://localhost:4020 |
| Proxy | http://localhost:8090 |

**Requirements:** Docker, 4 GB RAM.

The stack includes PostgreSQL, Redis, Elasticsearch, the API, dashboard, and proxy — all containerised.

See [docs/deployment.md](./docs/deployment.md) for custom domains, SSL, backups, monitoring, and production hardening.

### Development setup

```bash
git clone https://github.com/farzanhossan/agentlens
cd agentlens
cp apps/api/.env.example apps/api/.env   # fill in secrets
docker compose -f infra/docker-compose.yml up -d
pnpm install && pnpm dev
```

---

## Architecture

```
Your App
  │
  │  Option A: change base URL (proxy)
  │  Option B: import SDK (auto-patch)
  │  Option C: manual AgentLens.trace()
  ▼
AgentLens Proxy / SDK
  │
  │  POST /v1/spans  (batched, gzip-compressed)
  ▼
NestJS API                        ← BullMQ async processing
  │
  ├──► PII Scrubber               ← masks sensitive data
  ├──► Cost Calculator             ← per-model pricing tables
  ├──► Alert Engine                ← evaluates thresholds, sends notifications
  │
  ├──► PostgreSQL                  ← traces, spans, alerts, users, projects
  └──► Elasticsearch               ← full-text search, aggregations, error clustering
        │                             (ILM: hot → warm → cold → delete)
        └──► PG fallback             ← auto-failover when ES is unavailable

React Dashboard                   ← trace viewer, cost charts, live feed, alerts
  │
  └──► WebSocket (Socket.io)       ← real-time trace updates
```

---

## SDK Packages

The proxy covers most use cases with zero code changes. Use the SDKs when you want richer control:

| Package | Description | Install |
|---------|-------------|---------|
| [`@farzanhossans/agentlens-core`](./packages/sdk-core) | Core tracer — manual spans, context propagation | `npm i @farzanhossans/agentlens-core` |
| [`@farzanhossans/agentlens-openai`](./packages/sdk-openai) | Auto-patches OpenAI SDK (chat, completions, embeddings) | `npm i @farzanhossans/agentlens-openai` |
| [`@farzanhossans/agentlens-anthropic`](./packages/sdk-anthropic) | Auto-patches Anthropic SDK | `npm i @farzanhossans/agentlens-anthropic` |
| [`agentlens`](./packages/sdk-python) | Python SDK with decorators + auto-patchers | `pip install agentlens` |

---

## What Gets Captured

**Per LLM call (span):**

| Metric | Source |
|--------|--------|
| Input/output tokens | LLM response headers |
| Cost (USD) | Built-in pricing tables (OpenAI, Anthropic) |
| Latency | Request start → response end |
| Status | success / error / timeout |
| Model + provider | Parsed from request |
| Full prompt + completion | Stored in Elasticsearch (PII-scrubbed) |
| Error message | Captured on failure |
| Custom metadata | Your key-value pairs |

**Per trace (agent run):**

| Metric | Description |
|--------|-------------|
| Total spans | Number of LLM calls in the run |
| Total tokens | Sum across all spans |
| Total cost | Sum across all spans |
| Total latency | End-to-end duration |
| Agent name | Identifier for the agent |
| Session ID | Group multi-turn conversations |
| Span hierarchy | Parent/child relationships |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS, Fastify, TypeORM, BullMQ |
| Frontend | React 18, Vite, Recharts, TailwindCSS |
| Proxy | Hono (Node.js) |
| Database | PostgreSQL + Elasticsearch + Redis |
| SDKs | TypeScript (Node + browser), Python |
| Auth | JWT + bcrypt |
| Real-time | Socket.io (WebSocket) |
| Build | pnpm workspaces, Turborepo, tsup |

---

## Contributing

We welcome PRs. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

```bash
git clone https://github.com/YOUR_USERNAME/agentlens
pnpm install
pnpm test       # 81 tests across all packages
pnpm lint       # ESLint + Prettier
```

---

## Roadmap

- [x] Elasticsearch-powered aggregations and analytics
- [x] Error clustering and pattern detection
- [x] Full-text search across prompts and completions
- [x] Index lifecycle management (ILM) with rolling indices
- [x] Per-project data retention policies
- [x] Proxy trace grouping via optional headers
- [ ] LangChain auto-patcher
- [ ] LlamaIndex auto-patcher
- [ ] Prompt versioning and diffing
- [ ] A/B testing for prompts
- [ ] Cost budgets with auto-shutoff
- [ ] Multi-region support

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

---

<div align="center">

Built by [Farzan Hossan](https://github.com/farzanhossan)

</div>
