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
[![Tests](https://img.shields.io/badge/tests-96%2F96-22c55e.svg)](#)
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
OPENAI_BASE_URL=http://localhost:8080/v1/p/{projectId}/openai
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
Token usage and dollar cost broken down by model, agent, feature, and date. Daily trend charts. Monthly budget tracking with alerts.

### Failure Alerts
Get notified via Slack, email, or webhook the moment something goes wrong:
- **Error rate** spikes above threshold
- **Cost** exceeds budget in a time window
- **P95 latency** crosses SLA
- **Failure count** hits limit

Alert history with delivery status tracking. Test notifications before going live.

### Live Feed
Real-time trace stream via WebSocket. Watch agent calls as they happen.

### Session Replay
Step through any past agent run exactly as it happened. Group traces by session to see multi-turn conversations.

### PII Scrubbing
Emails, API keys, SSNs, and credit card numbers are auto-masked before data leaves your infrastructure. GDPR ready.

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
| Dashboard | http://localhost:3000 |
| API | http://localhost:3001 |
| Proxy | http://localhost:8080 |

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
  └──► Elasticsearch               ← full input/output text, full-text search

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
pnpm test       # 96 tests across all packages
pnpm lint       # ESLint + Prettier
```

---

## Roadmap

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
