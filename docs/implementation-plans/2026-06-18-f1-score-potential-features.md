# F1 Score in AgentLens - Potential Features

Status: Done ✅

Date: 2026-06-18
Status: Planning only
Scope: Feature implementation plan for Claude. No code changes were made as part of this planning pass.

## Summary

Add first-class F1 score reporting to AgentLens for classification-style agent workflows. V1 should be deterministic and metadata-driven: users attach expected and predicted labels to spans through existing SDK metadata, and AgentLens aggregates precision, recall, F1, accuracy, and misclassifications in the dashboard.

Do not add an LLM judge, dataset upload UI, or retrieval-specific scoring in v1. Those are useful future features, but they would expand the product surface and create more ambiguity than is needed for the first implementation.

## Current Codebase Context

AgentLens currently captures traces and spans through SDK ingestion, persists structured span data in PostgreSQL, indexes span data in Elasticsearch, and exposes dashboard APIs under `apps/api/src/dashboard/*`.

Relevant existing behavior:

- `RawSpanData.metadata` already accepts arbitrary JSON through `apps/api/src/span-processor/span-processor.types.ts`.
- `SpanEntity.metadata` is stored as JSONB in `apps/api/src/database/entities/span.entity.ts`.
- Trace and span details already expose span metadata through `apps/api/src/dashboard/traces/dto/traces.dto.ts`.
- Dashboard API helpers live in `apps/dashboard/src/lib/api.ts`.
- Dashboard shared types live in `apps/dashboard/src/lib/types.ts`.
- Routes are registered in `apps/dashboard/src/App.tsx`.
- Sidebar navigation is in `apps/dashboard/src/components/Layout.tsx`.

This means v1 can be implemented without changing SDK transport contracts or adding a required database migration.

## Product Definition

### V1 User Story

As a developer using AgentLens for an agent that classifies, routes, extracts, grades, or labels inputs, I want to attach expected and predicted labels to spans and see aggregate F1 score over time so I can track model quality alongside cost, latency, and errors.

### Metadata Convention

Users should attach evaluation metadata to the span that represents the evaluated classification decision.

Use this metadata shape:

```json
{
  "agentlens": {
    "eval": {
      "expected": "billing",
      "predicted": "billing",
      "task": "intent-classification",
      "split": "prod"
    }
  }
}
```

Required fields:

- `metadata.agentlens.eval.expected`: string
- `metadata.agentlens.eval.predicted`: string

Optional fields:

- `metadata.agentlens.eval.task`: string, default to `default`
- `metadata.agentlens.eval.split`: string, default to `default`

Rows missing either `expected` or `predicted` must be ignored by F1 aggregation. Empty strings should be treated as missing.

### Metric Semantics

Each span with both `expected` and `predicted` is one evaluation row.

For each label:

- True positive: `expected == label` and `predicted == label`
- False positive: `expected != label` and `predicted == label`
- False negative: `expected == label` and `predicted != label`
- Support: count of rows where `expected == label`

Metric formulas:

- Precision: `tp / (tp + fp)`, or `0` when denominator is `0`
- Recall: `tp / (tp + fn)`, or `0` when denominator is `0`
- F1: `2 * precision * recall / (precision + recall)`, or `0` when denominator is `0`
- Accuracy: exact matches divided by evaluated rows

The top-level summary should use micro-averaged counts across all labels by default. The dashboard should also show per-label rows so users can inspect weak labels.

## API Plan

### New Backend Area

Add:

- `apps/api/src/dashboard/evaluations/evaluations.controller.ts`
- `apps/api/src/dashboard/evaluations/evaluations.service.ts`
- `apps/api/src/dashboard/evaluations/dto/evaluations.dto.ts`
- `apps/api/src/dashboard/evaluations/__tests__/evaluations.service.spec.ts`

Update:

- `apps/api/src/dashboard/dashboard.module.ts`

### Routes

Add these authenticated dashboard routes under the existing project route pattern:

- `GET /projects/:projectId/evaluations/f1`
- `GET /projects/:projectId/evaluations/misclassifications`

Both routes should use `JwtAuthGuard`, matching existing dashboard controllers.

Note: the current dashboard controllers do not consistently enforce organization ownership for `projectId`. Follow the existing pattern for this feature, but do not make the security model worse. A separate cross-project authorization fix already exists as a known codebase issue and should not be bundled into this feature.

