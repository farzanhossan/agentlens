Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are writing the GitHub README and all open source SDK documentation for AgentLens.

Create these files:

---

## FILE 1 — README.md (project root)

Write a world-class open source README. Model it after the quality of
Prisma, Resend, and Upstash READMEs. Developer-first, zero fluff.

Structure:

### Header
- AgentLens logo (ASCII art or badge-style text)
- Tagline: "AI Agent Observability Platform"
- Badges row:
  - npm version (@agentlens/core)
  - License: MIT
  - Build: passing
  - Tests: 47/47
  - Discord (placeholder)

### One-liner
"AgentLens gives you full visibility into every LLM call your AI agent makes —
traces, costs, failures, and session replay. In 3 lines of code."

### Quick Demo GIF placeholder
```
<!-- Demo GIF here -->
![AgentLens Demo](./docs/demo.gif)
```

### Features list (with emojis)
- 🔭 Trace Viewer — full input/output timeline
- 💰 Cost Analytics — per agent/model/feature breakdown
- 🚨 Failure Alerts — Slack + email notifications
- ⏪ Session Replay — step through any past agent run
- 🔒 PII Scrubbing — auto-mask sensitive data (GDPR ready)
- 🔌 Framework Agnostic — OpenAI, Anthropic, LangChain, LlamaIndex, custom

### Quick Start

#### TypeScript / Node.js
```bash
npm install @agentlens/core @agentlens/openai
```

```typescript
import { AgentLens } from '@agentlens/core'
import '@agentlens/openai'

AgentLens.init({ apiKey: 'proj_xxx' })

// That's it. Every OpenAI call is now traced automatically.
const response = await openai.chat.completions.create({ ... })
```

#### Python
```bash
pip install agentlens
```

```python
from agentlens import AgentLens
import agentlens.patchers.openai  # auto-patches

AgentLens.init(api_key='proj_xxx', project='my-agent')

# Every OpenAI call is now traced
response = openai.chat.completions.create(...)
```

#### Manual tracing (fine-grained control)
```typescript
const result = await AgentLens.trace('classify-intent', async (span) => {
  span.setInput({ userMessage })
  const res = await openai.chat.completions.create({ ... })
  span.setOutput(res.choices[0].message.content)
  return res
})
```

### SDK Packages table
| Package | Description | Install |
|---------|-------------|---------|
| @agentlens/core | Core tracer — framework agnostic | npm i @agentlens/core |
| @agentlens/openai | OpenAI auto-instrumentation | npm i @agentlens/openai |
| @agentlens/anthropic | Anthropic auto-instrumentation | npm i @agentlens/anthropic |
| @agentlens/langchain | LangChain callback handler | npm i @agentlens/langchain |
| agentlens (Python) | Python SDK | pip install agentlens |

### Self-Hosting
```bash
git clone https://github.com/farzanhossan/agentlens
cd agentlens
cp apps/api/.env.example apps/api/.env
# Fill in your values
docker-compose -f infra/docker-compose.yml up -d
pnpm install && pnpm dev
```

Dashboard: http://localhost:5173
API: http://localhost:3000

### Architecture diagram (ASCII)
```
SDK (your app)
    │
    │  POST /v1/spans (batched, gzip)
    ▼
CF Worker (edge)          ← HMAC auth, rate limit
    │
    │  BullMQ job
    ▼
NestJS Span Processor     ← PII scrub, cost calc
    │
    ├──► PostgreSQL        ← metadata, traces, spans
    └──► Elasticsearch     ← full payloads, search

NestJS Dashboard API      ← REST + WebSocket
    │
    ▼
React Dashboard           ← trace viewer, cost charts, replay
```

### Environment Variables table
Full table of all env vars for apps/api/.env with description and example value

### Contributing section
- Fork → feature branch → PR
- Run tests: pnpm test
- Code style: ESLint + Prettier (auto-enforced)
- Commit format: conventional commits

### Roadmap
- [ ] LangChain auto-patcher
- [ ] LlamaIndex auto-patcher
- [ ] Prompt versioning
- [ ] A/B testing for prompts
- [ ] Cost budgets + auto-shutoff
- [ ] Multi-region support

### License
MIT — free for personal and commercial use

### Built by
Farzan Hossan — github.com/farzanhossan

---

## FILE 2 — packages/sdk-core/README.md

Focused SDK docs:
- What it does
- Install
- Full API reference with TypeScript signatures:
  - AgentLens.init(config)
  - AgentLens.trace(name, fn)
  - AgentLens.flush()
  - Span methods: setInput, setOutput, setMetadata, setError
- Config options table (all fields, defaults, descriptions)
- PII scrubbing — what gets detected and redacted
- How batching and transport works
- Graceful shutdown example

---

## FILE 3 — packages/sdk-openai/README.md

- What it does (auto-patches OpenAI SDK)
- Install + init (2 lines)
- What gets captured automatically:
  - chat.completions.create (streaming + non-streaming)
  - completions.create (legacy)
  - embeddings.create
- Pricing table — all supported models with cost per 1k tokens
- How to unpatch (for testing)
- Known limitations

---

## FILE 4 — CONTRIBUTING.md (project root)

- Project structure overview
- Local dev setup (step by step)
- Running tests
- Adding a new SDK patcher (step by step guide)
- PR checklist
- Code of conduct (short)

---

## FILE 5 — docs/deployment.md

Production deployment guide:
- DigitalOcean (recommended — step by step)
- Cloudflare Workers deploy (ingest-worker)
- Vercel deploy (dashboard + landing page)
- Environment variables for production
- Setting up SSL
- Monitoring the deployment
- Backup strategy for PostgreSQL

---

Requirements:
- All files in proper Markdown with correct heading hierarchy
- Code blocks with correct language tags for syntax highlighting
- All links relative and correct for the repo structure
- README badges use shields.io format
- Write as if this is going on the front page of a popular GitHub repo
