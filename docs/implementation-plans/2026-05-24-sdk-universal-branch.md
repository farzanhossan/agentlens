# `feat/sdk-universal` — Branch Plan, Status & Remaining Work

**Branch:** `feat/sdk-universal`
**Base:** `main`
**Commit:** `99ab48b feat(sdk-universal): ship one-line LLM tracer and remove proxy`
**Status:** 🔄 Code complete on branch — npm publish + Python parity pending

---

## 1. The Plan

Replace the self-hosted **proxy** (apps/proxy/) with a **universal one-line SDK** that traces every LLM call by intercepting the network layer in the caller's own process.

### Why
The proxy was infrastructure the developer would have had to run and scale themselves. The universal SDK delivers the same zero-friction DX in **one line of application code** — no extra service to deploy.

### Developer surface (target)
```ts
import { AgentLens } from '@farzanhossans/agentlens'
AgentLens.init({ apiKey: 'proj_xxx' })
// every OpenAI / Anthropic / Gemini / Cohere / Mistral call now traced
```

Self-hosted variant — same code path, override `endpoint`:
```ts
AgentLens.init({ apiKey: 'proj_yyy', endpoint: 'https://agentlens.your-co.com/v1/spans' })
```

### Architecture
- Patch `globalThis.fetch` **and** Node `http`/`https.request` — `fetch` alone misses axios, got, node-fetch v2.
- Match outbound requests against an LLM endpoint registry.
- Per-provider parsers normalize req/res into spans.
- Streaming-safe via `ReadableStream.tee()` + SSE chunk synthesis into a fake provider response (so the same parser handles stream + non-stream).
- PII scrubbed by default (email/phone/SSN/card/IP/api-key).
- Batched transport: flush every 500ms or 50 spans, exponential-backoff retry, `unref()`'d timer, `beforeExit` final flush.
- Transport flushes use a stashed original `fetch` on `globalThis.__agentlens_originalFetch` to avoid recursing through the patcher.

---

## 2. What Was Done (on this branch)

### New package: `packages/sdk-universal/`
Published name: `@farzanhossans/agentlens` (version `0.1.0`, not yet on npm).

| Module | Purpose |
|---|---|
| `registry.ts` | LLM endpoint map (OpenAI, Anthropic, Gemini, Cohere, Mistral). `matchLLM()` returns `null` on bad URLs instead of throwing |
| `parsers/openai.ts` | Cost lookup with model-prefix fallback (`gpt-4o-2024-08-06` → `gpt-4o`) |
| `parsers/anthropic.ts` | Messages API + streaming `content_block_delta` |
| `parsers/gemini.ts` | `usageMetadata.{prompt,candidates}TokenCount` |
| `parsers/cohere.ts` | v1 `meta.billed_units` + v2 `usage.tokens` |
| `parsers/mistral.ts` | OpenAI-shape mirror |
| `interceptors/fetch.ts` | Patches `globalThis.fetch`, double-patch guarded |
| `interceptors/https.ts` | Patches Node `http`/`https.request`; buffers req body via `req.write` shim |
| `streaming/sse.ts` | `tee()` tap + SSE chunk parser, synthesizes provider response shape |
| `pii/scrubber.ts` | Recursive object walk, regex-based masking |
| `transport.ts` | Batched flush, retry, `unref()`'d timer, `beforeExit` hook |
| `index.ts` | `AgentLens.init({ apiKey, endpoint })` — the entire public API |

### Tests
- 25/25 vitest tests green across registry, parsers, fetch interceptor (incl. SSE round-trip + error path), transport.
- Build / type-check / lint clean.
- ESLint type-aware rules required `tsconfig.eslint.json` + a `src/__tests__/**` override to allow `as` casts for `vi.fn` mocks (mirrors `packages/sdk-openai`).

### Proxy removed (entirely)
- Deleted `apps/proxy/` (src + tests + Dockerfile + tsconfig).
- Removed `proxy` service from `infra/docker-compose.yml` and `infra/docker-compose.prod.yml`.
- Removed `PROXY_PORT` from `infra/.env.prod.example` and `.github/workflows/deploy.yml`.