### Query DTO

Shared filters for both routes:

- `dateFrom`: optional ISO 8601 date or timestamp
- `dateTo`: optional ISO 8601 date or timestamp
- `task`: optional string
- `split`: optional string
- `agentName`: optional string
- `model`: optional string

Defaults:

- If `dateTo` is omitted, use now.
- If `dateFrom` is omitted, use 30 days before `dateTo`.
- If `task` is omitted, include all tasks.
- If `split` is omitted, include all splits.

Additional params for `GET /evaluations/f1`:

- `groupBy`: optional enum: `label`, `agent`, `model`, `task`
- Default `groupBy`: `label`

Additional params for `GET /evaluations/misclassifications`:

- `limit`: optional integer, default `50`, max `200`
- `offset`: optional integer, default `0`
- `expected`: optional string
- `predicted`: optional string

### Response DTOs

`GET /evaluations/f1` should return:

```ts
{
  dateFrom: string;
  dateTo: string;
  summary: {
    evaluated: number;
    correct: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
  };
  breakdown: Array<{
    key: string;
    evaluated: number;
    support: number;
    correct: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
  }>;
}
```

`GET /evaluations/misclassifications` should return:

```ts
{
  items: Array<{
    spanId: string;
    traceId: string;
    agentName: string | null;
    model: string | null;
    expected: string;
    predicted: string;
    task: string;
    split: string;
    startedAt: string;
    inputPreview: string | null;
    outputPreview: string | null;
  }>;
  total: number;
}
```

### Service Implementation

Use PostgreSQL JSONB extraction from `spans.metadata` for v1.

Base row fields:

- `s.id`
- `s.trace_id`
- `s.project_id`
- `s.model`
- `s.started_at`
- `s.input`
- `s.output`
- `s.metadata #>> '{agentlens,eval,expected}' AS expected`
- `s.metadata #>> '{agentlens,eval,predicted}' AS predicted`
- `COALESCE(s.metadata #>> '{agentlens,eval,task}', 'default') AS task`
- `COALESCE(s.metadata #>> '{agentlens,eval,split}', 'default') AS split`
- `t.agent_name`

Join `traces t` when agent filtering or agent display is needed.

Filtering rules:

- Always filter by `s.project_id = $1`.
- Filter `s.started_at >= dateFrom` and `s.started_at <= dateTo`.
- Require non-empty expected and predicted labels.
- Apply optional task, split, model, and agentName filters.

Implementation guidance:

- Prefer fetching normalized evaluation rows and calculating metrics in TypeScript for clarity and testability.
- Keep result sets bounded by the date range. If this becomes too large, add SQL aggregation or an indexed/materialized approach in a follow-up.
- Round metric values consistently in the DTO layer or frontend display, not inside the core calculation helper.
- Put pure metric calculation in a small helper function inside `evaluations.service.ts` or a sibling file if the service becomes hard to test.

### Database Migration

No required migration for v1.

Optional follow-up migration if production datasets are large:

- Add a partial JSONB expression index for spans that contain `metadata.agentlens.eval.expected` and `metadata.agentlens.eval.predicted`.
- Do not add this in v1 unless performance tests show the JSONB filter is too slow.

## Dashboard Plan

### Files To Add

- `apps/dashboard/src/pages/EvaluationsPage.tsx`

### Files To Update

- `apps/dashboard/src/lib/types.ts`
- `apps/dashboard/src/lib/api.ts`
- `apps/dashboard/src/App.tsx`
- `apps/dashboard/src/components/Layout.tsx`

### Page Route

Add route:

- `/evaluations`

Add sidebar item:

- Label: `Evaluations`
- Position: after `Traces` or after `Cost`. Prefer after `Traces` because this feature is quality-focused and trace-linked.

### Page Behavior

The Evaluations page should be a compact operational dashboard, consistent with the existing Cost and Traces pages.

Controls:

- Date presets: `24h`, `7d`, `30d`, `90d`
- Custom from/to date inputs
- Task text/select input
- Split text/select input
- Agent filter
- Model filter
- Group by selector: `Label`, `Agent`, `Model`, `Task`

Top summary cards:

