# AgentLens — Implementation History

> This file tracks every implementation phase, prompt, and outcome.
> Updated after every build session. Never delete entries — append only.

---

## How to Read This File

| Column | Meaning |
|--------|---------|
| Phase | Phase number and name |
| Prompt File | The `.md` file used with Claude CLI |
| Status | ✅ Done / 🔄 In Progress / ❌ Failed / ⏳ Pending |
| Date | When it was implemented |
| Notes | Key outcomes, issues found, decisions made |

---

## Phase 1 — Core Platform (COMPLETE ✅)

| # | What Was Built | Prompt File | Status | Date | Notes |
|---|---------------|------------|--------|------|-------|
| 1 | Monorepo scaffold | `01-monorepo-scaffold.md` | ✅ | - | pnpm + Turborepo, all packages wired |
| 2 | PostgreSQL schema | `02-postgres-schema.md` | ✅ | - | TypeORM entities, migrations |
| 3 | TypeScript SDK core | `03-sdk-core.md` | ✅ | - | `@farzanhossans/agentlens-core` published |
| 4 | OpenAI auto-patcher | `04-sdk-openai.md` | ✅ | - | Monkey-patches chat.completions + embeddings |
| 5 | Anthropic auto-patcher | `05-sdk-anthropic.md` | ✅ | - | ESLint unsafe error type fixed |
| 6 | Cloudflare ingest worker | `06-ingest-worker.md` | ✅ | - | Hono.js, forwards spans to NestJS |
| 7 | NestJS span processor | `07-span-processor.md` | ✅ | - | BullMQ queue, enrichment pipeline |
| 8 | Dashboard REST API | `08-dashboard-api.md` | ✅ | - | WebSocket support included |
| 9 | Alert engine | `09-alert-engine.md` | ✅ | - | Slack/email on failure/cost spikes |
| 10 | React dashboard | `10-react-dashboard.md` | ✅ | - | Dark theme, Recharts |
| 11 | Auth + API key mgmt | `11-auth.md` | ✅ | - | JWT + bcrypt |
| 12 | Python SDK | `12-sdk-python.md` | ✅ | - | Decorators + auto-patchers |
| 13 | Docker + CI/CD | `13-docker-cicd.md` | ✅ | - | GitHub Actions, DigitalOcean deploy |
| 14 | Landing page | `14-landing-page.md` | ✅ | - | Vercel deploy |
| 15 | npm publish | `15-npm-publish.md` | ✅ | - | Scope: `@farzanhossans` (with 's') |

### Phase 1 — Known Issues Resolved
- GitHub Actions CI failures in Python SDK tests → fixed
- ESLint errors in `sdk-anthropic/src/patch.ts` → fixed unsafe error handling
- Docker build context errors → Dockerfile uses repo root as context
- Vercel `--prebuilt` without `vercel build` → fixed deploy order
- Cloudflare KV placeholder → switched to in-memory rate limiting
- Redis unhealthy → reduced Elasticsearch heap to 256m + grace periods
- Port 3000 conflict on droplet → changed host port to 4020
- pnpm lockfile out of sync after removing `@upstash/redis` → fixed

### Phase 1 — Production Deployment
| Service | Platform | URL/Notes |
|---------|----------|-----------|
| API Stack | DigitalOcean (4GB droplet) | Port 4020, docker-compose.prod.yml |
| Dashboard | Vercel | Auto-deploy on push |
| Landing Page | Vercel | Auto-deploy on push |
| Ingest Worker | Cloudflare Workers | Forwards to NestJS |

### Phase 1 — Known Technical Debt
- [ ] Migrate all prod secrets into GitHub Secrets (only `WORKER_SECRET` + `HMAC_SECRET` exist there now)
- [ ] `infra/.env.production` must be created manually on first deploy — backup/restore pattern in deploy script
- [ ] Elasticsearch unit economics at scale — review before growth
- [ ] PII scrubbing architecture decisions before prod traffic scales

---

## Phase 2 — Universal SDK (🔄 IN PROGRESS)

> **Goal:** Network-level interception. Developer adds 1 line. Every LLM call traced automatically — no SDK-specific patchers needed.

| # | What To Build | Prompt File | Status | Date | Notes |
|---|--------------|------------|--------|------|-------|
| 1 | `registry.ts` — LLM endpoint map | `23-universal-registry.md` | ✅ | 2026-05-01 | OpenAI, Anthropic, Gemini, Cohere, Mistral. `matchLLM()` is `try`-wrapped → returns `null` on bad URLs instead of throwing |
| 2 | `parsers/` — OpenAI + Anthropic | `23-universal-registry.md` | ✅ | 2026-05-01 | Cost lookup walks model-prefix fallbacks so version-suffixed names (e.g. `gpt-4o-2024-08-06`) still cost-out |
| 3 | `interceptors/fetch.ts` | `24-fetch-interceptor.md` | ✅ | 2026-05-01 | Patches `globalThis.fetch`. Stashes original on `globalThis.__agentlens_originalFetch` so transport flushes don't recurse through the patcher. Double-patch guarded |
| 4 | `interceptors/https.ts` | `25-https-interceptor.md` | ✅ | 2026-05-01 | Patches Node `http` + `https` `request()`. Buffers req body via `req.write` shim, parses on `res.end` — covers axios, got, node-fetch v2 |
| 5 | `streaming/sse.ts` | `26-streaming-sse.md` | ✅ | 2026-05-01 | Tap via `ReadableStream.tee()`. Parses both OpenAI `delta.content` and Anthropic `content_block_delta`. Synthesizes a per-parser response shape so the same parsers handle stream + non-stream |
| 6 | `pii/scrubber.ts` | `27-pii-scrubber.md` | ✅ | 2026-05-01 | Email/phone/SSN/card/IP/api-key masking. Walks objects recursively |
| 7 | `transport.ts` | `28-transport.md` | ✅ | 2026-05-01 | Batches in memory, flushes every 500ms or 50 spans, exponential-backoff retry (3 attempts), silent network-fail, `process.on('beforeExit')` final flush, timer `unref()` so the SDK never keeps the event loop alive on its own |
| 8 | Parsers — Gemini, Cohere, Mistral | `29-parsers-extended.md` | ✅ | 2026-05-01 | Built alongside Phase 2 #2 — Gemini uses `usageMetadata.{prompt,candidates}TokenCount`; Cohere supports v1 `meta.billed_units` and v2 `usage.tokens`; Mistral mirrors OpenAI shape |
| 9 | Python: patch `httpx` + `requests` | `30-python-universal.md` | ⏳ | - | |
| 10 | Tests + npm publish | `31-universal-tests-publish.md` | 🔄 | 2026-05-01 | Vitest suite green: 25/25 across registry, parsers, fetch interceptor (incl. SSE round-trip + error path), transport. Build/type-check/lint clean. npm publish pending |