### Marketing / docs repositioned around the SDK
- `README.md` leads with the universal SDK; manual tracing demoted to Option 2.
- `apps/landing/index.html` hero terminal types out the full `init({ apiKey, endpoint })` form; "How it works" simplified from 3 cards to 2; comparison table swaps "Zero code changes (proxy)" for "Universal SDK — one line, every provider"; JSON-LD FAQ + SEO meta rewritten.
- `docs/deployment.md` "Connect your app" rewritten to the SDK quickstart; proxy headers section removed.
- `apps/dashboard/src/components/IntegrationGuide.tsx` rewritten to a single Node/TS quickstart pre-filled with this project's apiKey + ingest endpoint.
- `IMPLEMENTATION_HISTORY.md` added with Phase 2 items 1–8 marked ✅.

### Decisions logged (see `IMPLEMENTATION_HISTORY.md`)
- Patch both `fetch` AND Node `http`/`https` — `fetch` alone misses axios/got/node-fetch v2.
- Stash original `fetch` on a private `globalThis` key for transport flushes — avoids loopback through the patcher.
- Synthesize fake provider response from SSE chunks — lets `parseSpan()` handle stream + non-stream uniformly.
- `unref()` the flush interval timer — otherwise prevents host process from exiting.
- Cost lookup falls back to model-name prefix — newly-released variants don't silently cost `0`.
- Default ingest `https://ingest.agentlens.dev/v1/spans` — self-hosted overrides via `endpoint`, same code path.

---

## 3. What's Left

### Phase 2 — to close out the branch
| # | Item | Status | Notes |
|---|---|---|---|
| 9 | Python: patch `httpx` + `requests` | ⏳ Not started | See §3a below — concrete punch list |
| 10 | npm publish `@farzanhossans/agentlens@0.1.0` | 🔄 Pending | One real blocker (missing `.npmignore`) — see §3b |

### 3a. Python parity — concrete punch list
Existing Python SDK (`packages/sdk-python/agentlens/`, package `agentlens`) only traces via explicit `@traced()` decorator / `with trace()` — no network-level auto-instrumentation today. Mirror the JS architecture:

1. **Registry** — port `LLM_REGISTRY` as Python dict; `match_llm(url)` returns provider or `None` (URL parse → hostname → path-prefix check).
2. **Parsers** (`parsers/{openai,anthropic,gemini,cohere,mistral}.py`) — port all 5. Reuse pricing table from existing `patchers/openai.py`. Work at the raw HTTP JSON level, not the SDK object level, so minor provider-SDK version bumps don't break us.
3. **httpx interceptor** — monkeypatch `httpx.Client.__init__` and `AsyncClient.__init__` to inject our `event_hooks={'request': ..., 'response': ...}`. Async-native, clean.
4. **requests interceptor** — monkeypatch `requests.Session.request()` directly (simpler than the `HTTPAdapter` subclass pattern); hook the `PreparedRequest` before send.
5. **SSE streamer** — port `captureSSEStream()`: chunk accumulator + parser call; return synthetic response dict per provider shape.
6. **Wire-up** — call both patchers from `AgentLens.init()`; reuse `get_current_trace_id()` for context.
7. **Tests** — pytest fixtures for mocked httpx/requests; round-trip request → response → span.

**Success criterion:** A raw OpenAI/Anthropic call via httpx or requests is auto-captured with no decorator wrapping.

### 3b. npm publish — pre-publish checklist
From the publish-readiness audit:

**✅ Ready:** name/version, `main`/`module`/`types`/`exports` paths, `files` field (`dist`, `README.md`), `license`/`author`/`homepage`/`repository`/`bugs`, keywords, `prepublishOnly` (`build` + `test`), `dist/` built with `.d.ts` (no `any` leaks in public API), README has install + 4 quickstart scenarios + provider table + PII section + API docs.

