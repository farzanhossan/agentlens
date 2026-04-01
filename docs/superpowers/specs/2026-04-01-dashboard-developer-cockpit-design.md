# Dashboard Developer Cockpit — Design Spec

## Goal

Transform the AgentLens dashboard from a basic trace viewer into a developer cockpit — the tool developers keep open while building and operating AI agents. Add full-text search, real-time monitoring, rich I/O inspection, and actionable cost analytics.

## Architecture

The dashboard is a React SPA (`apps/dashboard`) communicating with a NestJS API (`apps/api`). This spec adds 2 new pages (Overview, Live Feed), enhances 2 existing pages (Traces, Cost), and leaves 2 unchanged (Alerts, Projects). Backend changes are limited to 2 new API endpoints and minor additions to existing ones.

**Tech stack (no changes):** React 18, React Router, TanStack Query, Recharts, TailwindCSS, axios, socket.io-client, Prism.js.

---

## Navigation Structure

Sidebar navigation updated from 4 to 6 items:

| Order | Page | Status | Icon |
|-------|------|--------|------|
| 1 | Overview | NEW | Dashboard/grid icon |
| 2 | Traces | ENHANCED | List icon |
| 3 | Live Feed | NEW | Lightning/zap icon |
| 4 | Cost | ENHANCED | Dollar icon |
| 5 | Alerts | KEEP | Bell icon |
| 6 | Projects | KEEP (bottom section) | Gear icon |

After login, redirect to `/overview` instead of `/traces`.

---

## Page 1: Overview (NEW)

**Route:** `/overview`

**Purpose:** At-a-glance health of your AI agent over the last 24 hours. The landing page after login.

### Layout

**Top row — 5 stat cards:**
- Total Requests (count, % change vs yesterday)
- Error Rate (%, delta vs yesterday, red if > 5%)
- Today's Cost (USD, monthly total below)
- Avg Latency (seconds, P95 below)
- Active Traces (live count of running traces, blue)

**Middle row — 2 panels (3:2 ratio):**
- **Request Volume chart** (left, wider): Bar chart showing hourly request volume for 24h. Toggle between 1h/24h/7d granularity. Error-heavy bars tinted red. Uses Recharts BarChart.
- **Recent Errors panel** (right): Last 5 error traces. Each shows: error message (truncated), agent name, model, relative timestamp. Clickable — navigates to trace detail. "View all errors" link at bottom filters Traces page to status=error.

**Bottom row — 2 panels (1:1 ratio):**
- **Model Usage**: Progress bars per model showing call count and cost. Sorted by call count descending.
- **Top Agents table**: Agent name, call count, error count, avg latency, total cost. Sorted by call count descending. Top 5 agents.

### Backend

**New endpoint:** `GET /projects/:projectId/overview`

Query params: `hours` (default 24)

Response:
```json
{
  "totalRequests": 2847,
  "totalRequestsPrev": 2540,
  "errorCount": 91,
  "errorCountPrev": 62,
  "totalCostUsd": 4.82,
  "monthCostUsd": 142.30,
  "avgLatencyMs": 1200,
  "p95LatencyMs": 3400,
  "activeTraces": 3,
  "hourlyVolume": [
    { "hour": "2026-04-01T00:00:00Z", "total": 120, "errors": 4 }
  ],
  "modelUsage": [
    { "model": "gpt-4o-mini", "calls": 1842, "costUsd": 2.14 }
  ],
  "topAgents": [
    { "agentName": "openai.proxy", "calls": 1204, "errors": 38, "avgLatencyMs": 1100, "costUsd": 2.84 }
  ]
}
```

Implementation: Single SQL query with CTEs aggregating from `traces` and `spans` tables for the specified time window. `activeTraces` is a count of traces with `status = 'running'`.

---

## Page 2: Traces (ENHANCED)

**Route:** `/traces` (existing)

### Changes

**1. Global Search Bar**

Full-width search input at top of page. Placeholder: "Search prompts, responses, errors across all traces..."

- Keyboard shortcut: Cmd+K (Mac) / Ctrl+K (Windows) opens and focuses the search bar
- Calls `GET /projects/:projectId/spans/search?q=...` (existing ES endpoint)
- Search results displayed inline in the traces table — each result links to its trace
- Debounced: 300ms after last keystroke
- When search is active, filter bar and normal trace list are replaced with search results

**2. Input Preview Column**

New column in the traces table between Agent and Spans columns: "Input Preview"

