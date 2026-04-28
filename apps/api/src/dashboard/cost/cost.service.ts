import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProjectEntity } from '../../database/entities/index.js';
import { ElasticsearchService, type SummaryStats } from '../../span-processor/elasticsearch/elasticsearch.service.js';
import { withEsFallback } from '../../shared/es-fallback.js';
import {
  CostByAgentDto,
  CostByDateDto,
  CostByModelDto,
  CostSummaryDto,
  CostTimeseriesDto,
} from './dto/cost.dto.js';

/* ── Raw SQL result-shape interfaces (for type-safe dataSource.query) ── */

interface TotalCostRow {
  total_cost: string;
}

interface TokenRow {
  total_input_tokens: string;
  total_output_tokens: string;
}

interface ModelCostRow {
  model: string;
  provider: string;
  cost: string;
  count: string;
  avg_tokens: string;
  avg_cost: string;
  avg_latency_ms: string | null;
}

interface DateCostRow {
  date: string;
  cost: string;
}

interface AgentCostRow {
  agent_name: string;
  cost: string;
}

@Injectable()
export class CostService {
  private readonly logger = new Logger(CostService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly esService: ElasticsearchService,
  ) {}

  async getSummary(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CostSummaryDto> {
    const periodDays = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400_000;
    const prevFrom = new Date(new Date(dateFrom).getTime() - periodDays * 86400_000).toISOString().split('T')[0];

    // ── ES-powered queries with Postgres fallback ──────────────────────────

    const [summaryStats, prevStats, byModel, byDate, byAgent]: [SummaryStats, number, CostByModelDto[], CostByDateDto[], CostByAgentDto[]] = await Promise.all([
      // 1. Summary stats (total cost, tokens)
      withEsFallback(
        () => this.esService.getSummaryStats(projectId, dateFrom, dateTo),
        async (): Promise<SummaryStats> => {
          const [totalRow, tokenRow] = await Promise.all([
            this.dataSource.query<TotalCostRow[]>(`SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`, [projectId, dateFrom, dateTo]),
            this.dataSource.query<TokenRow[]>(`SELECT COALESCE(SUM(input_tokens), 0) AS total_input_tokens, COALESCE(SUM(output_tokens), 0) AS total_output_tokens FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`, [projectId, dateFrom, dateTo]),
          ]);
          return {
            totalSpans: 0, errorCount: 0,
            totalCostUsd: parseFloat(totalRow[0]?.total_cost ?? '0'),
            avgLatencyMs: 0, p95LatencyMs: 0,
            totalInputTokens: parseInt(tokenRow[0]?.total_input_tokens ?? '0', 10),
            totalOutputTokens: parseInt(tokenRow[0]?.total_output_tokens ?? '0', 10),
            uniqueTraces: 0,
          };
        },
        this.logger,
      ),

      // 2. Previous period cost
      withEsFallback(
        async () => {
          const stats = await this.esService.getSummaryStats(projectId, prevFrom, dateFrom);
          return stats.totalCostUsd;
        },
        async () => {
          const rows = await this.dataSource.query<TotalCostRow[]>(`SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3`, [projectId, prevFrom, dateFrom]);
          return parseFloat(rows[0]?.total_cost ?? '0');
        },
        this.logger,
      ),

      // 3. Cost by model
      withEsFallback(
        async (): Promise<CostByModelDto[]> => {
          const usage = await this.esService.getModelUsage(projectId, dateFrom, dateTo);
          return usage.map((u) => ({
            model: u.model,
            provider: u.provider,
            costUsd: u.costUsd,
            spanCount: u.calls,
            avgTokensPerCall: Math.round(u.avgTokensPerCall),
            avgCostPerCall: parseFloat(u.avgCostPerCall.toFixed(6)),
            avgLatencyMs: Math.round(u.avgLatencyMs),
            callCount: u.calls,
          }));
        },
        async () => {
          const rows = await this.dataSource.query<ModelCostRow[]>(`SELECT model, provider, SUM(cost_usd::float) AS cost, COUNT(*) AS count, AVG(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS avg_tokens, AVG(cost_usd::float) AS avg_cost, AVG(latency_ms) AS avg_latency_ms FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3 GROUP BY model, provider ORDER BY cost DESC`, [projectId, dateFrom, dateTo]);
          return rows.map((row: ModelCostRow) => ({
            model: row.model ?? 'unknown',
            provider: row.provider ?? 'unknown',
            costUsd: parseFloat(row.cost),
            spanCount: parseInt(row.count, 10),
            avgTokensPerCall: Math.round(parseFloat(row.avg_tokens)),
            avgCostPerCall: parseFloat(parseFloat(row.avg_cost).toFixed(6)),
            avgLatencyMs: row.avg_latency_ms !== null ? Math.round(parseFloat(row.avg_latency_ms)) : 0,
            callCount: parseInt(row.count, 10),
          }));
        },
        this.logger,
      ),

      // 4. Cost by date
      withEsFallback(
        async (): Promise<CostByDateDto[]> => {
          const dates = await this.esService.getCostByDate(projectId, dateFrom, dateTo);
          return dates.map((d) => ({ date: d.date, costUsd: d.costUsd }));
        },
        async () => {
          const rows = await this.dataSource.query<DateCostRow[]>(`SELECT DATE(started_at) AS date, SUM(cost_usd::float) AS cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3 GROUP BY DATE(started_at) ORDER BY date ASC`, [projectId, dateFrom, dateTo]);
          return rows.map((row: DateCostRow) => ({
            date: typeof row.date === 'string' ? row.date.slice(0, 10) : String(row.date).slice(0, 10),
            costUsd: parseFloat(row.cost),
          }));
        },
        this.logger,
      ),

      // 5. Cost by agent
      withEsFallback(
        async (): Promise<CostByAgentDto[]> => {
          const agents = await this.esService.getCostByAgent(projectId, dateFrom, dateTo);
          return agents.map((a) => ({ agentName: a.agentName, costUsd: a.costUsd }));
        },
        async () => {
          const rows = await this.dataSource.query<AgentCostRow[]>(`SELECT t.agent_name, SUM(s.cost_usd::float) AS cost FROM spans s JOIN traces t ON t.id = s.trace_id WHERE s.project_id = $1 AND s.started_at BETWEEN $2 AND $3 GROUP BY t.agent_name ORDER BY cost DESC`, [projectId, dateFrom, dateTo]);
          return rows.map((row: AgentCostRow) => ({
            agentName: row.agent_name ?? 'unknown',
            costUsd: parseFloat(row.cost),
          }));
        },
        this.logger,
      ),
    ]);

    const dto = new CostSummaryDto();
    dto.totalCostUsd = summaryStats.totalCostUsd;
    dto.totalInputTokens = summaryStats.totalInputTokens;
    dto.totalOutputTokens = summaryStats.totalOutputTokens;
    dto.prevPeriodCostUsd = prevStats;
    dto.byModel = byModel;
    dto.byDate = byDate;
    dto.byAgent = byAgent;
    dto.dateFrom = dateFrom;
    dto.dateTo = dateTo;

    // 7. Monthly cost + budget (gracefully degrade if migration hasn't run yet)
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthCostResult = await this.dataSource.query<Array<{ total_cost: string }>>(
        `SELECT COALESCE(SUM(cost_usd::float), 0) AS total_cost FROM spans WHERE project_id = $1 AND started_at >= $2`,
        [projectId, monthStart.toISOString()],
      );
      dto.monthCostUsd = parseFloat((monthCostResult[0] ?? { total_cost: '0' }).total_cost);

      const project = await this.projectRepo.findOne({
        where: { id: projectId },
        select: ['id', 'monthlyBudgetUsd'],
      });
      dto.monthlyBudgetUsd = project?.monthlyBudgetUsd
        ? parseFloat(project.monthlyBudgetUsd)
        : undefined;
    } catch {
      // monthly_budget_usd column may not exist yet — skip budget data
      dto.monthCostUsd = undefined;
      dto.monthlyBudgetUsd = undefined;
    }

    return dto;
  }

  async getTimeseries(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CostTimeseriesDto> {
    const dates = await withEsFallback(
      async (): Promise<CostByDateDto[]> => {
        const buckets = await this.esService.getCostByDate(projectId, dateFrom, dateTo);
        return buckets.map((b) => ({ date: b.date, costUsd: b.costUsd }));
      },
      async () => {
        const rows = await this.dataSource.query<Array<{ date: string; cost: string }>>(
          `SELECT DATE(started_at) AS date, SUM(cost_usd::float) AS cost FROM spans WHERE project_id = $1 AND started_at BETWEEN $2 AND $3 GROUP BY DATE(started_at) ORDER BY date ASC`,
          [projectId, dateFrom, dateTo],
        );
        return rows.map((row) => ({
          date: typeof row.date === 'string' ? row.date.slice(0, 10) : String(row.date).slice(0, 10),
          costUsd: parseFloat(row.cost),
        }));
      },
      this.logger,
    );

    return { dates };
  }
}
