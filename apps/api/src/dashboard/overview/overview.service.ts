import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TraceEntity } from '../../database/entities/index.js';
import { TraceStatus } from '../../database/entities/trace.entity.js';
import { ElasticsearchService } from '../../span-processor/elasticsearch/elasticsearch.service.js';
import { withEsFallback } from '../../shared/es-fallback.js';
import {
  ErrorClusterDto,
  HourlyVolumeDto,
  ModelUsageDto,
  OverviewDto,
  RecentErrorDto,
  TopAgentDto,
} from './dto/overview.dto.js';

/* ── Raw SQL row interfaces for Postgres fallback queries ────────────── */

interface PgSummaryRow {
  total_requests: string;
  error_count: string;
  total_cost: string;
  avg_latency_ms: string | null;
  p95_latency_ms: string | null;
}

interface PgPrevSummaryRow {
  total_requests: string;
  error_count: string;
}

interface PgMonthCostRow {
  month_cost: string;
}

interface PgHourlyVolumeRow {
  hour: string | Date;
  total: string;
  errors: string;
}

interface PgModelUsageRow {
  model: string | null;
  calls: string;
  cost: string;
}

interface PgTopAgentRow {
  agent_name: string | null;
  calls: string;
  errors: string;
  avg_latency_ms: string | null;
  cost: string;
}

