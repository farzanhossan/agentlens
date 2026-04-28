import type { DataSource, Repository } from 'typeorm';
import { OverviewService } from '../overview.service';
import type { ElasticsearchService } from '../../../span-processor/elasticsearch/elasticsearch.service';
import type { SummaryStats } from '../../../span-processor/elasticsearch/elasticsearch.service';
import type { TraceEntity } from '../../../database/entities/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_STATS: SummaryStats = {
  totalSpans: 500,
  errorCount: 10,
  totalCostUsd: 2.5,
  avgLatencyMs: 400,
  p95LatencyMs: 1200,
  totalInputTokens: 80000,
  totalOutputTokens: 40000,
  uniqueTraces: 100,
};

function makeDataSource(): DataSource {
  return {
    query: jest.fn().mockResolvedValue([]),
  } as unknown as DataSource;
}

function makeTraceRepo(count = 0): Repository<TraceEntity> {
  return { count: jest.fn().mockResolvedValue(count) } as unknown as Repository<TraceEntity>;
}

function makeEsService(shouldFail = false): ElasticsearchService {
  const mock = {
    getSummaryStats: shouldFail
      ? jest.fn().mockRejectedValue(new Error('ES down'))
      : jest.fn().mockResolvedValue(DUMMY_STATS),
    getHourlyVolume: shouldFail
      ? jest.fn().mockRejectedValue(new Error('ES down'))
      : jest.fn().mockResolvedValue([]),
    getModelUsage: shouldFail
      ? jest.fn().mockRejectedValue(new Error('ES down'))
      : jest.fn().mockResolvedValue([]),
    getTopAgents: shouldFail
      ? jest.fn().mockRejectedValue(new Error('ES down'))
      : jest.fn().mockResolvedValue([]),
    getRecentErrors: shouldFail
      ? jest.fn().mockRejectedValue(new Error('ES down'))
      : jest.fn().mockResolvedValue([]),
  };
  return mock as unknown as ElasticsearchService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OverviewService — ES fallback', () => {
  it('uses ES when available and does not call Postgres', async () => {
    const ds = makeDataSource();
    const es = makeEsService(false);
    const service = new OverviewService(ds, makeTraceRepo(), es);

    const result = await service.getOverview('proj-1', 24);

    // ES was called
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(es.getSummaryStats).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(es.getHourlyVolume).toHaveBeenCalled();

    // Postgres was NOT called for any analytics query (only for active traces count)
    expect((ds.query as jest.Mock).mock.calls.length).toBe(0);

    // Values come from ES
    expect(result.totalRequests).toBe(DUMMY_STATS.uniqueTraces);
    expect(result.errorCount).toBe(DUMMY_STATS.errorCount);
    expect(result.totalCostUsd).toBeCloseTo(DUMMY_STATS.totalCostUsd);
  });

  it('falls back to Postgres when ES fails', async () => {
    let callIndex = 0;
    const pgResults = [
      // 1. summary
      [{ total_requests: '50', error_count: '2', total_cost: '1.0', avg_latency_ms: '300', p95_latency_ms: '900' }],
      // 2. prev summary
      [{ total_requests: '40', error_count: '1' }],
      // 3. month cost
      [{ month_cost: '10.0' }],
      // 4. hourly
      [{ hour: '2026-01-01T10:00:00Z', total: '30', errors: '1' }],
      // 5. model usage
      [{ model: 'gpt-4o', calls: '20', cost: '0.5' }],
      // 6. top agents
      [{ agent_name: 'agent-1', calls: '15', errors: '1', avg_latency_ms: '200', cost: '0.3' }],
      // 7. recent errors
      [{ trace_id: 't-1', error_message: 'fail', agent_name: 'agent-1', model: 'gpt-4o', started_at: '2026-01-01T12:00:00Z' }],
    ];

    const ds = {
      query: jest.fn(() => Promise.resolve(pgResults[callIndex++] ?? [])),
    } as unknown as DataSource;

    const es = makeEsService(true);
    const service = new OverviewService(ds, makeTraceRepo(), es);

    const result = await service.getOverview('proj-1', 24);

    // ES was attempted
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(es.getSummaryStats).toHaveBeenCalled();

    // Postgres was called as fallback
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ds.query).toHaveBeenCalled();

    // Values come from Postgres fallback
    expect(result.totalRequests).toBe(50);
    expect(result.hourlyVolume).toHaveLength(1);
  });
});