- Shows the first user message from the root span's input field, truncated to ~60 chars
- For error traces, shows the error message instead (in red text)
- Data source: Add `inputPreview` field to the trace list API response

**3. Additional Filters**

Add to existing filter row:
- **Model** dropdown — populated from distinct models in traces
- **Latency** range — presets: <1s, 1-3s, 3-5s, >5s
- **Cost** range — presets: <$0.01, $0.01-$0.10, >$0.10

**4. Token Count Column**

New column showing total tokens (input + output) per trace.

**5. Relative Timestamps**

Replace absolute datetime with relative: "12s ago", "5m ago", "2h ago". Show full datetime on hover tooltip.

**6. Error Row Highlighting**

Rows with `status=error` get a subtle red background tint (`bg-red-950/20`).

**7. Compact Stats Bar**

Replace the 4 large stat cards with a single-line stats bar above the table: "2,847 traces · 91 errors · $4.82 total cost · 1.2s avg latency". Saves vertical space.

### Backend Changes

**Modify `GET /projects/:projectId/traces`:**
- Add `inputPreview` field to `TraceSummaryDto`: first 100 chars of the root span's input. Loaded via a subquery joining the `spans` table where `parent_span_id IS NULL`.
- Add `model` filter param: filters traces that contain a span with the specified model.
- Add `minLatencyMs` / `maxLatencyMs` filter params.
- Add `minCostUsd` / `maxCostUsd` filter params.

---

## Page 3: Trace Detail (ENHANCED)

**Route:** `/traces/:traceId` (existing)

### Changes

**1. Split-Panel Layout**

Replace the current full-width timeline + side-drawer with a permanent two-panel layout:
- **Left panel (50%):** Span timeline with hierarchical indentation
- **Right panel (50%):** Span detail inspector

No overlay drawer. Both panels always visible. Clicking a span in the left panel updates the right panel.

**2. Enhanced Span Timeline (Left Panel)**

Each span row shows:
- Status dot (colored by status)
- Span name
- Model + token count + cost (compact, gray text)
- Timeline bar showing relative duration and position within the trace
- Indentation: 16px per nesting level

**3. Span Detail Inspector (Right Panel)**

Header: Span name + Copy Input / Copy Output buttons.

Three tabs:
- **Input / Output** (default):
  - Input section: If input is a JSON array of messages (OpenAI format), parse and display each message by role with color coding: system (gray), user (blue), assistant (green). Otherwise display raw text.
  - Output section: Display completion text. If JSON, auto-format with syntax highlighting.
  - Token breakdown footer: Input tokens / Output tokens / Total / Cost / Model — all in one compact bar.
- **Metadata**: Key-value display of the span's metadata object. Each value formatted as JSON if complex.
- **Raw JSON**: Full span payload as formatted JSON with Prism.js syntax highlighting and a Copy button.

**4. Summary Cards Update**

Add a "Total Tokens" card (5th card) to the top summary row showing input + output token breakdown.

### Backend Changes

**Modify `GET /projects/:projectId/traces/:traceId`:**
- Include `input` and `output` fields in each span node of the response. Source: PostgreSQL `spans.input` / `spans.output` columns (already added), with ES fallback via the existing `SpansService.getSpan()` pattern.

---

## Page 4: Live Feed (NEW)

**Route:** `/live`

**Purpose:** Real-time stream of LLM calls as they happen. Zero-latency developer feedback loop.

### Layout

**Top bar:**
- Green pulsing dot + "Live" label
- Rate indicator: "3 calls/sec" (calculated from entries received in last 5 seconds)
- Filter dropdown: All / Errors Only / by Model / by Agent
- Pause/Resume button (blue, toggles)

**Feed area:**
- Vertical list of single-line entries, newest at top
- Each entry shows: relative timestamp, status badge, agent name, model, input preview (truncated), token count, latency, cost
- New entries animate in from top with a brief highlight (indigo left border)
- Error entries have red left border and subtle red background
- Older entries gradually fade (opacity reduces)
- Click any entry to navigate to `/traces/:traceId`
- Buffer: keep last 200 entries in memory. Older entries drop off the bottom.

### Implementation

- Uses existing WebSocket infrastructure (`/ws/traces` gateway with Redis pub/sub)
- Subscribe to a new event: `span-completed` — emitted when a span finishes processing
- Frontend connects on mount, disconnects on unmount
- Pause button: stops appending to the visible list (WebSocket stays connected, entries buffered)
- No backend API needed — purely WebSocket-driven

### Backend Changes