- F1
- Precision
- Recall
- Accuracy
- Evaluated rows

Main table:

- Key
- F1
- Precision
- Recall
- Accuracy
- Support
- TP
- FP
- FN

Misclassifications table:

- Time
- Trace link
- Agent
- Model
- Expected
- Predicted
- Input preview

UX details:

- Show `--` for metric values when `evaluated` is `0`.
- Display metric values as percentages with one decimal place.
- Sort breakdown rows by lowest F1 first, then highest support.
- Link misclassification rows to `/traces/:traceId`.
- Use the existing dark dashboard style and table patterns from `TracesPage.tsx` and `CostPage.tsx`.

## Documentation Plan

Update docs/examples after the API and UI are implemented:

- Add an F1/evaluation section to `README.md`.
- Add a short example near manual tracing docs showing how to attach eval metadata.
- If there is a dashboard docs page later, include the metadata convention and explain that rows missing expected/predicted are ignored.

Example docs should not claim automatic judging. Make it explicit that users provide labels in v1.

## Step-by-Step Instructions For Claude

1. Create the backend evaluations folder under `apps/api/src/dashboard/evaluations`.
2. Add DTOs for F1 query params, misclassification query params, F1 response, and misclassification response.
3. Implement `EvaluationsService` with:
   - a method to load normalized evaluation rows from PostgreSQL,
   - a pure metric calculation helper,
   - `getF1Summary(projectId, query)`,
   - `getMisclassifications(projectId, query)`.
4. Implement `EvaluationsController` with the two GET routes.
5. Register the controller and service in `DashboardModule`.
6. Add unit tests for metric math and query filters.
7. Add dashboard TypeScript interfaces for evaluation summary, breakdown rows, and misclassification rows.
8. Add API helpers in `apps/dashboard/src/lib/api.ts`.
9. Build `EvaluationsPage.tsx` using React Query and existing dashboard UI conventions.
10. Add the `/evaluations` route in `App.tsx`.
11. Add the sidebar item in `Layout.tsx`.
12. Update README/docs with the metadata convention.
13. Run the verification commands listed below.

## Test Plan

API unit tests:

- Perfect classification returns F1, precision, recall, and accuracy of `1`.
- All wrong classifications return accuracy `0` and appropriate per-label FP/FN counts.
- Mixed multiclass data returns correct micro summary and per-label breakdown.
- Rows missing expected or predicted labels are ignored.
- Empty result set returns evaluated `0` and metric values `0`.
- `task`, `split`, `agentName`, `model`, and date filters are passed into the query.
- Misclassification endpoint excludes correct rows and paginates results.

Dashboard checks:

- Page renders loading, empty, success, and error states.
- Metric formatting uses percentages and `--` for no data.
- Misclassification links navigate to trace detail pages.

Verification commands:

```bash
pnpm --filter @farzanhossans/agentlens-api test -- evaluations
pnpm --filter @farzanhossans/agentlens-api type-check
pnpm --filter @farzanhossans/agentlens-api lint
pnpm --filter @farzanhossans/agentlens-dashboard type-check
pnpm --filter @farzanhossans/agentlens-dashboard build
pnpm --filter @farzanhossans/agentlens-dashboard lint
```

## Future Potential Features

These should not be included in v1 unless explicitly reprioritized:

- LLM-as-judge evaluations for outputs where exact labels do not exist.
- Dataset upload and batch evaluation runs.
- CI evaluation API for comparing prompt/model versions before deploy.
- F1 alerts, such as notifying when F1 drops below a threshold.
- Confusion matrix visualization.
- Per-prompt-version quality tracking.
- Retrieval F1 or recall@k for RAG workflows.
- Elasticsearch-backed aggregation for high-volume projects.
- Generated database indexes or rollup tables for long-range analytics.

## Acceptance Criteria

The feature is complete when:

- A span with `metadata.agentlens.eval.expected` and `metadata.agentlens.eval.predicted` contributes to F1 metrics.
- Dashboard users can view F1, precision, recall, accuracy, support, and misclassifications for a selected project and time range.
- Users can filter evaluation metrics by task, split, agent, and model.
- Misclassification rows link back to trace details for debugging.
- Existing traces, cost, alerts, and overview pages continue to work.
- API and dashboard verification commands pass.
