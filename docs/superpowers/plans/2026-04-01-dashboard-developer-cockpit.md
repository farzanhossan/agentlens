# Dashboard Developer Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the AgentLens dashboard from a basic trace viewer into a developer cockpit with an Overview page, enhanced Traces page, split-panel Trace Detail, Live Feed, and enhanced Cost analytics.

**Architecture:** Backend-first approach — add the new overview endpoint and extend existing trace/cost endpoints first, then build frontend pages incrementally. Each task produces a working, testable unit. The Live Feed leverages existing WebSocket infrastructure (Redis pub/sub + socket.io).

**Tech Stack:** React 18, React Router 6, TanStack Query 5, Recharts, TailwindCSS, socket.io-client, Prism.js, NestJS 10, TypeORM, PostgreSQL, Redis pub/sub.

---

## File Structure

### Backend (apps/api/src/)

| File | Action | Responsibility |
|------|--------|---------------|
| `dashboard/overview/overview.service.ts` | Create | Overview data aggregation (single SQL with CTEs) |
| `dashboard/overview/overview.controller.ts` | Create | `GET /projects/:projectId/overview` endpoint |
| `dashboard/overview/dto/overview.dto.ts` | Create | Overview response DTO + query DTO |
| `dashboard/overview/__tests__/overview.service.spec.ts` | Create | Unit tests for overview service |
| `dashboard/traces/traces.service.ts` | Modify | Add `inputPreview` subquery, model/latency/cost filters |
| `dashboard/traces/dto/traces.dto.ts` | Modify | Add `inputPreview`, `totalTokens` to TraceSummaryDto; add filter params to ListTracesQueryDto |
| `dashboard/traces/__tests__/traces-filters.spec.ts` | Create | Unit tests for new trace filters |
| `dashboard/cost/cost.service.ts` | Modify | Add token totals, model efficiency fields, previous period comparison |
| `dashboard/cost/dto/cost.dto.ts` | Modify | Add token fields, model efficiency fields, prevPeriod to DTOs |
| `dashboard/cost/__tests__/cost-enhanced.spec.ts` | Create | Unit tests for enhanced cost summary |
| `dashboard/websocket/trace.gateway.ts` | Modify | Add `span-completed` channel subscription + event emission |
| `dashboard/dashboard.module.ts` | Modify | Register OverviewController and OverviewService |

