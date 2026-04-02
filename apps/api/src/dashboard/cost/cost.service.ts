import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CostByAgentDto,
  CostByDateDto,
  CostByModelDto,
  CostSummaryDto,
  CostTimeseriesDto,
} from './dto/cost.dto.js';

@Injectable()
export class CostService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getSummary(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CostSummaryDto> {
    // 1. Total cost
    const totalResult = await this.dataSource.query<Array<{ total_cost: string }>>(
      `SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`,
      [projectId, dateFrom, dateTo],
    );

    // 2. Token totals
    const tokenResult = await this.dataSource.query<Array<{ total_input_tokens: string; total_output_tokens: string }>>(
      `SELECT COALESCE(SUM(input_tokens), 0) AS total_input_tokens, COALESCE(SUM(output_tokens), 0) AS total_output_tokens FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`,
      [projectId, dateFrom, dateTo],
    );

    // 3. Cost by model (with efficiency metrics)
    const byModelResult = await this.dataSource.query<Array<{ model: string | null; provider: string | null; cost: string; count: string; avg_tokens: string; avg_cost: string; avg_latency_ms: string | null }>>(
      `SELECT model, provider, SUM(cost_usd::float) AS cost, COUNT(*) AS count, AVG(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS avg_tokens, AVG(cost_usd::float) AS avg_cost, AVG(latency_ms) AS avg_latency_ms FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3 GROUP BY model, provider ORDER BY cost DESC`,
      [projectId, dateFrom, dateTo],
    );

    // 4. Cost by date
    const byDateResult = await this.dataSource.query<Array<{ date: string; cost: string }>>(
      `SELECT DATE(started_at) AS date, SUM(cost_usd::float) AS cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3 GROUP BY DATE(started_at) ORDER BY date ASC`,
      [projectId, dateFrom, dateTo],
    );

    // 5. Cost by agent
    const byAgentResult = await this.dataSource.query<Array<{ agent_name: string | null; cost: string }>>(
      `SELECT t.agent_name, SUM(s.cost_usd::float) AS cost FROM spans s JOIN traces t ON t.id = s.trace_id WHERE s.project_id = $1 AND s.started_at BETWEEN $2 AND $3 GROUP BY t.agent_name ORDER BY cost DESC`,
      [projectId, dateFrom, dateTo],
    );

    // 6. Previous period cost
    const periodDays = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400_000;
    const prevFrom = new Date(new Date(dateFrom).getTime() - periodDays * 86400_000).toISOString().split('T')[0];
    const prevResult = await this.dataSource.query<Array<{ total_cost: string }>>(
      `SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`,
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

  async getTimeseries(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CostTimeseriesDto> {
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

    const dates: CostByDateDto[] = byDateResult.map((row) => ({
      date: typeof row.date === 'string' ? row.date.slice(0, 10) : String(row.date).slice(0, 10),
      costUsd: parseFloat(row.cost),
    }));

    return { dates };
  }
}
