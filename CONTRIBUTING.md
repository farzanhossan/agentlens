# Contributing to AgentLens

Thanks for your interest in contributing. This document covers everything you need to go from zero to a merged PR.

---

## Project structure

```
agentlens/
├── apps/
│   ├── api/              # NestJS backend — span processor, dashboard API, alert engine
│   ├── dashboard/        # React + Vite frontend
│   ├── ingest-worker/    # Cloudflare Worker (Hono.js) — edge ingestion
│   └── landing/          # Static marketing landing page
├── packages/
│   ├── sdk-core/         # @agentlens/core — framework-agnostic tracer
│   ├── sdk-openai/       # @agentlens/openai — OpenAI auto-instrumentation
│   ├── sdk-anthropic/    # @agentlens/anthropic — Anthropic auto-instrumentation
│   └── sdk-python/       # agentlens — Python SDK
├── scripts/              # Developer utilities (seed-demo, reset-demo)
├── infra/                # Docker Compose, init SQL, nginx config
└── docs/                 # Deployment guides
```

The monorepo is managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/repo).

---

## Local development setup

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker + Docker Compose
- Python ≥ 3.9 (for Python SDK development)

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/farzanhossan/agentlens
cd agentlens

# 2. Install all dependencies
pnpm install

# 3. Start infrastructure (Postgres, Redis, Elasticsearch)
docker compose -f infra/docker-compose.yml up -d postgres redis elasticsearch

# 4. Configure environment
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — at minimum set HMAC_SECRET and JWT_SECRET:
#   HMAC_SECRET=$(openssl rand -hex 32)
#   JWT_SECRET=$(openssl rand -hex 32)

# 5. Start all apps in watch mode
pnpm dev
```

Services will be available at:

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| API | http://localhost:3000 |
| Swagger | http://localhost:3000/docs |
| Ingest Worker (local) | http://localhost:8787 |

### Seed demo data

```bash
pnpm seed:demo
# Login: demo@agentlens.dev / Demo1234!
```

---

## Running tests

```bash
# All tests (Node + Python)
pnpm test

# Node/TypeScript tests only
pnpm turbo run test

# Python SDK only
cd packages/sdk-python && pytest -v

# Single package
pnpm --filter @agentlens/api test
pnpm --filter @agentlens/openai test
```

All tests must pass before opening a PR. CI runs `pnpm turbo run build test lint` on every push.

---

## Adding a new SDK patcher

A "patcher" is a package that monkey-patches a third-party LLM SDK to auto-capture spans. Here's how to build one from scratch.

### 1. Scaffold the package

```bash
mkdir packages/sdk-myprovider
cd packages/sdk-myprovider
# Copy package.json and tsconfig.json from packages/sdk-openai as a template
```

`package.json` minimum:
```json
{
  "name": "@agentlens/myprovider",
  "version": "0.1.0",
  "main": "dist/index.js",
  "dependencies": {
    "@agentlens/core": "workspace:*"
  },
  "peerDependencies": {
    "myprovider-sdk": ">=1.0.0"
  }
}
```

### 2. Implement the patcher

```typescript
// src/patcher.ts
import { AgentLens, Span, getCurrentTraceId, getCurrentSpanId } from '@agentlens/core'
import { v4 as uuidv4 } from 'uuid'

type AnyFn = (...args: unknown[]) => unknown

interface PatchRecord {
  proto: object
  method: string
  original: AnyFn
}

export const patches: PatchRecord[] = []
let patched = false

function makeSpan(name: string): Span | null {
  const projectId = AgentLens._getProjectId()
  if (!projectId) return null
  const traceId = getCurrentTraceId() ?? uuidv4()
  return new Span(uuidv4(), traceId, name, projectId, getCurrentSpanId())
}

function patchMyMethod(proto: object): void {
  const record: PatchRecord = {
    proto,
    method: 'myMethod',
    original: (proto as Record<string, AnyFn>)['myMethod'],
  }
  patches.push(record)

  const patched = async function (this: unknown, params: MyParams) {
    if (!AgentLens._isInitialized()) return record.original.call(this, params)

    const span = makeSpan('myprovider.myMethod')
    if (!span) return record.original.call(this, params)

    span.setModel(params.model, 'myprovider')
    span.setInput(params.prompt)

    try {
      const result = await record.original.call(this, params) as MyResult
      span.setOutput(result.text)
      return result
    } catch (err) {
      span.setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
      AgentLens._pushSpan(span.toJSON())
    }
  }

  ;(proto as Record<string, unknown>)['myMethod'] = patched
}

export function patch(MyProviderClass?: typeof MyProvider): void {
  if (patched) return
  const Ctor = MyProviderClass ?? require('myprovider-sdk').MyProvider
  const client = new Ctor({ apiKey: '__probe__' })
  patchMyMethod(Object.getPrototypeOf(client.someResource) as object)
  patched = true
}

export function unpatch(): void {
  for (const { proto, method, original } of patches.splice(0)) {
    ;(proto as Record<string, unknown>)[method] = original
  }
  patched = false
}
```

### 3. Auto-patch on import

```typescript
// src/index.ts
export { patch, unpatch, patches } from './patcher.js'
import { patch } from './patcher.js'
patch() // runs when the package is imported
```

### 4. Write tests

See [`packages/sdk-openai/src/__tests__/patcher.test.ts`](./packages/sdk-openai/src/__tests__/patcher.test.ts) for the full test pattern. Key points:

- Pass the constructor explicitly to `patch(MyProviderClass)` to avoid ESM/CJS prototype mismatch
- Replace `patches[N].original` with a `vi.fn()` mock after calling `patch()`
- Call `unpatch()` in `afterEach` to restore the prototype

---

## PR checklist

Before opening a PR, confirm:

- [ ] `pnpm turbo run build` passes with no errors
- [ ] `pnpm turbo run test` — all tests pass
- [ ] `pnpm turbo run lint` — zero warnings (`--max-warnings 0`)
- [ ] New features have corresponding tests
- [ ] Public API changes are reflected in the package `README.md`
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `test:`

---

## Code of conduct

- Be respectful. Disagreement is fine; disrespect is not.
- Review feedback is about the code, not the person.
- Keep discussions in GitHub issues and PRs — not DMs.
- First-time contributors are welcome. We'll help you get unstuck.