### Frontend (apps/dashboard/src/)

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/types.ts` | Modify | Add Overview, enhanced Cost, enhanced TraceSummary types |
| `lib/api.ts` | Modify | Add `fetchOverview()`, update trace/cost API functions |
| `lib/timeago.ts` | Create | Relative timestamp utility (`12s ago`, `5m ago`, etc.) |
| `pages/OverviewPage.tsx` | Create | Overview page with stat cards, charts, tables |
| `pages/LiveFeedPage.tsx` | Create | Real-time WebSocket-driven LLM call feed |
| `pages/TracesPage.tsx` | Modify | Add search bar, input preview column, new filters, compact stats, relative timestamps, error highlighting |
| `pages/TraceDetailPage.tsx` | Modify | Split-panel layout with SpanInspector |
| `pages/CostPage.tsx` | Modify | Token stats, stacked chart, model efficiency table, agent progress bars, period comparison |
| `components/Layout.tsx` | Modify | Add Overview + Live Feed nav items, reorder, update default redirect |
| `components/SearchBar.tsx` | Create | Global search bar with Cmd+K shortcut |
| `components/SpanInspector.tsx` | Create | Tabbed span detail panel (Input/Output, Metadata, Raw JSON) |
| `components/ModelEfficiencyTable.tsx` | Create | Sortable model comparison table |
| `components/SpanTimeline.tsx` | Modify | Show model/tokens/cost per span row |
| `App.tsx` | Modify | Add routes for `/overview` and `/live`, update root redirect |
| `hooks/useTraceSocket.ts` | Modify | Add `span-completed` event support for Live Feed |

---

## Task 1: Backend — Overview Endpoint

**Files:**
- Create: `apps/api/src/dashboard/overview/dto/overview.dto.ts`
- Create: `apps/api/src/dashboard/overview/overview.service.ts`
- Create: `apps/api/src/dashboard/overview/overview.controller.ts`
- Create: `apps/api/src/dashboard/overview/__tests__/overview.service.spec.ts`
- Modify: `apps/api/src/dashboard/dashboard.module.ts:18-45`

- [ ] **Step 1: Write the overview DTO**

Create `apps/api/src/dashboard/overview/dto/overview.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class OverviewQueryDto {
  @ApiPropertyOptional({ description: 'Number of hours to look back (default 24)', default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;
}

export class HourlyVolumeDto {
  @ApiProperty()
  hour!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  errors!: number;
}

export class ModelUsageDto {
  @ApiProperty()
  model!: string;

  @ApiProperty()
  calls!: number;

  @ApiProperty()
  costUsd!: number;
}

export class TopAgentDto {
  @ApiProperty()
  agentName!: string;

  @ApiProperty()
  calls!: number;

  @ApiProperty()
  errors!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  costUsd!: number;
}

export class RecentErrorDto {
  @ApiProperty()
  traceId!: string;

  @ApiProperty()
  errorMessage!: string;

  @ApiPropertyOptional()
  agentName?: string;

  @ApiPropertyOptional()
  model?: string;

  @ApiProperty()
  startedAt!: string;
}

export class OverviewDto {
  @ApiProperty()
  totalRequests!: number;

  @ApiProperty()
  totalRequestsPrev!: number;

  @ApiProperty()
  errorCount!: number;

  @ApiProperty()
  errorCountPrev!: number;

  @ApiProperty()
  totalCostUsd!: number;

  @ApiProperty()
  monthCostUsd!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  p95LatencyMs!: number;

  @ApiProperty()
  activeTraces!: number;

  @ApiProperty({ type: () => [HourlyVolumeDto] })
  hourlyVolume!: HourlyVolumeDto[];

  @ApiProperty({ type: () => [ModelUsageDto] })
  modelUsage!: ModelUsageDto[];

  @ApiProperty({ type: () => [TopAgentDto] })
  topAgents!: TopAgentDto[];

  @ApiProperty({ type: () => [RecentErrorDto] })
  recentErrors!: RecentErrorDto[];
}
```

- [ ] **Step 2: Write the failing test for OverviewService**

Create `apps/api/src/dashboard/overview/__tests__/overview.service.spec.ts`:

```typescript
import { OverviewService } from '../overview.service';
import type { DataSource, Repository } from 'typeorm';
import type { TraceEntity } from '../../../database/entities/index';

function makeDataSourceMock(queryResults: Record<string, unknown[]>): {
  ds: DataSource;
  queryCalls: Array<{ sql: string; params: unknown[] }>;
} {
  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
  let callIndex = 0;
  const resultSets = Object.values(queryResults);
  const ds = {
    query: jest.fn((sql: string, params: unknown[]) => {
      queryCalls.push({ sql, params });
      return Promise.resolve(resultSets[callIndex++] ?? []);
    }),
  } as unknown as DataSource;
  return { ds, queryCalls };
}

function makeTraceRepoMock(countResult: number): Repository<TraceEntity> {
  return {
    count: jest.fn().mockResolvedValue(countResult),
  } as unknown as Repository<TraceEntity>;
}

describe('OverviewService', () => {
  it('returns overview data for the given time window', async () => {
    const { ds, queryCalls } = makeDataSourceMock({
      summary: [
        {
          total_requests: '100',
          error_count: '5',
          total_cost: '1.50',
          avg_latency_ms: '1200',
          p95_latency_ms: '3400',
        },
      ],
      prevSummary: [{ total_requests: '80', error_count: '3' }],
      monthCost: [{ month_cost: '42.50' }],
      hourly: [
        { hour: '2026-04-01T00:00:00Z', total: '10', errors: '1' },
      ],
      models: [
        { model: 'gpt-4o-mini', calls: '50', cost: '0.80' },
      ],
      agents: [
        { agent_name: 'openai.proxy', calls: '60', errors: '3', avg_latency_ms: '1100', cost: '1.20' },
      ],
      errors: [
        {
          trace_id: 'tr-1',
          error_message: 'Rate limited',
          agent_name: 'openai.proxy',
          model: 'gpt-4o',
          started_at: '2026-04-01T10:00:00Z',
        },
      ],
    });

    const traceRepo = makeTraceRepoMock(2);
    const service = new OverviewService(ds, traceRepo);
    const result = await service.getOverview('project-1', 24);

    expect(result.totalRequests).toBe(100);
    expect(result.errorCount).toBe(5);
    expect(result.totalRequestsPrev).toBe(80);
    expect(result.totalCostUsd).toBe(1.5);
    expect(result.monthCostUsd).toBe(42.5);
    expect(result.avgLatencyMs).toBe(1200);
    expect(result.p95LatencyMs).toBe(3400);
    expect(result.activeTraces).toBe(2);
    expect(result.hourlyVolume).toHaveLength(1);
    expect(result.modelUsage).toHaveLength(1);
    expect(result.topAgents).toHaveLength(1);
    expect(result.recentErrors).toHaveLength(1);
    expect(queryCalls).toHaveLength(7);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/dashboard/overview/__tests__/overview.service.spec.ts --no-cache`

Expected: FAIL — `Cannot find module '../overview.service'`

- [ ] **Step 4: Implement OverviewService**

Create `apps/api/src/dashboard/overview/overview.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TraceEntity } from '../../database/entities/index.js';
import {
  HourlyVolumeDto,
  ModelUsageDto,
  OverviewDto,
  RecentErrorDto,
  TopAgentDto,
} from './dto/overview.dto.js';

@Injectable()
export class OverviewService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
  ) {}

  async getOverview(projectId: string, hours: number): Promise<OverviewDto> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - hours * 3600_000).toISOString();
    const prevWindowStart = new Date(now.getTime() - 2 * hours * 3600_000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const nowIso = now.toISOString();

    // 1. Current-period summary
    const summaryResult = await this.dataSource.query<
      Array<{
        total_requests: string;
        error_count: string;
        total_cost: string;
        avg_latency_ms: string | null;
        p95_latency_ms: string | null;
      }>
    >(
      `SELECT
         COUNT(*) AS total_requests,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
         COALESCE(SUM(total_cost_usd::float), 0) AS total_cost,
         AVG(total_latency_ms) AS avg_latency_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS p95_latency_ms
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at <= $3`,
      [projectId, windowStart, nowIso],
    );

    // 2. Previous-period summary (for deltas)
    const prevResult = await this.dataSource.query<
      Array<{ total_requests: string; error_count: string }>
    >(
      `SELECT
         COUNT(*) AS total_requests,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at < $3`,
      [projectId, prevWindowStart, windowStart],
    );

    // 3. Month-to-date cost
    const monthResult = await this.dataSource.query<Array<{ month_cost: string }>>(
      `SELECT COALESCE(SUM(total_cost_usd::float), 0) AS month_cost
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2`,
      [projectId, monthStart],
    );

    // 4. Hourly volume
    const hourlyResult = await this.dataSource.query<
      Array<{ hour: string; total: string; errors: string }>
    >(
      `SELECT
         date_trunc('hour', started_at) AS hour,
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at <= $3
       GROUP BY date_trunc('hour', started_at)
       ORDER BY hour ASC`,
      [projectId, windowStart, nowIso],
    );

    // 5. Model usage
    const modelResult = await this.dataSource.query<
      Array<{ model: string | null; calls: string; cost: string }>
    >(
      `SELECT
         model,
         COUNT(*) AS calls,
         COALESCE(SUM(cost_usd::float), 0) AS cost
       FROM spans
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at <= $3
         AND model IS NOT NULL
       GROUP BY model
       ORDER BY calls DESC`,
      [projectId, windowStart, nowIso],
    );

    // 6. Top agents
    const agentResult = await this.dataSource.query<
      Array<{
        agent_name: string | null;
        calls: string;
        errors: string;
        avg_latency_ms: string | null;
        cost: string;
      }>
    >(
      `SELECT
         agent_name,
         COUNT(*) AS calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         AVG(total_latency_ms) AS avg_latency_ms,
         COALESCE(SUM(total_cost_usd::float), 0) AS cost
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at <= $3
       GROUP BY agent_name
       ORDER BY calls DESC
       LIMIT 5`,
      [projectId, windowStart, nowIso],
    );

    // 7. Recent errors
    const errorsResult = await this.dataSource.query<
      Array<{
        trace_id: string;
        error_message: string | null;
        agent_name: string | null;
        model: string | null;
        started_at: string;
      }>
    >(
      `SELECT
         t.id AS trace_id,
         s.error_message,
         t.agent_name,
         s.model,
         t.started_at
       FROM traces t
       LEFT JOIN LATERAL (
         SELECT error_message, model
         FROM spans
         WHERE trace_id = t.id AND status = 'error'
         ORDER BY started_at DESC
         LIMIT 1
       ) s ON true
       WHERE t.project_id = $1
         AND t.status = 'error'
         AND t.started_at >= $2
         AND t.started_at <= $3
       ORDER BY t.started_at DESC
       LIMIT 5`,
      [projectId, windowStart, nowIso],
    );

    // 8. Active traces count
    const activeTraces = await this.traceRepo.count({
      where: { projectId, status: 'running' as never },
    });

    // Assemble DTO
    const s = summaryResult[0] ?? {
      total_requests: '0',
      error_count: '0',
      total_cost: '0',
      avg_latency_ms: null,
      p95_latency_ms: null,
    };
    const p = prevResult[0] ?? { total_requests: '0', error_count: '0' };

    const dto = new OverviewDto();
    dto.totalRequests = parseInt(s.total_requests, 10);
    dto.errorCount = parseInt(s.error_count, 10);
    dto.totalRequestsPrev = parseInt(p.total_requests, 10);
    dto.errorCountPrev = parseInt(p.error_count, 10);
    dto.totalCostUsd = parseFloat(s.total_cost);
    dto.monthCostUsd = parseFloat((monthResult[0] ?? { month_cost: '0' }).month_cost);
    dto.avgLatencyMs = s.avg_latency_ms !== null ? Math.round(parseFloat(s.avg_latency_ms)) : 0;
    dto.p95LatencyMs = s.p95_latency_ms !== null ? Math.round(parseFloat(s.p95_latency_ms)) : 0;
    dto.activeTraces = activeTraces;

    dto.hourlyVolume = hourlyResult.map((r): HourlyVolumeDto => ({
      hour: typeof r.hour === 'string' ? r.hour : new Date(r.hour).toISOString(),
      total: parseInt(r.total, 10),
      errors: parseInt(r.errors, 10),
    }));

    dto.modelUsage = modelResult.map((r): ModelUsageDto => ({
      model: r.model ?? 'unknown',
      calls: parseInt(r.calls, 10),
      costUsd: parseFloat(r.cost),
    }));

    dto.topAgents = agentResult.map((r): TopAgentDto => ({
      agentName: r.agent_name ?? 'unknown',
      calls: parseInt(r.calls, 10),
      errors: parseInt(r.errors, 10),
      avgLatencyMs: r.avg_latency_ms !== null ? Math.round(parseFloat(r.avg_latency_ms)) : 0,
      costUsd: parseFloat(r.cost),
    }));

    dto.recentErrors = errorsResult.map((r): RecentErrorDto => ({
      traceId: r.trace_id,
      errorMessage: r.error_message ?? 'Unknown error',
      agentName: r.agent_name ?? undefined,
      model: r.model ?? undefined,
      startedAt: typeof r.started_at === 'string' ? r.started_at : new Date(r.started_at).toISOString(),
    }));

    return dto;
  }
}
```

- [ ] **Step 5: Implement OverviewController**

Create `apps/api/src/dashboard/overview/overview.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { OverviewDto, OverviewQueryDto } from './dto/overview.dto.js';
import { OverviewService } from './overview.service.js';

@ApiTags('overview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @ApiOperation({ summary: 'Get overview dashboard data' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'hours', required: false, description: 'Lookback window in hours (default 24)' })
  @ApiResponse({ status: 200, description: 'Overview data', type: OverviewDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getOverview(
    @Param('projectId') projectId: string,
    @Query() query: OverviewQueryDto,
  ): Promise<OverviewDto> {
    return this.overviewService.getOverview(projectId, query.hours ?? 24);
  }
}
```

- [ ] **Step 6: Register in DashboardModule**

Modify `apps/api/src/dashboard/dashboard.module.ts` — add imports for OverviewController and OverviewService:

Add to imports at top:
```typescript
import { OverviewController } from './overview/overview.controller.js';
import { OverviewService } from './overview/overview.service.js';
```

Add `OverviewController` to `controllers` array and `OverviewService` to `providers` array.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/api && npx jest src/dashboard/overview/__tests__/overview.service.spec.ts --no-cache`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/dashboard/overview/ apps/api/src/dashboard/dashboard.module.ts
git commit -m "feat(api): add overview endpoint with stats, hourly volume, model usage, top agents"
```

---

## Task 2: Backend — Enhanced Trace List (inputPreview + new filters)

**Files:**
- Modify: `apps/api/src/dashboard/traces/dto/traces.dto.ts:20-58` (ListTracesQueryDto) and `:64-117` (TraceSummaryDto)
- Modify: `apps/api/src/dashboard/traces/traces.service.ts:37-127` (listTraces method)
- Create: `apps/api/src/dashboard/traces/__tests__/traces-filters.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/dashboard/traces/__tests__/traces-filters.spec.ts`:

```typescript
import { TracesService } from '../traces.service';
import type { Repository, SelectQueryBuilder, DataSource } from 'typeorm';
import type { TraceEntity } from '../../../database/entities/index';
import type { SpanEntity } from '../../../database/entities/index';

function makeQueryBuilder(rows: Partial<TraceEntity>[]): SelectQueryBuilder<TraceEntity> {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getCount: jest.fn().mockResolvedValue(rows.length),
  } as unknown as SelectQueryBuilder<TraceEntity>;
  return qb;
}

function makeTraceRepo(qb: SelectQueryBuilder<TraceEntity>): Repository<TraceEntity> {
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as Repository<TraceEntity>;
}

function makeSpanRepo(): Repository<SpanEntity> {
  return {} as unknown as Repository<SpanEntity>;
}

function makeDataSource(inputPreview: string | null): DataSource {
  return {
    query: jest.fn().mockResolvedValue(
      inputPreview !== null ? [{ input_preview: inputPreview }] : [],
    ),
  } as unknown as DataSource;
}

describe('TracesService — enhanced filters', () => {
  it('applies model filter via andWhere', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { model: 'gpt-4o' });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const modelFilter = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('model'),
    );
    expect(modelFilter).toBeDefined();
  });

  it('applies latency range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minLatencyMs: 1000, maxLatencyMs: 5000 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const minLatency = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_latency_ms >='),
    );
    const maxLatency = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_latency_ms <='),
    );
    expect(minLatency).toBeDefined();
    expect(maxLatency).toBeDefined();
  });

  it('applies cost range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minCostUsd: 0.01, maxCostUsd: 0.10 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const minCost = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_cost_usd'),
    );
    expect(minCost).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/dashboard/traces/__tests__/traces-filters.spec.ts --no-cache`

Expected: FAIL — property `model` does not exist on `ListTracesQueryDto`

- [ ] **Step 3: Add new filter fields to ListTracesQueryDto**

Modify `apps/api/src/dashboard/traces/dto/traces.dto.ts`. Add after the `limit` field (line 57):

```typescript
  @ApiPropertyOptional({ description: 'Filter traces containing spans with this model' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Minimum latency in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minLatencyMs?: number;

  @ApiPropertyOptional({ description: 'Maximum latency in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLatencyMs?: number;

  @ApiPropertyOptional({ description: 'Minimum cost in USD' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minCostUsd?: number;

  @ApiPropertyOptional({ description: 'Maximum cost in USD' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxCostUsd?: number;
```

Also add `IsNumber` to the imports from `class-validator` (already has `IsInt`).

- [ ] **Step 4: Add inputPreview and totalTokens to TraceSummaryDto**

In the same file, add to `TraceSummaryDto` class (after `endedAt` field):

```typescript
  @ApiPropertyOptional({ description: 'First ~100 chars of root span input' })
  inputPreview?: string;
```

Update `TraceSummaryDto.fromEntity` — inputPreview will be populated by the service, not from the entity. No change needed to fromEntity; the service will set it after calling fromEntity.

- [ ] **Step 5: Add filters to TracesService.listTraces**

Modify `apps/api/src/dashboard/traces/traces.service.ts`. In the `listTraces` method, add filter handling after the existing `dateTo` filter block (after line 66 for count query, after line 93 for data query). Add to BOTH the countQb and dataQb:

```typescript
    if (query.model) {
      countQb.andWhere(
        `t.id IN (SELECT trace_id FROM spans WHERE model ILIKE :model AND project_id = :projectId)`,
        { model: `%${query.model}%` },
      );
    }
    if (query.minLatencyMs !== undefined) {
      countQb.andWhere('t.totalLatencyMs >= :minLatencyMs', { minLatencyMs: query.minLatencyMs });
    }
    if (query.maxLatencyMs !== undefined) {
      countQb.andWhere('t.totalLatencyMs <= :maxLatencyMs', { maxLatencyMs: query.maxLatencyMs });
    }
    if (query.minCostUsd !== undefined) {
      countQb.andWhere('t.totalCostUsd::float >= :minCostUsd', { minCostUsd: query.minCostUsd });
    }
    if (query.maxCostUsd !== undefined) {
      countQb.andWhere('t.totalCostUsd::float <= :maxCostUsd', { maxCostUsd: query.maxCostUsd });
    }
```

(Repeat the same block for `dataQb`.)

After mapping `pageRows` to DTOs (line 123), add inputPreview lookup:

```typescript
    // Populate inputPreview for each trace
    const dtos = pageRows.map((t) => TraceSummaryDto.fromEntity(t));
    if (dtos.length > 0) {
      const traceIds = dtos.map((d) => d.id);
      const previews = await this.dataSource.query<
        Array<{ trace_id: string; input_preview: string }>
      >(
        `SELECT
           s.trace_id,
           LEFT(s.input, 100) AS input_preview
         FROM spans s
         WHERE s.trace_id = ANY($1)
           AND s.parent_span_id IS NULL
           AND s.input IS NOT NULL`,
        [traceIds],
      );
      const previewMap = new Map(previews.map((p) => [p.trace_id, p.input_preview]));
      for (const dto of dtos) {
        dto.inputPreview = previewMap.get(dto.id);
      }
    }

    return { data: dtos, nextCursor, total };
```

Replace the old `return { data: pageRows.map(...), ... }` block.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && npx jest src/dashboard/traces/__tests__/traces-filters.spec.ts --no-cache`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/dashboard/traces/
git commit -m "feat(api): add inputPreview, model/latency/cost filters to trace list endpoint"
```

---

## Task 3: Backend — Enhanced Cost Summary

**Files:**
- Modify: `apps/api/src/dashboard/cost/dto/cost.dto.ts:8-56`
- Modify: `apps/api/src/dashboard/cost/cost.service.ts:19-107`
- Create: `apps/api/src/dashboard/cost/__tests__/cost-enhanced.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/dashboard/cost/__tests__/cost-enhanced.spec.ts`:

```typescript
import { CostService } from '../cost.service';
import type { DataSource } from 'typeorm';

function makeDataSource(results: unknown[][]): DataSource {
  let callIndex = 0;
  return {
    query: jest.fn(() => Promise.resolve(results[callIndex++] ?? [])),
  } as unknown as DataSource;
}

describe('CostService — enhanced summary', () => {
  it('returns totalInputTokens, totalOutputTokens, and model efficiency fields', async () => {
    const results = [
      // 1. Total cost
      [{ total_cost: '10.00' }],
      // 2. Token totals
      [{ total_input_tokens: '500000', total_output_tokens: '200000' }],
      // 3. By model (with efficiency fields)
      [{ model: 'gpt-4o', provider: 'openai', cost: '8.00', count: '100', avg_tokens: '3200', avg_cost: '0.08', avg_latency_ms: '2400' }],
      // 4. By date
      [{ date: '2026-04-01', cost: '5.00' }],
      // 5. By agent
      [{ agent_name: 'proxy', cost: '7.00' }],
      // 6. Previous period cost
      [{ total_cost: '8.50' }],
    ];

    const ds = makeDataSource(results);
    const service = new CostService(ds);
    const result = await service.getSummary('proj-1', '2026-03-25', '2026-04-01');

    expect(result.totalInputTokens).toBe(500000);
    expect(result.totalOutputTokens).toBe(200000);
    expect(result.prevPeriodCostUsd).toBe(8.5);
    expect(result.byModel[0].avgTokensPerCall).toBe(3200);
    expect(result.byModel[0].avgCostPerCall).toBe(0.08);
    expect(result.byModel[0].avgLatencyMs).toBe(2400);
    expect(result.byModel[0].callCount).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/dashboard/cost/__tests__/cost-enhanced.spec.ts --no-cache`

Expected: FAIL — `totalInputTokens` not found on result

- [ ] **Step 3: Update Cost DTOs**

Modify `apps/api/src/dashboard/cost/dto/cost.dto.ts`. Add fields to `CostByModelDto`:

```typescript
export class CostByModelDto {
  @ApiProperty()
  model!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  costUsd!: number;

  @ApiProperty()
  spanCount!: number;

  @ApiProperty()
  avgTokensPerCall!: number;

  @ApiProperty()
  avgCostPerCall!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  callCount!: number;
}
```

Add fields to `CostSummaryDto`:

```typescript
export class CostSummaryDto {
  @ApiProperty()
  totalCostUsd!: number;

  @ApiProperty()
  totalInputTokens!: number;

  @ApiProperty()
  totalOutputTokens!: number;

  @ApiProperty()
  prevPeriodCostUsd!: number;

  @ApiProperty({ type: () => [CostByModelDto] })
  byModel!: CostByModelDto[];

  @ApiProperty({ type: () => [CostByDateDto] })
  byDate!: CostByDateDto[];

  @ApiProperty({ type: () => [CostByAgentDto] })
  byAgent!: CostByAgentDto[];

  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;
}
```

- [ ] **Step 4: Update CostService.getSummary**

Modify `apps/api/src/dashboard/cost/cost.service.ts`. Replace the entire `getSummary` method with:

```typescript
  async getSummary(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CostSummaryDto> {
    // 1. Total cost
    const totalResult = await this.dataSource.query<Array<{ total_cost: string }>>(
      `SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost
       FROM spans
       WHERE project_id = $1
         AND started_at BETWEEN $2 AND $3`,
      [projectId, dateFrom, dateTo],
    );

    // 2. Token totals
    const tokenResult = await this.dataSource.query<
      Array<{ total_input_tokens: string; total_output_tokens: string }>
    >(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens
       FROM spans
       WHERE project_id = $1
         AND started_at BETWEEN $2 AND $3`,
      [projectId, dateFrom, dateTo],
    );

    // 3. Cost by model (with efficiency metrics)
    const byModelResult = await this.dataSource.query<
      Array<{
        model: string | null;
        provider: string | null;
        cost: string;
        count: string;
        avg_tokens: string;
        avg_cost: string;
        avg_latency_ms: string | null;
      }>
    >(
      `SELECT
         model,
         provider,
         SUM(cost_usd::float) AS cost,
         COUNT(*) AS count,
         AVG(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS avg_tokens,
         AVG(cost_usd::float) AS avg_cost,
         AVG(latency_ms) AS avg_latency_ms
       FROM spans
       WHERE project_id = $1
         AND started_at BETWEEN $2 AND $3
       GROUP BY model, provider
       ORDER BY cost DESC`,
      [projectId, dateFrom, dateTo],
    );

    // 4. Cost by date
    const byDateResult = await this.dataSource.query<
      Array<{ date: string; cost: string }>
    >(
      `SELECT
         DATE(started_at) AS date,
         SUM(cost_usd::float) AS cost
       FROM spans
       WHERE project_id = $1
         AND started_at BETWEEN $2 AND $3
       GROUP BY DATE(started_at)
       ORDER BY date ASC`,
      [projectId, dateFrom, dateTo],
    );

    // 5. Cost by agent
    const byAgentResult = await this.dataSource.query<
      Array<{ agent_name: string | null; cost: string }>
    >(
      `SELECT
         t.agent_name,
         SUM(s.cost_usd::float) AS cost
       FROM spans s
       JOIN traces t ON t.id = s.trace_id
       WHERE s.project_id = $1
         AND s.started_at BETWEEN $2 AND $3
       GROUP BY t.agent_name
       ORDER BY cost DESC`,
      [projectId, dateFrom, dateTo],
    );

    // 6. Previous period cost (for delta comparison)
    const periodDays =
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400_000;
    const prevFrom = new Date(
      new Date(dateFrom).getTime() - periodDays * 86400_000,
    ).toISOString().split('T')[0];

    const prevResult = await this.dataSource.query<Array<{ total_cost: string }>>(
      `SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost
       FROM spans
       WHERE project_id = $1
         AND started_at BETWEEN $2 AND $3`,
      [projectId, prevFrom, dateFrom],
    );

    const byModel: CostByModelDto[] = byModelResult.map((row) => ({
      model: row.model ?? 'unknown',
      provider: row.provider ?? 'unknown',
      costUsd: parseFloat(row.cost),
      spanCount: parseInt(row.count, 10),
      avgTokensPerCall: Math.round(parseFloat(row.avg_tokens)),
      avgCostPerCall: parseFloat(parseFloat(row.avg_cost).toFixed(6)),
      avgLatencyMs: row.avg_latency_ms !== null ? Math.round(parseFloat(row.avg_latency_ms)) : 0,
      callCount: parseInt(row.count, 10),
    }));

    const byDate: CostByDateDto[] = byDateResult.map((row) => ({
      date: typeof row.date === 'string' ? row.date.slice(0, 10) : String(row.date).slice(0, 10),
      costUsd: parseFloat(row.cost),
    }));

    const byAgent: CostByAgentDto[] = byAgentResult.map((row) => ({
      agentName: row.agent_name ?? 'unknown',
      costUsd: parseFloat(row.cost),
    }));

    const tokens = tokenResult[0] ?? { total_input_tokens: '0', total_output_tokens: '0' };

    const dto = new CostSummaryDto();
    dto.totalCostUsd = parseFloat((totalResult[0] ?? { total_cost: '0' }).total_cost);
    dto.totalInputTokens = parseInt(tokens.total_input_tokens, 10);
    dto.totalOutputTokens = parseInt(tokens.total_output_tokens, 10);
    dto.prevPeriodCostUsd = parseFloat((prevResult[0] ?? { total_cost: '0' }).total_cost);
    dto.byModel = byModel;
    dto.byDate = byDate;
    dto.byAgent = byAgent;
    dto.dateFrom = dateFrom;
    dto.dateTo = dateTo;

    return dto;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest src/dashboard/cost/__tests__/cost-enhanced.spec.ts --no-cache`

Expected: PASS

- [ ] **Step 6: Run existing cost tests to verify no regressions**

Run: `cd apps/api && npx jest --no-cache`

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/dashboard/cost/
git commit -m "feat(api): add token totals, model efficiency, period comparison to cost summary"
```

---

## Task 4: Backend — WebSocket span-completed Event

**Files:**
- Modify: `apps/api/src/dashboard/websocket/trace.gateway.ts:39-57`

- [ ] **Step 1: Extend TraceGateway to handle span-completed channel**

Modify `apps/api/src/dashboard/websocket/trace.gateway.ts`. In the `onModuleInit` method, add a second pattern subscription alongside the existing one. Update the `pmessage` handler:

Replace the `pmessage` handler (lines 47-57) with:

```typescript
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const span = JSON.parse(message) as ProcessedSpan;
        const parts = channel.split(':');
        const channelType = parts[1]; // 'spans' or 'spans-completed'
        const traceId = parts[2];
        if (!traceId) return;

        if (channelType === 'spans') {
          this.server.to(`trace:${traceId}`).emit('span-added', span);
        } else if (channelType === 'spans-completed') {
          // Broadcast to all connected clients in the live-feed room
          this.server.to('live-feed').emit('span-completed', span);
        }
      } catch (err) {
        this.logger.warn(`Failed to parse Redis message on channel ${channel}: ${String(err)}`);
      }
    });
```

Update the `psubscribe` call to include the new pattern:

```typescript
    void this.subscriber.psubscribe(
      'agentlens:spans:*',
      'agentlens:spans-completed:*',
      (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to Redis patterns: ${String(err)}`);
        } else {
          this.logger.log('Subscribed to Redis patterns agentlens:spans:* and agentlens:spans-completed:*');
        }
      },
    );
```

Add new subscribe/unsubscribe handlers for live feed:

```typescript
  @SubscribeMessage('subscribe-live-feed')
  async handleSubscribeLiveFeed(client: Socket): Promise<void> {
    await client.join('live-feed');
    this.logger.debug(`Client ${client.id} joined live-feed room`);
  }

  @SubscribeMessage('unsubscribe-live-feed')
  async handleUnsubscribeLiveFeed(client: Socket): Promise<void> {
    await client.leave('live-feed');
    this.logger.debug(`Client ${client.id} left live-feed room`);
  }
```

Add static publish method for completed spans:

```typescript
  static async publishSpanCompleted(redis: Redis, span: ProcessedSpan): Promise<void> {
    const channel = `agentlens:spans-completed:${span.traceId}`;
    await redis.publish(channel, JSON.stringify(span));
  }
```

- [ ] **Step 2: Call publishSpanCompleted from span processor**

Read the span processor to find where `TraceGateway.publishSpan` is called, and add `TraceGateway.publishSpanCompleted` alongside it. This will be in `apps/api/src/span-processor/span-processor.service.ts` or `span-processor.processor.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/dashboard/websocket/trace.gateway.ts apps/api/src/span-processor/
git commit -m "feat(api): add span-completed WebSocket event for live feed"
```

---

## Task 5: Frontend — Types + API Layer Updates

**Files:**
- Modify: `apps/dashboard/src/lib/types.ts`
- Modify: `apps/dashboard/src/lib/api.ts`
- Create: `apps/dashboard/src/lib/timeago.ts`

- [ ] **Step 1: Add Overview types and update existing types**

Modify `apps/dashboard/src/lib/types.ts`. Add at the end of the file:

```typescript
// Overview
export interface HourlyVolume {
  hour: string;
  total: number;
  errors: number;
}

export interface ModelUsage {
  model: string;
  calls: number;
  costUsd: number;
}

export interface TopAgent {
  agentName: string;
  calls: number;
  errors: number;
  avgLatencyMs: number;
  costUsd: number;
}

export interface RecentError {
  traceId: string;
  errorMessage: string;
  agentName?: string;
  model?: string;
  startedAt: string;
}

export interface OverviewData {
  totalRequests: number;
  totalRequestsPrev: number;
  errorCount: number;
  errorCountPrev: number;
  totalCostUsd: number;
  monthCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  activeTraces: number;
  hourlyVolume: HourlyVolume[];
  modelUsage: ModelUsage[];
  topAgents: TopAgent[];
  recentErrors: RecentError[];
}

// Live Feed entry
export interface LiveFeedEntry {
  spanId: string;
  traceId: string;
  projectId: string;
  name: string;
  model?: string;
  provider?: string;
  status: string;
  input?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  startedAt: string;
}
```

Update `TraceSummary` — add `inputPreview`:

```typescript
export interface TraceSummary {
  id: string;
  agentName: string | null;
  status: TraceStatus;
  totalSpans: number;
  totalCostUsd: string;
  totalLatencyMs: number | null;
  startedAt: string;
  inputPreview?: string;
  totalTokens?: number;
}
```

Update `CostSummary` — add enhanced fields:

```typescript
export interface CostSummary {
  totalCostUsd: string;
  avgCostPerTrace: string;
  mostExpensiveModel: string | null;
  mostExpensiveAgent: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  prevPeriodCostUsd: number;
}
```

Update `CostByModel` — add efficiency fields:

```typescript
export interface CostByModel {
  model: string;
  costUsd: string;
  spanCount: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
  avgLatencyMs: number;
  callCount: number;
}
```

- [ ] **Step 2: Create timeago utility**

Create `apps/dashboard/src/lib/timeago.ts`:

```typescript
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  if (diff < 10 * SECOND) return 'just now';
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}
```

- [ ] **Step 3: Add fetchOverview to API and update existing functions**

Modify `apps/dashboard/src/lib/api.ts`. Add after the imports:

```typescript
import type {
  // ... existing imports ...
  OverviewData,
} from './types';
```

Add the fetchOverview function:

```typescript
// ── Overview ─────────────────────────────────────────────────────────────────

export async function fetchOverview(hours = 24): Promise<OverviewData> {
  const res = await api.get<OverviewData>(`/projects/${getProjectId()}/overview`, {
    params: { hours },
  });
  return res.data;
}
```

Update `TraceListParams` to include new filters:

```typescript
export interface TraceListParams {
  cursor?: string;
  status?: string;
  agentName?: string;
  from?: string;
  to?: string;
  limit?: number;
  model?: string;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  minCostUsd?: number;
  maxCostUsd?: number;
}
```

Update `fetchTraces` to pass new params and map `inputPreview`:

In the `params` object inside `fetchTraces`, add:
```typescript
        model: params.model,
        minLatencyMs: params.minLatencyMs,
        maxLatencyMs: params.maxLatencyMs,
        minCostUsd: params.minCostUsd,
        maxCostUsd: params.maxCostUsd,
```

In the items mapping, add:
```typescript
      inputPreview: t.inputPreview,
      totalTokens: t.totalTokens,
```

(Add `inputPreview?: string` and `totalTokens?: number` to the `ApiTraceSummary` interface too.)

Update `fetchCostSummary` to include new fields:

```typescript
export async function fetchCostSummary(params: CostRangeParams): Promise<CostSummary> {
  const res = await api.get<ApiCostSummaryDto>(`/projects/${getProjectId()}/cost/summary`, {
    params: { dateFrom: params.from, dateTo: params.to },
  });
  const d = res.data;
  const topModel = [...d.byModel].sort((a, b) => b.costUsd - a.costUsd)[0];
  const topAgent = [...d.byAgent].sort((a, b) => b.costUsd - a.costUsd)[0];
  return {
    totalCostUsd: String(d.totalCostUsd),
    avgCostPerTrace: '0',
    mostExpensiveModel: topModel?.model ?? null,
    mostExpensiveAgent: topAgent?.agentName ?? null,
    totalInputTokens: d.totalInputTokens ?? 0,
    totalOutputTokens: d.totalOutputTokens ?? 0,
    prevPeriodCostUsd: d.prevPeriodCostUsd ?? 0,
  };
}
```

Update `ApiCostSummaryDto` to include new fields:

```typescript
interface ApiCostSummaryDto {
  totalCostUsd: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  prevPeriodCostUsd?: number;
  byModel: Array<{
    model: string;
    provider: string;
    costUsd: number;
    spanCount: number;
    avgTokensPerCall?: number;
    avgCostPerCall?: number;
    avgLatencyMs?: number;
    callCount?: number;
  }>;
  byDate: Array<{ date: string; costUsd: number }>;
  byAgent: Array<{ agentName: string; costUsd: number }>;
  dateFrom: string;
  dateTo: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/
git commit -m "feat(dashboard): add overview types, timeago utility, and enhanced API functions"
```

---

## Task 6: Frontend — Layout + Routing Updates

**Files:**
- Modify: `apps/dashboard/src/components/Layout.tsx:51-63`
- Modify: `apps/dashboard/src/App.tsx`

- [ ] **Step 1: Add Overview and Live Feed icons to Layout**

Modify `apps/dashboard/src/components/Layout.tsx`. Add two new icon components before the existing `TracesIcon`:

```typescript
function OverviewIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function LiveFeedIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}
```

Update the `navItems` array to include new items and separate Projects:

```typescript
const mainNavItems: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: <OverviewIcon /> },
  { to: '/traces', label: 'Traces', icon: <TracesIcon /> },
  { to: '/live', label: 'Live Feed', icon: <LiveFeedIcon /> },
  { to: '/cost', label: 'Cost', icon: <CostIcon /> },
  { to: '/alerts', label: 'Alerts', icon: <AlertsIcon /> },
];

const bottomNavItems: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
];
```

Update the `pageTitles` record:

```typescript
const pageTitles: Record<string, string> = {
  '/overview': 'Overview',
  '/traces': 'Traces',
  '/live': 'Live Feed',
  '/cost': 'Cost',
  '/alerts': 'Alerts',
  '/projects': 'Projects',
};
```

Update the nav rendering in the `Layout` component. Replace the single `{navItems.map(...)}` with two sections:

```typescript
        <nav className="flex-1 px-3 py-3 flex flex-col">
          <div className="space-y-0.5">
            {mainNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600/20 text-brand-500 border-l-2 border-brand-500 pl-[10px]'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="mt-auto pt-3 border-t border-gray-800 space-y-0.5">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600/20 text-brand-500 border-l-2 border-brand-500 pl-[10px]'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
```

- [ ] **Step 2: Update App.tsx routes and redirect**

Modify `apps/dashboard/src/App.tsx`:

Add imports for the new pages:

```typescript
import { OverviewPage } from './pages/OverviewPage';
import { LiveFeedPage } from './pages/LiveFeedPage';
```

Update `RootRedirect` to go to `/overview`:

```typescript
function RootRedirect(): React.JSX.Element {
  const token = localStorage.getItem('agentlens_token');
  return <Navigate to={token ? '/overview' : '/login'} replace />;
}
```

Add routes inside the `<Layout>` element:

```typescript
              <Route path="overview" element={<OverviewPage />} />
              <Route path="live" element={<LiveFeedPage />} />
```

(Place them before the `traces` route.)

- [ ] **Step 3: Create placeholder pages so TypeScript compiles**

Create `apps/dashboard/src/pages/OverviewPage.tsx`:

```typescript
import React from 'react';

export function OverviewPage(): React.JSX.Element {
  return <div>Overview — coming soon</div>;
}
```

Create `apps/dashboard/src/pages/LiveFeedPage.tsx`:

```typescript
import React from 'react';

export function LiveFeedPage(): React.JSX.Element {
  return <div>Live Feed — coming soon</div>;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/Layout.tsx apps/dashboard/src/App.tsx apps/dashboard/src/pages/OverviewPage.tsx apps/dashboard/src/pages/LiveFeedPage.tsx
git commit -m "feat(dashboard): add Overview + Live Feed routes, update sidebar navigation"
```

---

## Task 7: Frontend — Overview Page

**Files:**
- Modify: `apps/dashboard/src/pages/OverviewPage.tsx` (replace placeholder)

- [ ] **Step 1: Implement OverviewPage**

Replace `apps/dashboard/src/pages/OverviewPage.tsx` with:

```typescript
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchOverview } from '../lib/api';
import type { OverviewData } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { timeAgo } from '../lib/timeago';

function StatCard({
  label,
  value,
  subtitle,
  delta,
  deltaLabel,
  accent,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: number;
  deltaLabel?: string;
  accent?: 'red' | 'blue';
}): React.JSX.Element {
  const accentClass = accent === 'red' ? 'text-red-400' : accent === 'blue' ? 'text-blue-400' : '';
  const deltaColor = delta !== undefined && delta > 0 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accentClass || 'text-gray-100'}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      {delta !== undefined && deltaLabel && (
        <p className={`text-xs mt-1 ${deltaColor}`}>{deltaLabel}</p>
      )}
    </div>
  );
}

export function OverviewPage(): React.JSX.Element {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn: () => fetchOverview(24),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid md:grid-cols-5 gap-4">
          <div className="md:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5 h-80">
            <SkeletonText lines={6} />
          </div>
          <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5 h-80">
            <SkeletonText lines={5} />
          </div>
        </div>
      </div>
    );
  }

  const requestDelta = data.totalRequestsPrev > 0
    ? ((data.totalRequests - data.totalRequestsPrev) / data.totalRequestsPrev * 100).toFixed(0)
    : null;
  const errorRate = data.totalRequests > 0
    ? (data.errorCount / data.totalRequests * 100).toFixed(1)
    : '0.0';
  const errorDelta = data.errorCountPrev > 0
    ? ((data.errorCount - data.errorCountPrev) / data.errorCountPrev * 100).toFixed(0)
    : null;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Total Requests"
          value={data.totalRequests.toLocaleString()}
          delta={requestDelta ? parseFloat(requestDelta) : undefined}
          deltaLabel={requestDelta ? `${parseFloat(requestDelta) > 0 ? '+' : ''}${requestDelta}% vs yesterday` : undefined}
        />
        <StatCard
          label="Error Rate"
          value={`${errorRate}%`}
          accent={parseFloat(errorRate) > 5 ? 'red' : undefined}
          delta={errorDelta ? parseFloat(errorDelta) : undefined}
          deltaLabel={errorDelta ? `${parseFloat(errorDelta) > 0 ? '+' : ''}${errorDelta}% vs yesterday` : undefined}
        />
        <StatCard
          label="Today's Cost"
          value={`$${data.totalCostUsd.toFixed(2)}`}
          subtitle={`$${data.monthCostUsd.toFixed(2)} this month`}
        />
        <StatCard
          label="Avg Latency"
          value={`${(data.avgLatencyMs / 1000).toFixed(1)}s`}
          subtitle={`P95: ${(data.p95LatencyMs / 1000).toFixed(1)}s`}
        />
        <StatCard
          label="Active Traces"
          value={data.activeTraces}
          accent="blue"
        />
      </div>

      {/* Middle row */}
      <div className="grid md:grid-cols-5 gap-4">
        {/* Request volume chart */}
        <div className="md:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Request Volume (24h)
          </h2>
          {data.hourlyVolume.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.hourlyVolume} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  tickFormatter={(v: string) => new Date(v).getHours() + 'h'}
                />
                <YAxis
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#d1d5db' }}
                  labelFormatter={(v: string) => new Date(v).toLocaleTimeString()}
                />
                <Bar dataKey="total" fill="#3d5ce4" radius={[2, 2, 0, 0]} maxBarSize={24} name="Requests" />
                <Bar dataKey="errors" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={24} name="Errors" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
              No request data
            </div>
          )}
        </div>

        {/* Recent errors */}
        <div className="md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Recent Errors
          </h2>
          {data.recentErrors.length > 0 ? (
            <div className="space-y-3">
              {data.recentErrors.map((err) => (
                <div
                  key={err.traceId}
                  className="bg-gray-800/50 border border-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-800 transition-colors"
                  onClick={() => void navigate(`/traces/${err.traceId}`)}
                >
                  <p className="text-sm text-red-400 truncate">{err.errorMessage}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {err.agentName && <span>{err.agentName}</span>}
                    {err.model && <span>{err.model}</span>}
                    <span>{timeAgo(err.startedAt)}</span>
                  </div>
                </div>
              ))}
              <button
                className="text-xs text-brand-500 hover:underline"
                onClick={() => void navigate('/traces?status=error')}
              >
                View all errors →
              </button>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              No recent errors
            </div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Model usage */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Model Usage
          </h2>
          {data.modelUsage.length > 0 ? (
            <div className="space-y-3">
              {data.modelUsage.map((m) => {
                const maxCalls = Math.max(...data.modelUsage.map((x) => x.calls));
                const pct = maxCalls > 0 ? (m.calls / maxCalls) * 100 : 0;
                return (
                  <div key={m.model}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-200 font-mono">{m.model}</span>
                      <span className="text-gray-500">
                        {m.calls.toLocaleString()} calls · ${m.costUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full">
                      <div
                        className="h-full bg-brand-600 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
              No model data
            </div>
          )}
        </div>

        {/* Top agents table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Top Agents
          </h2>
          {data.topAgents.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left pb-2">Agent</th>
                  <th className="text-right pb-2">Calls</th>
                  <th className="text-right pb-2">Errors</th>
                  <th className="text-right pb-2">Avg Latency</th>
                  <th className="text-right pb-2">Cost</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {data.topAgents.map((a) => (
                  <tr key={a.agentName} className="border-t border-gray-800">
                    <td className="py-2 font-mono text-gray-200 truncate max-w-[140px]">{a.agentName}</td>
                    <td className="py-2 text-right">{a.calls.toLocaleString()}</td>
                    <td className="py-2 text-right text-red-400">{a.errors}</td>
                    <td className="py-2 text-right">{(a.avgLatencyMs / 1000).toFixed(1)}s</td>
                    <td className="py-2 text-right">${a.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
              No agent data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/OverviewPage.tsx
git commit -m "feat(dashboard): implement Overview page with stats, charts, errors, agents"
```

---

## Task 8: Frontend — Enhanced Traces Page

**Files:**
- Modify: `apps/dashboard/src/pages/TracesPage.tsx`
- Create: `apps/dashboard/src/components/SearchBar.tsx`

- [ ] **Step 1: Create SearchBar component**

Create `apps/dashboard/src/components/SearchBar.tsx`:

```typescript
import React, { useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(localValue), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localValue, onChange]);

  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-16 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-gray-500"
        placeholder={placeholder ?? 'Search prompts, responses, errors across all traces...'}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600 bg-gray-700 px-1.5 py-0.5 rounded">
        ⌘K
      </kbd>
    </div>
  );
}
```

- [ ] **Step 2: Update TracesPage**

Replace `apps/dashboard/src/pages/TracesPage.tsx` with the enhanced version. Key changes:

1. Replace 4 stat cards with compact single-line stats bar
2. Add SearchBar at top
3. Add Input Preview column between Agent and Status
4. Add Token Count column
5. Add Model, Latency, Cost filter dropdowns
6. Replace absolute timestamps with relative (with tooltip)
7. Add red background tint to error rows

```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTraces, fetchTraceStats } from '../lib/api';
import type { TraceSummary, TraceStats } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SearchBar } from '../components/SearchBar';
import { SkeletonRow } from '../components/Skeleton';
import { timeAgo } from '../lib/timeago';

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

export function TracesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Filters
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [agentName, setAgentName] = useState('');
  const [debouncedAgent, setDebouncedAgent] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [latencyFilter, setLatencyFilter] = useState('');
  const [costFilter, setCostFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedAgent(agentName), 300);
    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [agentName]);

  // Parse latency filter to min/max
  const latencyRange = (() => {
    switch (latencyFilter) {
      case '<1s': return { minLatencyMs: undefined, maxLatencyMs: 1000 };
      case '1-3s': return { minLatencyMs: 1000, maxLatencyMs: 3000 };
      case '3-5s': return { minLatencyMs: 3000, maxLatencyMs: 5000 };
      case '>5s': return { minLatencyMs: 5000, maxLatencyMs: undefined };
      default: return { minLatencyMs: undefined, maxLatencyMs: undefined };
    }
  })();

  // Parse cost filter
  const costRange = (() => {
    switch (costFilter) {
      case '<0.01': return { minCostUsd: undefined, maxCostUsd: 0.01 };
      case '0.01-0.10': return { minCostUsd: 0.01, maxCostUsd: 0.10 };
      case '>0.10': return { minCostUsd: 0.10, maxCostUsd: undefined };
      default: return { minCostUsd: undefined, maxCostUsd: undefined };
    }
  })();

  // Stats
  const statsQuery = useQuery<TraceStats>({
    queryKey: ['trace-stats'],
    queryFn: fetchTraceStats,
    staleTime: 30_000,
  });

  // Paginated traces
  const tracesQuery = useInfiniteQuery({
    queryKey: [
      'traces', statusFilter, debouncedAgent, dateFrom, dateTo,
      searchQuery, modelFilter, latencyFilter, costFilter,
    ],
    queryFn: ({ pageParam }) =>
      fetchTraces({
        cursor: pageParam,
        status: statusFilter || undefined,
        agentName: debouncedAgent || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        model: modelFilter || undefined,
        ...latencyRange,
        ...costRange,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });

  const allItems: TraceSummary[] = tracesQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const hasMore = tracesQuery.data?.pages[tracesQuery.data.pages.length - 1]?.hasMore ?? false;

  const handleLoadMore = useCallback(() => {
    if (!tracesQuery.isFetchingNextPage) {
      void tracesQuery.fetchNextPage();
    }
  }, [tracesQuery]);

  const hasAnyFilter = statusFilter || debouncedAgent || dateFrom || dateTo || modelFilter || latencyFilter || costFilter;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <SearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* Compact stats bar */}
      {statsQuery.data && (
        <div className="text-sm text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>{statsQuery.data.totalTraces.toLocaleString()} traces</span>
          <span className="text-gray-700">·</span>
          <span>{Math.round(statsQuery.data.errorRate * statsQuery.data.totalTraces)} errors</span>
          <span className="text-gray-700">·</span>
          <span>${parseFloat(statsQuery.data.avgCostUsd).toFixed(2)} total cost</span>
          <span className="text-gray-700">·</span>
          <span>{statsQuery.data.avgLatencyMs > 0 ? `${(statsQuery.data.avgLatencyMs / 1000).toFixed(1)}s avg latency` : '—'}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>

        <input
          className={`${inputClass} w-48`}
          type="text"
          placeholder="Agent name…"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
        />

        <select className={inputClass} value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
          <option value="">All Models</option>
          <option value="gpt-4o">gpt-4o</option>
          <option value="gpt-4o-mini">gpt-4o-mini</option>
          <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
          <option value="claude-3-haiku">claude-3-haiku</option>
        </select>

        <select className={inputClass} value={latencyFilter} onChange={(e) => setLatencyFilter(e.target.value)}>
          <option value="">All Latencies</option>
          <option value="<1s">&lt;1s</option>
          <option value="1-3s">1–3s</option>
          <option value="3-5s">3–5s</option>
          <option value=">5s">&gt;5s</option>
        </select>

        <select className={inputClass} value={costFilter} onChange={(e) => setCostFilter(e.target.value)}>
          <option value="">All Costs</option>
          <option value="<0.01">&lt;$0.01</option>
          <option value="0.01-0.10">$0.01–$0.10</option>
          <option value=">0.10">&gt;$0.10</option>
        </select>

        <input className={inputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
        <span className="text-gray-600 text-sm">to</span>
        <input className={inputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />

        {hasAnyFilter && (
          <button
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md text-sm"
            onClick={() => {
              setStatusFilter('');
              setAgentName('');
              setDebouncedAgent('');
              setDateFrom('');
              setDateTo('');
              setModelFilter('');
              setLatencyFilter('');
              setCostFilter('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-gray-400 uppercase text-xs tracking-wider">
            <tr>
              {['Trace ID', 'Agent', 'Input Preview', 'Status', 'Spans', 'Tokens', 'Cost', 'Latency', 'Time'].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-900">
            {tracesQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={9} />)
            ) : tracesQuery.isError ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-red-400">
                  Failed to load traces. Please try again.
                </td>
              </tr>
            ) : allItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-500">
                    <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm">No traces found</p>
                  </div>
                </td>
              </tr>
            ) : (
              allItems.map((trace) => (
                <tr
                  key={trace.id}
                  className={`hover:bg-gray-800/50 cursor-pointer transition-colors ${
                    trace.status === 'error' ? 'bg-red-950/20' : ''
                  }`}
                  onClick={() => void navigate(`/traces/${trace.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-brand-500 whitespace-nowrap">
                    {trace.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-gray-300 max-w-[140px] truncate">
                    {trace.agentName ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate text-xs">
                    {trace.status === 'error' ? (
                      <span className="text-red-400">{trace.inputPreview ?? '—'}</span>
                    ) : (
                      trace.inputPreview ?? <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={trace.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-300">{trace.totalSpans}</td>
                  <td className="px-4 py-3 font-mono text-gray-300 text-xs">
                    {trace.totalTokens?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-300">
                    ${parseFloat(trace.totalCostUsd).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-300">
                    {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap" title={new Date(trace.startedAt).toLocaleString()}>
                    {timeAgo(trace.startedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <button
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-6 py-2 rounded-md text-sm transition-colors disabled:opacity-50"
            onClick={handleLoadMore}
            disabled={tracesQuery.isFetchingNextPage}
          >
            {tracesQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/TracesPage.tsx apps/dashboard/src/components/SearchBar.tsx
git commit -m "feat(dashboard): enhance Traces page with search, input preview, new filters, compact stats"
```

---

## Task 9: Frontend — Enhanced Trace Detail (Split Panel + SpanInspector)

**Files:**
- Create: `apps/dashboard/src/components/SpanInspector.tsx`
- Modify: `apps/dashboard/src/pages/TraceDetailPage.tsx`
- Modify: `apps/dashboard/src/components/SpanTimeline.tsx`

- [ ] **Step 1: Create SpanInspector component**

Create `apps/dashboard/src/components/SpanInspector.tsx`:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-json';
import type { SpanNode } from '../lib/types';

type Tab = 'io' | 'metadata' | 'raw';

function tryFormatJson(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function CodeBlock({ content, language }: { content: string; language: string }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) Prism.highlightElement(ref.current);
  }, [content]);

  return (
    <pre className="overflow-auto rounded-lg bg-gray-950 text-xs max-h-64 p-0 m-0">
      <code ref={ref} className={`language-${language}`}>
        {language === 'json' ? tryFormatJson(content) : content}
      </code>
    </pre>
  );
}

function detectLanguage(value: string | null): string {
  if (!value) return 'text';
  try { JSON.parse(value); return 'json'; } catch { return 'text'; }
}

function parseMessages(input: string): Array<{ role: string; content: string }> | null {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed) && parsed.every((m) => m.role && m.content)) {
      return parsed as Array<{ role: string; content: string }>;
    }
  } catch { /* not message format */ }
  return null;
}

const roleColors: Record<string, string> = {
  system: 'text-gray-400',
  user: 'text-blue-400',
  assistant: 'text-green-400',
};

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

interface SpanInspectorProps {
  span: SpanNode | null;
}

export function SpanInspector({ span }: SpanInspectorProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('io');

  if (!span) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        Select a span to inspect
      </div>
    );
  }

  const messages = span.input ? parseMessages(span.input) : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold text-gray-100 truncate">{span.name}</span>
        <div className="flex gap-2">
          <button
            className="text-xs px-2 py-1 bg-gray-800 rounded text-gray-400 hover:text-gray-100"
            onClick={() => copyToClipboard(span.input ?? '')}
          >
            Copy Input
          </button>
          <button
            className="text-xs px-2 py-1 bg-gray-800 rounded text-gray-400 hover:text-gray-100"
            onClick={() => copyToClipboard(span.output ?? '')}
          >
            Copy Output
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 shrink-0">
        {([['io', 'Input / Output'], ['metadata', 'Metadata'], ['raw', 'Raw JSON']] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === key
                ? 'text-brand-500 border-b-2 border-brand-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'io' && (
          <>
            {/* Input */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs uppercase tracking-wider text-gray-500">Input</span>
                {span.inputTokens !== null && (
                  <span className="text-xs text-gray-600">{span.inputTokens} tokens</span>
                )}
              </div>
              {messages ? (
                <div className="bg-gray-950 rounded-lg p-3 space-y-3 font-mono text-xs max-h-64 overflow-y-auto">
                  {messages.map((msg, i) => (
                    <div key={i}>
                      <div className="text-gray-600 text-[10px] mb-0.5">// messages[{i}] — {msg.role}</div>
                      <div className={roleColors[msg.role] ?? 'text-gray-300'}>{msg.content}</div>
                    </div>
                  ))}
                </div>
              ) : span.input ? (
                <CodeBlock content={span.input} language={detectLanguage(span.input)} />
              ) : (
                <span className="text-gray-500 text-sm italic">—</span>
              )}
            </div>

            {/* Output */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs uppercase tracking-wider text-gray-500">Output</span>
                {span.outputTokens !== null && (
                  <span className="text-xs text-gray-600">{span.outputTokens} tokens</span>
                )}
              </div>
              {span.output ? (
                <CodeBlock content={span.output} language={detectLanguage(span.output)} />
              ) : (
                <span className="text-gray-500 text-sm italic">—</span>
              )}
            </div>

            {/* Token breakdown bar */}
            <div className="bg-gray-800 rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <div><span className="text-gray-500">Input:</span> <span className="text-gray-200 font-medium">{span.inputTokens ?? 0}</span></div>
              <div><span className="text-gray-500">Output:</span> <span className="text-gray-200 font-medium">{span.outputTokens ?? 0}</span></div>
              <div><span className="text-gray-500">Total:</span> <span className="text-gray-200 font-medium">{(span.inputTokens ?? 0) + (span.outputTokens ?? 0)}</span></div>
              <div><span className="text-gray-500">Cost:</span> <span className="text-green-400 font-medium">${span.costUsd ? parseFloat(span.costUsd).toFixed(4) : '0'}</span></div>
              {span.model && <div><span className="text-gray-500">Model:</span> <span className="text-purple-300 font-medium">{span.model}</span></div>}
            </div>
          </>
        )}

        {activeTab === 'metadata' && (
          <div>
            {Object.keys(span.metadata).length === 0 ? (
              <span className="text-gray-500 text-sm italic">No metadata</span>
            ) : (
              <div className="space-y-2">
                {Object.entries(span.metadata).map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-sm">
                    <span className="text-gray-500 shrink-0 font-mono">{key}:</span>
                    <span className="text-gray-200 font-mono break-all">
                      {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div>
            <div className="flex justify-end mb-2">
              <button
                className="text-xs px-2 py-1 bg-gray-800 rounded text-gray-400 hover:text-gray-100"
                onClick={() => copyToClipboard(JSON.stringify(span, null, 2))}
              >
                Copy
              </button>
            </div>
            <CodeBlock content={JSON.stringify(span, null, 2)} language="json" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update SpanTimeline to show model/tokens/cost**

Modify `apps/dashboard/src/components/SpanTimeline.tsx`. Update the span row to show model, token count, and cost after the name:

Replace the name column `<div>` (the one with `className="w-64"`) with a wider version that includes extra info:

```typescript
            {/* Name + meta column */}
            <div
              className="w-72 shrink-0 flex flex-col gap-0.5 overflow-hidden"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              <div className="flex items-center gap-1.5">
                <StatusDot status={span.status} />
                <span className="truncate text-gray-200">{span.name}</span>
              </div>
              <div className="flex gap-2 ml-4 text-[10px] text-gray-500">
                {span.model && <span>{span.model}</span>}
                {(span.inputTokens !== null || span.outputTokens !== null) && (
                  <span>{(span.inputTokens ?? 0) + (span.outputTokens ?? 0)} tok</span>
                )}
                {span.costUsd && <span>${parseFloat(span.costUsd).toFixed(4)}</span>}
              </div>
            </div>
```

Update the header `<div>` with `w-64` to `w-72` as well.

- [ ] **Step 3: Rewrite TraceDetailPage with split-panel layout**

Replace `apps/dashboard/src/pages/TraceDetailPage.tsx`:

```typescript
import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTraceDetail } from '../lib/api';
import type { SpanNode } from '../lib/types';
import { StatusBadge } from '../components/StatusBadge';
import { SpanTimeline } from '../components/SpanTimeline';
import { SpanInspector } from '../components/SpanInspector';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';
import { useTraceSocket } from '../hooks/useTraceSocket';

function mergeSpanIntoTree(spans: SpanNode[], newSpan: SpanNode): SpanNode[] {
  function insertInto(nodes: SpanNode[]): { nodes: SpanNode[]; inserted: boolean } {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.spanId === newSpan.parentSpanId) {
        const updated = { ...node, children: [...node.children, newSpan] };
        const newNodes = [...nodes];
        newNodes[i] = updated;
        return { nodes: newNodes, inserted: true };
      }
      const result = insertInto(node.children);
      if (result.inserted) {
        const updated = { ...node, children: result.nodes };
        const newNodes = [...nodes];
        newNodes[i] = updated;
        return { nodes: newNodes, inserted: true };
      }
    }
    return { nodes, inserted: false };
  }
  const { nodes, inserted } = insertInto(spans);
  return inserted ? nodes : [...spans, newSpan];
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="text-lg font-semibold text-gray-100">{children}</div>
    </div>
  );
}

function countTokens(spans: SpanNode[]): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const span of spans) {
    input += span.inputTokens ?? 0;
    output += span.outputTokens ?? 0;
    const child = countTokens(span.children);
    input += child.input;
    output += child.output;
  }
  return { input, output };
}

export function TraceDetailPage(): React.JSX.Element {
  const { traceId } = useParams<{ traceId: string }>();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const traceQuery = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetchTraceDetail(traceId!),
    enabled: !!traceId,
    refetchInterval: (query) => query.state.data?.status === 'running' ? 5_000 : false,
  });

  const isRunning = traceQuery.data?.status === 'running';
  const { liveSpans } = useTraceSocket(traceId ?? '', isRunning);

  const mergedSpans = useMemo(() => {
    if (!traceQuery.data) return [];
    let spans = [...traceQuery.data.spans];
    for (const live of liveSpans) {
      spans = mergeSpanIntoTree(spans, live);
    }
    return spans;
  }, [traceQuery.data, liveSpans]);

  const findSpanById = (spans: SpanNode[], id: string): SpanNode | null => {
    for (const span of spans) {
      if (span.spanId === id) return span;
      const found = findSpanById(span.children, id);
      if (found) return found;
    }
    return null;
  };

  const selectedSpan = selectedSpanId ? findSpanById(mergedSpans, selectedSpanId) : null;

  if (traceQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-4 bg-gray-800 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <SkeletonText lines={8} />
        </div>
      </div>
    );
  }

  if (traceQuery.isError) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 text-sm">Failed to load trace. Please try again.</p>
        <Link to="/traces" className="text-brand-500 hover:underline text-sm mt-3 inline-block">← Back to Traces</Link>
      </div>
    );
  }

  const trace = traceQuery.data;
  if (!trace) return <></>;

  const tokens = countTokens(mergedSpans);

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <Link to="/traces" className="text-brand-500 hover:underline">Traces</Link>
        <span className="text-gray-600">/</span>
        <span className="text-gray-300 font-mono">{trace.id.slice(0, 8)}…</span>
        {isRunning && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-blue-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        <SummaryCard label="Status"><StatusBadge status={trace.status} /></SummaryCard>
        <SummaryCard label="Total Spans">{trace.totalSpans + liveSpans.length}</SummaryCard>
        <SummaryCard label="Total Tokens">
          <span>{(tokens.input + tokens.output).toLocaleString()}</span>
          <span className="text-xs text-gray-500 font-normal ml-2">{tokens.input.toLocaleString()} in / {tokens.output.toLocaleString()} out</span>
        </SummaryCard>
        <SummaryCard label="Total Cost">${parseFloat(trace.totalCostUsd).toFixed(4)}</SummaryCard>
        <SummaryCard label="Total Latency">
          {trace.totalLatencyMs !== null ? `${trace.totalLatencyMs}ms` : '—'}
        </SummaryCard>
      </div>

      {/* Split panel: Timeline + Inspector */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-0 border border-gray-800 rounded-xl overflow-hidden">
        {/* Left: Span Timeline */}
        <div className="bg-gray-900 border-r border-gray-800 overflow-auto">
          <div className="px-4 py-3 border-b border-gray-800 text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Span Timeline
          </div>
          <div className="p-3">
            <SpanTimeline
              spans={mergedSpans}
              onSpanClick={(span) => setSelectedSpanId(span.spanId)}
              selectedSpanId={selectedSpanId}
            />
          </div>
        </div>

        {/* Right: Span Inspector */}
        <div className="bg-gray-950 overflow-auto">
          <SpanInspector span={selectedSpan} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/SpanInspector.tsx apps/dashboard/src/components/SpanTimeline.tsx apps/dashboard/src/pages/TraceDetailPage.tsx
git commit -m "feat(dashboard): split-panel trace detail with SpanInspector and enhanced timeline"
```

---

## Task 10: Frontend — Live Feed Page

**Files:**
- Modify: `apps/dashboard/src/pages/LiveFeedPage.tsx` (replace placeholder)

- [ ] **Step 1: Implement LiveFeedPage**

Replace `apps/dashboard/src/pages/LiveFeedPage.tsx`:

```typescript
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import type { LiveFeedEntry } from '../lib/types';
import { timeAgo } from '../lib/timeago';

const WS_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? '';
const MAX_ENTRIES = 200;

export function LiveFeedPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LiveFeedEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const [modelFilter, setModelFilter] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const pauseBufferRef = useRef<LiveFeedEntry[]>([]);
  const [, setTick] = useState(0); // force re-render for timeago

  // Rate tracking
  const recentTimestamps = useRef<number[]>([]);
  const [rate, setRate] = useState(0);

  const addEntry = useCallback((entry: LiveFeedEntry) => {
    recentTimestamps.current.push(Date.now());
    // Keep timestamps from last 5 seconds
    const cutoff = Date.now() - 5000;
    recentTimestamps.current = recentTimestamps.current.filter((t) => t > cutoff);
    setRate(recentTimestamps.current.length / 5);

    if (isPaused) {
      pauseBufferRef.current.push(entry);
    } else {
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    }
  }, [isPaused]);

  useEffect(() => {
    const socket = io(WS_URL + '/ws/traces', {
      auth: { token: localStorage.getItem('agentlens_token') ?? '' },
    });
    socketRef.current = socket;

    socket.emit('subscribe-live-feed');
    socket.on('span-completed', (entry: LiveFeedEntry) => {
      addEntry(entry);
    });

    return () => {
      socket.emit('unsubscribe-live-feed');
      socket.disconnect();
    };
  }, [addEntry]);

  // Tick for relative timestamps
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  function handleResume(): void {
    setEntries((prev) => [...pauseBufferRef.current.reverse(), ...prev].slice(0, MAX_ENTRIES));
    pauseBufferRef.current = [];
    setIsPaused(false);
  }

  const filteredEntries = entries.filter((e) => {
    if (filter === 'errors' && e.status !== 'error') return false;
    if (modelFilter && e.model !== modelFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-sm font-semibold text-gray-200">Live</span>
          <span className="text-xs text-gray-500">— {rate.toFixed(1)} calls/sec</span>
        </div>
        <div className="flex gap-2">
          <select
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-300"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'errors')}
          >
            <option value="all">All</option>
            <option value="errors">Errors Only</option>
          </select>
          <select
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-300"
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
          >
            <option value="">All Models</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
          </select>
          <button
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              isPaused
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
            onClick={() => isPaused ? handleResume() : setIsPaused(true)}
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-0.5">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">
            {entries.length === 0 ? 'Waiting for LLM calls…' : 'No matching entries'}
          </div>
        ) : (
          filteredEntries.map((entry, i) => {
            const isError = entry.status === 'error';
            const isNew = i === 0;
            const age = Date.now() - new Date(entry.startedAt).getTime();
            const opacity = age > 30000 ? 'opacity-50' : age > 20000 ? 'opacity-70' : '';

            return (
              <div
                key={`${entry.spanId}-${i}`}
                className={`rounded px-3 py-2.5 cursor-pointer transition-all ${opacity} ${
                  isError
                    ? 'bg-red-950/20 border border-red-900/30 border-l-[3px] border-l-red-500'
                    : isNew
                      ? 'bg-gray-900 border border-gray-800 border-l-[3px] border-l-brand-500'
                      : 'bg-gray-900 border border-gray-800 border-l-[3px] border-l-transparent'
                }`}
                onClick={() => void navigate(`/traces/${entry.traceId}`)}
              >
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-600 min-w-[55px]">{timeAgo(entry.startedAt)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                    isError
                      ? 'bg-red-900/50 text-red-300'
                      : 'bg-green-900/50 text-green-300'
                  }`}>
                    {entry.status}
                  </span>
                  <span className="text-purple-300 font-mono">{entry.name}</span>
                  <span className="text-gray-600">{entry.model ?? ''}</span>
                  <span className="text-gray-400 flex-1 truncate">
                    {isError ? (
                      <span className="text-red-400">{entry.input?.slice(0, 80) ?? ''}</span>
                    ) : (
                      entry.input?.slice(0, 80) ?? ''
                    )}
                  </span>
                  <span className="text-gray-600">{((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0)).toLocaleString()} tok</span>
                  <span className="text-gray-600">{entry.latencyMs ? `${(entry.latencyMs / 1000).toFixed(1)}s` : '—'}</span>
                  <span className={isError ? 'text-gray-600' : 'text-green-400'}>
                    ${(entry.costUsd ?? 0).toFixed(3)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {isPaused && pauseBufferRef.current.length > 0 && (
        <div className="text-center text-xs text-gray-500">
          {pauseBufferRef.current.length} entries buffered while paused
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/LiveFeedPage.tsx
git commit -m "feat(dashboard): implement Live Feed page with real-time WebSocket stream"
```

---

## Task 11: Frontend — Enhanced Cost Page

**Files:**
- Modify: `apps/dashboard/src/pages/CostPage.tsx`
- Create: `apps/dashboard/src/components/ModelEfficiencyTable.tsx`

- [ ] **Step 1: Create ModelEfficiencyTable component**

Create `apps/dashboard/src/components/ModelEfficiencyTable.tsx`:

```typescript
import React, { useState } from 'react';
import type { CostByModel } from '../lib/types';

type SortKey = 'model' | 'callCount' | 'avgTokensPerCall' | 'avgCostPerCall' | 'avgLatencyMs' | 'costUsd';

interface ModelEfficiencyTableProps {
  data: CostByModel[];
}

export function ModelEfficiencyTable({ data }: ModelEfficiencyTableProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('costUsd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...data].sort((a, b) => {
    const aVal = sortKey === 'model' ? a.model : a[sortKey] ?? 0;
    const bVal = sortKey === 'model' ? b.model : b[sortKey] ?? 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const numA = typeof aVal === 'string' ? parseFloat(aVal) : (aVal as number);
    const numB = typeof bVal === 'string' ? parseFloat(bVal) : (bVal as number);
    return sortDir === 'asc' ? numA - numB : numB - numA;
  });

  const columns: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
    { key: 'model', label: 'Model', align: 'left' },
    { key: 'callCount', label: 'Calls', align: 'right' },
    { key: 'avgTokensPerCall', label: 'Avg Tokens', align: 'right' },
    { key: 'avgCostPerCall', label: 'Avg Cost', align: 'right' },
    { key: 'avgLatencyMs', label: 'Avg Latency', align: 'right' },
    { key: 'costUsd', label: 'Total Cost', align: 'right' },
  ];

  return (
    <table className="w-full text-sm">
      <thead className="text-gray-500 text-xs uppercase border-b border-gray-800">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={`pb-2 cursor-pointer hover:text-gray-300 ${
                col.align === 'right' ? 'text-right' : 'text-left'
              }`}
              onClick={() => handleSort(col.key)}
            >
              {col.label}
              {sortKey === col.key && (
                <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-gray-300">
        {sorted.map((m) => (
          <tr key={m.model} className="border-t border-gray-800">
            <td className="py-2 text-purple-300 font-mono">{m.model}</td>
            <td className="py-2 text-right">{m.callCount.toLocaleString()}</td>
            <td className="py-2 text-right">{m.avgTokensPerCall.toLocaleString()}</td>
            <td className="py-2 text-right">${m.avgCostPerCall.toFixed(4)}</td>
            <td className="py-2 text-right">{(m.avgLatencyMs / 1000).toFixed(1)}s</td>
            <td className="py-2 text-right font-semibold">${parseFloat(m.costUsd).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Rewrite CostPage with all enhancements**

Replace `apps/dashboard/src/pages/CostPage.tsx`:

```typescript
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { fetchCostSummary, fetchCostTimeseries, fetchCostByModel, fetchCostByAgent } from '../lib/api';
import { ModelEfficiencyTable } from '../components/ModelEfficiencyTable';
import { SkeletonCard, SkeletonText } from '../components/Skeleton';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: formatDate(from), to: formatDate(to) };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500';

const presets = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function CostPage(): React.JSX.Element {
  const defaultRange = getPresetRange(30);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [activePreset, setActivePreset] = useState<number | null>(30);

  function applyPreset(days: number): void {
    const range = getPresetRange(days);
    setFrom(range.from);
    setTo(range.to);
    setActivePreset(days);
  }

  const rangeParams = { from, to };

  const summaryQuery = useQuery({
    queryKey: ['cost-summary', from, to],
    queryFn: () => fetchCostSummary(rangeParams),
    enabled: !!from && !!to,
  });

  const timeseriesQuery = useQuery({
    queryKey: ['cost-timeseries', from, to],
    queryFn: () => fetchCostTimeseries(rangeParams),
    enabled: !!from && !!to,
  });

  const byModelQuery = useQuery({
    queryKey: ['cost-by-model', from, to],
    queryFn: () => fetchCostByModel(rangeParams),
    enabled: !!from && !!to,
  });

  const byAgentQuery = useQuery({
    queryKey: ['cost-by-agent', from, to],
    queryFn: () => fetchCostByAgent(rangeParams),
    enabled: !!from && !!to,
  });

  const totalAgentCost = byAgentQuery.data?.reduce((sum, a) => sum + parseFloat(a.costUsd), 0) ?? 0;

  const prevDelta = summaryQuery.data?.prevPeriodCostUsd && summaryQuery.data.prevPeriodCostUsd > 0
    ? ((parseFloat(summaryQuery.data.totalCostUsd) - summaryQuery.data.prevPeriodCostUsd) / summaryQuery.data.prevPeriodCostUsd * 100).toFixed(0)
    : null;

  return (
    <div className="space-y-6">
      {/* Date range controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-800 rounded-md p-0.5">
          {presets.map((preset) => (
            <button
              key={preset.days}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activePreset === preset.days
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input className={inputClass} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }} aria-label="From date" />
        <span className="text-gray-600 text-sm">to</span>
        <input className={inputClass} type="date" value={to} onChange={(e) => { setTo(e.target.value); setActivePreset(null); }} aria-label="To date" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : summaryQuery.data ? (
          <>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Cost</p>
              <p className="text-2xl font-semibold text-gray-100">${parseFloat(summaryQuery.data.totalCostUsd).toFixed(2)}</p>
              {prevDelta && (
                <p className={`text-xs mt-1 ${parseFloat(prevDelta) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {parseFloat(prevDelta) > 0 ? '+' : ''}{prevDelta}% vs prev period
                </p>
              )}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Tokens</p>
              <p className="text-2xl font-semibold text-gray-100">
                {formatTokens(summaryQuery.data.totalInputTokens + summaryQuery.data.totalOutputTokens)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatTokens(summaryQuery.data.totalInputTokens)} in / {formatTokens(summaryQuery.data.totalOutputTokens)} out
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Top Model</p>
              <p className="text-xl font-semibold text-purple-300 truncate">{summaryQuery.data.mostExpensiveModel ?? '—'}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Top Agent</p>
              <p className="text-xl font-semibold text-gray-100 truncate">{summaryQuery.data.mostExpensiveAgent ?? '—'}</p>
            </div>
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500">—</p>
            </div>
          ))
        )}
      </div>

      {/* Stacked cost chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Daily Cost Trend</h2>
        {timeseriesQuery.isLoading ? (
          <div className="h-64"><SkeletonText lines={4} /></div>
        ) : timeseriesQuery.data && timeseriesQuery.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={timeseriesQuery.data.map((d) => ({ date: d.date, cost: parseFloat(d.costUsd) }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#374151' }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={60} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#d1d5db' }} formatter={(value: unknown) => [`$${(value as number).toFixed(4)}`, 'Cost']} />
              <Bar dataKey="cost" fill="#6366f1" radius={[2, 2, 0, 0]} maxBarSize={32} name="Daily Cost" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-600 text-sm">No data for this period</div>
        )}
      </div>

      {/* Bottom row: Model Efficiency + Cost by Agent */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Model efficiency table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Model Efficiency</h2>
          {byModelQuery.isLoading ? (
            <SkeletonText lines={4} />
          ) : byModelQuery.data && byModelQuery.data.length > 0 ? (
            <ModelEfficiencyTable data={byModelQuery.data} />
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">No data</div>
          )}
        </div>

        {/* Cost by agent (progress bars) */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Cost by Agent</h2>
          {byAgentQuery.isLoading ? (
            <SkeletonText lines={4} />
          ) : byAgentQuery.data && byAgentQuery.data.length > 0 ? (
            <div className="space-y-3">
              {byAgentQuery.data.map((agent, i) => {
                const cost = parseFloat(agent.costUsd);
                const pct = totalAgentCost > 0 ? (cost / totalAgentCost * 100) : 0;
                const colors = ['bg-brand-600', 'bg-purple-500', 'bg-purple-400', 'bg-purple-300', 'bg-purple-200'];
                return (
                  <div key={agent.agentName}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-200">{agent.agentName}</span>
                      <span className="text-gray-500">${cost.toFixed(2)} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full">
                      <div className={`h-full rounded-full ${colors[i] ?? 'bg-gray-600'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-600 text-sm">No data</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/CostPage.tsx apps/dashboard/src/components/ModelEfficiencyTable.tsx
git commit -m "feat(dashboard): enhance Cost page with tokens, model efficiency, agent progress bars"
```

---

## Task 12: Integration Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd apps/api && npx jest --no-cache`

Expected: All tests PASS

- [ ] **Step 2: Run frontend type check**

Run: `cd apps/dashboard && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Run frontend lint**

Run: `cd apps/dashboard && npx eslint src --ext .ts,.tsx --max-warnings 0`

Expected: No errors (fix any that appear)

- [ ] **Step 4: Run backend lint**

Run: `cd apps/api && npx eslint src --ext .ts --max-warnings 0`

Expected: No errors (fix any that appear)

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "fix: resolve lint issues from dashboard cockpit implementation"
```