interface PgRecentErrorRow {
  trace_id: string;
  error_message: string | null;
  agent_name: string | null;
  model: string | null;
  started_at: string | Date;
}

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
    private readonly esService: ElasticsearchService,
  ) {}

  async getOverview(projectId: string, hours: number): Promise<OverviewDto> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - hours * 3600_000).toISOString();
    const prevWindowStart = new Date(now.getTime() - 2 * hours * 3600_000).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const nowIso = now.toISOString();

    // ── ES-powered queries with Postgres fallback ──────────────────────────

    const [
      summaryStats,
      prevStats,
      monthStats,
      hourlyVolume,
      modelUsage,
      topAgents,
      recentErrors,
      activeTraces,
    ] = await Promise.all([
      // 1. Current-period summary
      withEsFallback(
        () => this.esService.getSummaryStats(projectId, windowStart, nowIso),
        async () => {
          const rows = await this.dataSource.query<PgSummaryRow[]>(
            `SELECT COUNT(*) AS total_requests, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count, COALESCE(SUM(total_cost_usd::float), 0) AS total_cost, AVG(total_latency_ms) AS avg_latency_ms, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS p95_latency_ms FROM traces WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3`,
            [projectId, windowStart, nowIso],
          );
          const r: PgSummaryRow = rows[0] ?? { total_requests: '0', error_count: '0', total_cost: '0', avg_latency_ms: null, p95_latency_ms: null };
          return {
            totalSpans: 0,
            errorCount: parseInt(r.error_count ?? '0', 10),
            totalCostUsd: parseFloat(r.total_cost ?? '0'),
            avgLatencyMs: r.avg_latency_ms ? parseFloat(r.avg_latency_ms) : 0,
            p95LatencyMs: r.p95_latency_ms ? parseFloat(r.p95_latency_ms) : 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            uniqueTraces: parseInt(r.total_requests ?? '0', 10),
          };
        },
        this.logger,
      ),

      // 2. Previous-period summary (for deltas)
      withEsFallback(
        () => this.esService.getSummaryStats(projectId, prevWindowStart, windowStart),
        async () => {
          const rows = await this.dataSource.query<PgPrevSummaryRow[]>(
            `SELECT COUNT(*) AS total_requests, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count FROM traces WHERE project_id = $1 AND started_at >= $2 AND started_at < $3`,
            [projectId, prevWindowStart, windowStart],
          );
          const r: PgPrevSummaryRow = rows[0] ?? { total_requests: '0', error_count: '0' };
          return {
            totalSpans: 0, errorCount: parseInt(r.error_count ?? '0', 10),
            totalCostUsd: 0, avgLatencyMs: 0, p95LatencyMs: 0,
            totalInputTokens: 0, totalOutputTokens: 0,
            uniqueTraces: parseInt(r.total_requests ?? '0', 10),
          };
        },
        this.logger,
      ),

      // 3. Month-to-date cost
      withEsFallback(
        () => this.esService.getSummaryStats(projectId, monthStart, nowIso),
        async () => {
          const rows = await this.dataSource.query<PgMonthCostRow[]>(
            `SELECT COALESCE(SUM(total_cost_usd::float), 0) AS month_cost FROM traces WHERE project_id = $1 AND started_at >= $2`,
            [projectId, monthStart],
          );
          const r: PgMonthCostRow = rows[0] ?? { month_cost: '0' };
          return {
            totalSpans: 0, errorCount: 0,
            totalCostUsd: parseFloat(r.month_cost ?? '0'),
            avgLatencyMs: 0, p95LatencyMs: 0,
            totalInputTokens: 0, totalOutputTokens: 0, uniqueTraces: 0,
          };
        },
        this.logger,
      ),

      // 4. Hourly volume
      withEsFallback(
        () => this.esService.getHourlyVolume(projectId, windowStart, nowIso),
        async () => {
          const rows = await this.dataSource.query<PgHourlyVolumeRow[]>(
            `SELECT date_trunc('hour', started_at) AS hour, COUNT(*) AS total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM traces WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3 GROUP BY date_trunc('hour', started_at) ORDER BY hour ASC`,
            [projectId, windowStart, nowIso],
          );
          return rows.map((r: PgHourlyVolumeRow) => ({
            hour: typeof r.hour === 'string' ? r.hour : new Date(r.hour).toISOString(),
            total: parseInt(r.total, 10),
            errors: parseInt(r.errors, 10),
          }));
        },
        this.logger,
      ),

      // 5. Model usage
      withEsFallback(
        async () => {
          const usage = await this.esService.getModelUsage(projectId, windowStart, nowIso);
          return usage.map((u) => ({ model: u.model, calls: u.calls, costUsd: u.costUsd }));
        },
        async () => {
          const rows = await this.dataSource.query<PgModelUsageRow[]>(
            `SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_usd::float), 0) AS cost FROM spans WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3 AND model IS NOT NULL GROUP BY model ORDER BY calls DESC`,
            [projectId, windowStart, nowIso],
          );
          return rows.map((r: PgModelUsageRow) => ({
            model: r.model ?? 'unknown',
            calls: parseInt(r.calls, 10),
            costUsd: parseFloat(r.cost),
          }));
        },
        this.logger,
      ),

      // 6. Top agents
      withEsFallback(
        async () => {
          const agents = await this.esService.getTopAgents(projectId, windowStart, nowIso);
          return agents.map((a) => ({
            agentName: a.agentName,
            calls: a.traceCount,
            errors: a.errorCount,
            avgLatencyMs: Math.round(a.avgLatencyMs),
            costUsd: a.costUsd,
          }));
        },
        async () => {
          const rows = await this.dataSource.query<PgTopAgentRow[]>(
            `SELECT agent_name, COUNT(*) AS calls, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, AVG(total_latency_ms) AS avg_latency_ms, COALESCE(SUM(total_cost_usd::float), 0) AS cost FROM traces WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3 GROUP BY agent_name ORDER BY calls DESC LIMIT 5`,
            [projectId, windowStart, nowIso],
          );
          return rows.map((r: PgTopAgentRow) => ({
            agentName: r.agent_name ?? 'unknown',
            calls: parseInt(r.calls, 10),
            errors: parseInt(r.errors, 10),
            avgLatencyMs: r.avg_latency_ms ? Math.round(parseFloat(r.avg_latency_ms)) : 0,
            costUsd: parseFloat(r.cost),
          }));
        },
        this.logger,
      ),

      // 7. Recent errors
      withEsFallback(
        async () => {
          const errors = await this.esService.getRecentErrors(projectId, windowStart, nowIso);
          return errors.map((e) => ({
            traceId: e.traceId,
            errorMessage: e.errorMessage || 'Unknown error',
            agentName: e.agentName,
            model: e.model,
            startedAt: e.startedAt,
          }));
        },
        async () => {
          const rows = await this.dataSource.query<PgRecentErrorRow[]>(
            `SELECT t.id AS trace_id, s.error_message, t.agent_name, s.model, t.started_at FROM traces t LEFT JOIN LATERAL (SELECT error_message, model FROM spans WHERE trace_id = t.id AND status = 'error' ORDER BY started_at DESC LIMIT 1) s ON true WHERE t.project_id = $1 AND t.status = 'error' AND t.started_at >= $2 AND t.started_at <= $3 ORDER BY t.started_at DESC LIMIT 5`,
            [projectId, windowStart, nowIso],
          );
          return rows.map((r: PgRecentErrorRow) => ({
            traceId: r.trace_id,
            errorMessage: r.error_message ?? 'Unknown error',
            agentName: r.agent_name ?? undefined,
            model: r.model ?? undefined,
            startedAt: typeof r.started_at === 'string' ? r.started_at : new Date(r.started_at).toISOString(),
          }));
        },
        this.logger,
      ),

      // 8. Active traces count — always Postgres (live state)
      this.traceRepo.count({
        where: { projectId, status: TraceStatus.RUNNING },
      }),
    ]);

    // ── Assemble DTO ─────────────────────────────────────────────────────────

    const dto = new OverviewDto();
    dto.totalRequests = summaryStats.uniqueTraces;
    dto.errorCount = summaryStats.errorCount;
    dto.totalRequestsPrev = prevStats.uniqueTraces;
    dto.errorCountPrev = prevStats.errorCount;
    dto.totalCostUsd = summaryStats.totalCostUsd;
    dto.monthCostUsd = monthStats.totalCostUsd;
    dto.avgLatencyMs = Math.round(summaryStats.avgLatencyMs);
    dto.p95LatencyMs = Math.round(summaryStats.p95LatencyMs);
    dto.activeTraces = activeTraces;

    dto.hourlyVolume = (hourlyVolume as HourlyVolumeDto[]).map((r): HourlyVolumeDto => ({
      hour: r.hour,
      total: r.total,
      errors: r.errors,
    }));

    dto.modelUsage = (modelUsage as ModelUsageDto[]).map((r): ModelUsageDto => ({
      model: r.model,
      calls: r.calls,
      costUsd: r.costUsd,
    }));

    dto.topAgents = (topAgents as TopAgentDto[]).map((r): TopAgentDto => ({
      agentName: r.agentName,
      calls: r.calls,
      errors: r.errors,
      avgLatencyMs: r.avgLatencyMs,
      costUsd: r.costUsd,
    }));

    dto.recentErrors = (recentErrors as RecentErrorDto[]).map((r): RecentErrorDto => ({
      traceId: r.traceId,
      errorMessage: r.errorMessage,
      agentName: r.agentName,
      model: r.model,
      startedAt: r.startedAt,
    }));

    // Error clustering (ES-only, best-effort)
    try {
      const clusters = await this.esService.getErrorClusters(projectId, windowStart, nowIso);
      dto.errorClusters = clusters.map((c): ErrorClusterDto => ({
        pattern: c.pattern,
        count: c.count,
        traceIds: c.traceIds,
        models: c.models,
        lastSeen: c.lastSeen,
      }));
    } catch {
      // Error clusters are optional — if ES fails, skip them
      dto.errorClusters = undefined;
    }

    return dto;
  }
}
