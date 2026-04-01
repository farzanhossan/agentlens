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