**Modify `TraceGateway`:**
- Add a new Redis subscription pattern or channel for completed spans
- Emit `span-completed` event with: `{ spanId, traceId, projectId, name, model, provider, status, input (first 100 chars), inputTokens, outputTokens, costUsd, latencyMs, startedAt }`
- The span-processor already publishes to Redis after processing — extend to include a `span-completed` channel alongside the existing `span-added` channel

---

## Page 5: Cost (ENHANCED)

**Route:** `/cost` (existing)

### Changes

**1. Total Tokens Card**

New stat card showing total token consumption with "1.6M in / 0.8M out" subtitle.

**2. Stacked Cost Chart**

Replace the current line chart with a stacked bar chart: input token cost (darker) + output token cost (lighter) per day. Helps developers understand whether cost is driven by large prompts or verbose completions.

**3. Model Efficiency Table**

New table replacing the basic model bar chart. Columns: Model, Calls, Avg Tokens/Call, Avg Cost/Call, Avg Latency, Total Cost. Sortable by any column. This answers "which model should I use for this task?"

**4. Cost by Agent (Progress Bars)**

Replace the basic agent bar chart with progress bars showing percentage of total cost per agent. More visually scannable.

**5. Period Comparison**

Stat cards show "+18% vs prev period" delta. Calculated by comparing the selected date range against the same duration immediately prior.

### Backend Changes

**Modify `GET /projects/:projectId/cost/summary`:**
- Add `totalInputTokens` and `totalOutputTokens` to response
- Add `byModel` entries to include: `avgTokensPerCall`, `avgCostPerCall`, `avgLatencyMs`, `callCount`
- Add `prevPeriod` object with `totalCostUsd` for delta calculation

---

## Pages 6-7: Alerts & Projects (NO CHANGES)

These pages are already functional and not part of this spec. Future specs will address:
- Alerts: Slack/email integration testing, alert history log
- Projects: Team member management, usage quotas

---

## New Backend Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/:projectId/overview?hours=24` | Overview page data |

## Modified Backend Endpoints Summary

| Method | Path | Changes |
|--------|------|---------|
| GET | `/projects/:projectId/traces` | Add `inputPreview`, model/latency/cost filters |
| GET | `/projects/:projectId/traces/:traceId` | Include span `input`/`output` in response |
| GET | `/projects/:projectId/cost/summary` | Add token totals, model efficiency, period comparison |
| WS | `/ws/traces` | Add `span-completed` event for live feed |

## New Frontend Files

| File | Purpose |
|------|---------|
| `pages/OverviewPage.tsx` | Overview page component |
| `pages/LiveFeedPage.tsx` | Live feed page component |
| `components/SearchBar.tsx` | Global search bar with Cmd+K |
| `components/SpanInspector.tsx` | Tabbed span detail inspector (replaces SpanDetailPanel) |
| `components/ModelEfficiencyTable.tsx` | Sortable model comparison table |

## Modified Frontend Files

| File | Changes |
|------|---------|
| `Layout.tsx` | Add Overview + Live Feed nav items, move Projects to bottom |
| `TracesPage.tsx` | Add search bar, input preview column, new filters, relative timestamps, compact stats |
| `TraceDetailPage.tsx` | Split-panel layout, use SpanInspector instead of SpanDetailPanel |
| `CostPage.tsx` | Token stats, stacked chart, model efficiency table, agent progress bars |
| `SpanTimeline.tsx` | Show model/tokens/cost per span row |
| `api.ts` | Add overview endpoint, update trace/cost types |

---

## Testing Strategy

**Backend:**
- Unit tests for the new overview endpoint (mock DB queries)
- Unit tests for modified trace list query (inputPreview, new filters)
- Unit tests for modified cost summary (token totals, model efficiency)

**Frontend:**
- Component tests for OverviewPage, LiveFeedPage, SearchBar, SpanInspector
- Integration test: search bar calls ES endpoint and displays results
- Integration test: live feed connects to WebSocket and renders entries

**Manual testing:**
- End-to-end: send requests through proxy, verify they appear in overview, traces, live feed, and cost page
- Search: verify ES-powered search returns relevant results
- Live feed: verify real-time updates via WebSocket

---

## Out of Scope

- Session/conversation grouping (future spec)
- Prompt playground / replay (future spec)
- A/B prompt comparison (future spec — Optimizer persona)
- Team collaboration features (future spec)
- Mobile responsive design (desktop-first for developer tool)
- Dark/light theme toggle (dark only)