### Phase 2 — Developer Integration Target
```typescript
// This is ALL the developer ever does
import { AgentLens } from '@farzanhossans/agentlens'
AgentLens.init({ apiKey: 'proj_xxx' })
```

### Phase 2 — Self-Hosted Support
The same one-line API works against a self-hosted ingest by passing `endpoint`:
```typescript
AgentLens.init({
  apiKey: 'proj_yyy',
  endpoint: 'https://agentlens.your-company.com/v1/spans',
})
```
Spans flow: app → caller's worker → caller's DB. No path through AgentLens cloud.

### Phase 2 — Issues Found / Resolved
- `eslint-recommended-requiring-type-checking` rejected `as` casts that the test files needed for `vi.fn` mocks → added an `overrides` block in `packages/sdk-universal/.eslintrc.json` that disables `no-unsafe-*` and `require-await` for `src/__tests__/**`. Mirrors how `packages/sdk-openai` handles it
- ESLint type-aware lint required tests to be in the project — added `tsconfig.eslint.json` (extends `tsconfig.json`, includes `src`) and pointed `parserOptions.project` at it
- Initial transport implementation flushed via `globalThis.fetch` — that's the patched fetch, so flushes would be intercepted in a loop. Fixed by stashing the original on `globalThis.__agentlens_originalFetch` from inside `patchFetch` and reading from there in the transport
- Setting `setInterval` without `unref()` would prevent the host process from exiting — `unref()` applied so the SDK never blocks shutdown

---

## Phase 3 — AI Intelligence Layer (⏳ PLANNED)

> **Goal:** Shift from "see what happened" to "understand why and how to fix it"

| # | What To Build | Status | Notes |
|---|--------------|--------|-------|
| 1 | AI-powered trace analyzer (Claude API) | ⏳ | Why did this agent fail? |
| 2 | Prompt version tracker | ⏳ | Diff prompts, track changes |
| 3 | Conversation health scoring | ⏳ | Score every agent run |
| 4 | Token optimizer | ⏳ | Suggest prompt compression |

---

## Decision Log

> Important architectural decisions made during implementation.

| Date | Decision | Reason |
|------|---------|--------|
| - | npm scope is `@farzanhossans` (with 's') | `@farzanhossan` without 's' is wrong scope |
| - | Cloudflare Worker forwards directly to NestJS | Upstash Redis queue removed — simpler for MVP |
| - | In-memory rate limiting in Worker | KV namespace placeholder never replaced |
| - | Hardcoded "agentlens" credentials in docker-compose.prod.yml | MVP simplicity |
| - | Host port 4020 (not 3000) on droplet | Port 3000 conflict |
| - | `git reset --hard` + backup/restore for `.env.production` | Gitignored file destroyed by reset |
| - | Network-layer interception for universal SDK | SDK-level patching misses custom HTTP clients |
| 2026-05-01 | Patch both `fetch` AND Node `http`/`https` | `fetch` alone misses axios, got, and node-fetch v2 — they go through Node's HTTP layer directly |
| 2026-05-01 | Stash original `fetch` on a private `globalThis` key for the transport's own flushes | Otherwise the transport's outbound POST loops back through the patcher; tried storing it on the Transport but the SDK's static `init` makes the global stash simpler |
| 2026-05-01 | Synthesize a fake provider response from SSE chunks instead of writing parallel stream parsers | Lets the same `parseSpan()` switch handle stream + non-stream uniformly. Trade-off: synthetic responses must match each provider's real response shape — covered by tests |
| 2026-05-01 | `unref()` the flush interval timer | A 500ms interval otherwise prevents the host process from exiting cleanly |
| 2026-05-01 | Cost lookup falls back to model-name prefix (`gpt-4o-2024-08-06` → `gpt-4o`) | Provider model IDs include date/version suffixes. Without prefix fallback, cost would silently be `0` for newly-released variants |
| 2026-05-01 | Default ingest endpoint `https://ingest.agentlens.dev/v1/spans` | Self-hosted users override via `endpoint` — same code path, no two-track API |

---

## How To Update This File

After every implementation session, append:
1. Update the status column for completed items
2. Add date to completed rows
3. Add any issues found to Notes column
4. Add any new decisions to Decision Log
5. If new phase — add new section following the same format
