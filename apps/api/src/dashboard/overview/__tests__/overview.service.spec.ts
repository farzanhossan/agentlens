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