**❌ Blocker — must fix before publish:**
- [ ] Create `packages/sdk-universal/.npmignore` matching sibling packages (`sdk-openai`, `sdk-core`, `sdk-anthropic`). Without it, `src/`, `*.test.ts`, `tsconfig*.json`, `vitest.config.ts`, `.eslintrc.json` will ship in the tarball.

**⚠️ Nice-to-have:**
- [ ] Add `"engines": { "node": ">=18" }`.
- [ ] Consider peerDependencies parity with `sdk-openai` (currently deps only).
- [ ] `npm pack` → install into a scratch project → run against a real OpenAI call before `pnpm publish --access public`.
- [ ] Bump dashboard `IntegrationGuide.tsx` install snippet if version moves off `0.1.0`.

### 3c. Proxy-removal cleanup
Removal is **clean except for one stale lockfile entry**:
- [ ] `pnpm-lock.yaml:249` still has the old `apps/proxy:` block with `@hono/node-server` + `hono`. Fix with `pnpm install --lockfile-only`.

Everything else verified clean: `pnpm-workspace.yaml`, `turbo.json`, `.github/workflows/*.yml`, both compose files, no `PROXY_PORT` references, no `@agentlens/proxy` imports, no dashboard/landing proxy code. The `apps/proxy/` mentions in `docs/superpowers/` are historical specs — leave them.

### 3d. Branch fragility / pre-merge fixes
From the package internals audit, three real correctness issues to triage before tagging the release:

- [ ] **Gemini streaming likely broken** — SSE parser defaults to OpenAI shape and synthesizes a Gemini response with mismatched token fields (`prompt_tokens` vs `promptTokenCount`) → final span may show zero tokens.
- [ ] **Cohere streaming absent** — falls through to OpenAI parser; synthesized "Cohere" response gets OpenAI shape → wrong cost.
- [ ] **Mistral has no exported stream parser** despite the synthesizer supporting it.
- [ ] **`trace()` is exported but stubbed** (always returns the fn unchanged). Either implement context/parentage or remove from public API before 0.1.0.
- [ ] **PII test coverage gap** — `scrubber.ts` has no dedicated test file. IP regex is broad (matches version numbers).
- [ ] **`interceptors/https.ts` is untested** — only `fetch.ts` has an interceptor test. Add at least one axios/got round-trip test.
- [ ] **SSE buffers entire stream into memory** — unbounded; flag for follow-up if a customer ships a very long stream.

### 3e. Merge readiness
- [ ] Decide: ship Python parity in this branch, or merge JS-only and follow up with `feat/sdk-universal-python`.
- [ ] Regenerate `pnpm-lock.yaml` (item 3c above).
- [ ] Run full repo type-check + lint after lockfile regen.
- [ ] Verify production `docker-compose.prod.yml` still boots without the proxy service.
- [ ] PR description: lead with the proxy removal (breaking change for any self-hosted user pointing apps at the proxy).

---

## 4. Files Touched

`60 files changed, 2353 insertions(+), 1984 deletions(-)`

- **Added:** `packages/sdk-universal/**` (16 files), `IMPLEMENTATION_HISTORY.md`
- **Deleted:** `apps/proxy/**` (23 files)
- **Modified:** `README.md`, `apps/landing/index.html`, `apps/dashboard/src/components/IntegrationGuide.tsx`, `apps/dashboard/src/lib/constants.ts`, `docs/deployment.md`, `infra/docker-compose.yml`, `infra/docker-compose.prod.yml`, `infra/.env.prod.example`, `.github/workflows/deploy.yml`, `pnpm-lock.yaml`

---

## 5. Phase 3 (Planned, Not Started)

AI intelligence layer — out of scope for this branch:
1. AI-powered trace analyzer (Claude API) — "why did this agent fail?"
2. Prompt version tracker — diff prompts, track changes
3. Conversation health scoring — score every agent run
4. Token optimizer — suggest prompt compression
