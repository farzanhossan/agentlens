<div align="center">

```
    _                    _   _
   / \   __ _  ___ _ __ | |_| |    ___ _ __  ___
  / _ \ / _` |/ _ \ '_ \| __| |   / _ \ '_ \/ __|
 / ___ \ (_| |  __/ | | | |_| |__|  __/ | | \__ \
/_/   \_\__, |\___|_| |_|\__|_____\___|_| |_|___/
        |___/
```

**AI Agent Observability Platform**

[![npm](https://img.shields.io/npm/v/@farzanhossans/agentlens-core?color=6366f1&label=npm)](https://www.npmjs.com/package/@farzanhossans/agentlens-core)
[![npm](https://img.shields.io/npm/v/@farzanhossans/agentlens-core?label=%40agentlens%2Fcore)](https://www.npmjs.com/package/@farzanhossans/agentlens-core)
[![npm](https://img.shields.io/npm/v/@farzanhossans/agentlens-openai?label=%40agentlens%2Fopenai)](https://www.npmjs.com/package/@farzanhossans/agentlens-openai)
[![npm downloads](https://img.shields.io/npm/dm/@farzanhossans/agentlens-core)](https://www.npmjs.com/package/@farzanhossans/agentlens-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-passing-22c55e.svg)](#)
[![Tests](https://img.shields.io/badge/tests-96%2F96-22c55e.svg)](#)
[![Discord](https://img.shields.io/badge/discord-join-6366f1.svg)](https://discord.gg/agentlens)

</div>

AgentLens gives you full visibility into every LLM call your AI agent makes — traces, costs, failures, and session replay. In 3 lines of code.

<!-- Demo GIF here -->
![AgentLens Demo](./docs/demo.gif)

---

## Features

- 🔭 **Trace Viewer** — full input/output timeline across every span in your agent run
- 💰 **Cost Analytics** — token usage broken down by agent, model, feature, and user
- 🚨 **Failure Alerts** — Slack or email the moment an agent errors or times out
- ⏪ **Session Replay** — step through any past run exactly as it happened
- 🔒 **PII Scrubbing** — sensitive data auto-masked before it leaves your infrastructure (GDPR ready)
- 🔌 **Framework Agnostic** — OpenAI, Anthropic, LangChain, LlamaIndex, or fully custom

---

## Quick Start

### TypeScript / Node.js

```bash
npm install @farzanhossans/agentlens-core @farzanhossans/agentlens-openai
```

```typescript
import { AgentLens } from '@farzanhossans/agentlens-core'
import '@farzanhossans/agentlens-openai'

AgentLens.init({ apiKey: 'proj_xxx', projectId: 'your-project-uuid' })

// That's it. Every OpenAI call is now traced automatically.
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Summarise this ticket...' }],
})
```

### Python

```bash
pip install agentlens
```

```python
from agentlens import AgentLens
import agentlens.patchers.openai  # auto-patches the openai SDK

AgentLens.init(api_key='proj_xxx', project='my-agent')

# Every OpenAI call is now traced
response = openai.chat.completions.create(
    model='gpt-4o',
    messages=[{'role': 'user', 'content': 'Summarise this ticket...'}],
)
```

### Manual tracing (fine-grained control)

```typescript
const result = await AgentLens.trace('classify-intent', async (span) => {
  span.setInput(JSON.stringify({ userMessage }))
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

## SDK Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@farzanhossans/agentlens-core`](./packages/sdk-core) | Core tracer — framework agnostic | `npm i @farzanhossans/agentlens-core` |
| [`@farzanhossans/agentlens-openai`](./packages/sdk-openai) | OpenAI auto-instrumentation | `npm i @farzanhossans/agentlens-openai` |
| [`@farzanhossans/agentlens-anthropic`](./packages/sdk-anthropic) | Anthropic auto-instrumentation | `npm i @farzanhossans/agentlens-anthropic` |
| `@farzanhossans/agentlens-langchain` | LangChain callback handler | `npm i @farzanhossans/agentlens-langchain` |
| [`agentlens`](./packages/sdk-python) | Python SDK | `pip install agentlens` |

---

## Self-Hosting

### Production (Docker Compose — recommended)

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

### Development

```bash
git clone https://github.com/farzanhossan/agentlens
cd agentlens
cp apps/api/.env.example apps/api/.env
# Fill in secrets, then:
docker compose -f infra/docker-compose.yml up -d   # postgres, redis, elasticsearch
pnpm install && pnpm dev
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| API | http://localhost:3001 |

See [docs/deployment.md](./docs/deployment.md) for advanced production deployment on DigitalOcean, Cloudflare Workers, and Vercel.

---

## Architecture

```
SDK (your app)
    │
    │  POST /v1/spans  (batched, gzip-compressed)
    ▼
CF Worker (edge)              ← HMAC auth, rate-limit, validation
    │
    │  BullMQ job enqueue
    ▼
NestJS Span Processor         ← PII scrubbing, cost calculation
    │
    ├──► PostgreSQL            ← trace/span metadata, alerts, users
    └──► Elasticsearch         ← full input/output text, full-text search

NestJS Dashboard API          ← REST + WebSocket (live updates)
    │
    ▼
React Dashboard               ← trace viewer, cost charts, session replay
```

---

## Environment Variables

Configure `apps/api/.env` (copy from `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | HTTP port the API binds to |
| `HOST` | No | `0.0.0.0` | Host the API listens on |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin for the dashboard |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `DATABASE_SSL` | No | `false` | Set `true` to enable SSL for managed Postgres (e.g. RDS) |
| `DATABASE_POOL_MAX` | No | `20` | Max DB connection pool size |
| `DATABASE_POOL_MIN` | No | `2` | Min DB connection pool size |
| `REDIS_HOST` | **Yes** | — | Redis hostname (BullMQ) |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password (leave empty for no auth) |
| `ELASTICSEARCH_URL` | **Yes** | — | Elasticsearch node URL (`http://localhost:9200`) |
| `ELASTICSEARCH_USERNAME` | No | `elastic` | Elasticsearch username |
| `ELASTICSEARCH_PASSWORD` | **Yes** | — | Elasticsearch password |
| `HMAC_SECRET` | **Yes** | — | 32-byte secret for ingest-worker HMAC verification. Generate: `openssl rand -hex 32` |
| `JWT_SECRET` | **Yes** | — | Secret for JWT signing. Generate: `openssl rand -hex 32` |
| `RESEND_API_KEY` | No | — | [Resend](https://resend.com) API key for email alerts |
| `ALERT_EMAIL_FROM` | No | — | Sender address for email alerts (e.g. `alerts@yourdomain.com`) |

---

## Contributing

We welcome PRs. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

```bash
# Fork → clone → install
git clone https://github.com/YOUR_USERNAME/agentlens
pnpm install

# Create a feature branch
git checkout -b feat/my-feature

# Run tests
pnpm test

# Lint + format
pnpm lint && pnpm format
```

- **Code style:** ESLint + Prettier (auto-enforced, no arguments)
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)
- **Tests:** every new feature needs a matching test

---

## Roadmap

- [ ] LangChain auto-patcher
- [ ] LlamaIndex auto-patcher
- [ ] Prompt versioning
- [ ] A/B testing for prompts
- [ ] Cost budgets + auto-shutoff
- [ ] Multi-region support

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

---

<div align="center">

Built by [Farzan Hossan](https://github.com/farzanhossan)

</div>
