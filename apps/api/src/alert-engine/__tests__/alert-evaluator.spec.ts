import type { DataSource } from 'typeorm';
import { AlertEvaluatorService } from '../alert-evaluator.service';
import { AlertType } from '../../database/entities/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal DataSource mock that returns the provided rows. */
function makeDataSourceMock(rows: Array<{ project_id: string; value: string }>): {
  ds: DataSource;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const ds = {
    query: jest.fn((sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve(rows);
    }),
  } as unknown as DataSource;
  return { ds, calls };
}

// Construct service with all injected deps stubbed to null — only the
// DataSource arg (passed directly to fetch* methods) is exercised.
const service = new AlertEvaluatorService(
  null as never, // alertRepo
  null as never, // projectRepo
  null as never, // dataSource (not used in direct calls)
  null as never, // alertState
  null as never, // notificationQueue
);

const PROJECT_IDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
];

// ---------------------------------------------------------------------------
// error_rate
// ---------------------------------------------------------------------------

describe('AlertEvaluatorService.fetchErrorRateMetrics', () => {
  it('returns a map of projectId → parsed error-rate percentage', async () => {
    const { ds } = makeDataSourceMock([
      { project_id: PROJECT_IDS[0], value: '12.5' },
      { project_id: PROJECT_IDS[1], value: '0' },
    ]);

    const result = await service.fetchErrorRateMetrics(PROJECT_IDS, ds);

    expect(result.get(PROJECT_IDS[0])).toBeCloseTo(12.5);
    expect(result.get(PROJECT_IDS[1])).toBeCloseTo(0);
  });

  it('passes project IDs as the first query parameter', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchErrorRateMetrics(PROJECT_IDS, ds);
    expect(calls[0]?.params[0]).toEqual(PROJECT_IDS);
  });

  it('queries the spans table with a 5-minute window', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchErrorRateMetrics(PROJECT_IDS, ds);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('FROM spans');
    expect(sql).toContain("INTERVAL '5 minutes'");
    expect(sql).toContain("status = 'error'");
  });

  it('returns an empty map when no project IDs are supplied', async () => {
    const result = await service.fetchErrorRateMetrics([], undefined as never);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cost_spike
// ---------------------------------------------------------------------------

describe('AlertEvaluatorService.fetchCostSpikeMetrics', () => {
  it('returns total cost per project', async () => {
    const { ds } = makeDataSourceMock([
      { project_id: PROJECT_IDS[0], value: '0.125' },
    ]);

    const result = await service.fetchCostSpikeMetrics(PROJECT_IDS, ds);

    expect(result.get(PROJECT_IDS[0])).toBeCloseTo(0.125, 6);
  });

  it('queries cost_usd SUM from spans', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchCostSpikeMetrics(PROJECT_IDS, ds);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('SUM(cost_usd)');
    expect(sql).toContain('FROM spans');
    expect(sql).toContain("INTERVAL '5 minutes'");
  });
});

// ---------------------------------------------------------------------------
// latency_p95
// ---------------------------------------------------------------------------

describe('AlertEvaluatorService.fetchLatencyP95Metrics', () => {
  it('returns P95 latency per project', async () => {
    const { ds } = makeDataSourceMock([
      { project_id: PROJECT_IDS[0], value: '850' },
    ]);

    const result = await service.fetchLatencyP95Metrics(PROJECT_IDS, ds);

    expect(result.get(PROJECT_IDS[0])).toBeCloseTo(850);
  });

  it('uses PERCENTILE_CONT(0.95) in the query', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchLatencyP95Metrics(PROJECT_IDS, ds);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('PERCENTILE_CONT(0.95)');
    expect(sql).toContain('latency_ms');
    expect(sql).toContain("INTERVAL '5 minutes'");
  });

  it('filters out NULL latency rows', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchLatencyP95Metrics(PROJECT_IDS, ds);
    expect(calls[0]?.sql).toContain('latency_ms IS NOT NULL');
  });
});

// ---------------------------------------------------------------------------
// failure count
// ---------------------------------------------------------------------------

describe('AlertEvaluatorService.fetchFailureMetrics', () => {
  it('returns failure count per project', async () => {
    const { ds } = makeDataSourceMock([
      { project_id: PROJECT_IDS[0], value: '7' },
    ]);

    const result = await service.fetchFailureMetrics(PROJECT_IDS, ds);

    expect(result.get(PROJECT_IDS[0])).toBe(7);
  });

  it('queries the traces table for error status', async () => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.fetchFailureMetrics(PROJECT_IDS, ds);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('FROM traces');
    expect(sql).toContain("status = 'error'");
    expect(sql).toContain("INTERVAL '5 minutes'");
  });
});

// ---------------------------------------------------------------------------
// computeMetricsForType — dispatch routing
// ---------------------------------------------------------------------------

describe('AlertEvaluatorService.computeMetricsForType', () => {
  const cases: Array<[AlertType, string]> = [
    [AlertType.ERROR_RATE, "status = 'error'"],
    [AlertType.COST_SPIKE, 'SUM(cost_usd)'],
    [AlertType.LATENCY_P95, 'PERCENTILE_CONT(0.95)'],
    [AlertType.FAILURE, 'FROM traces'],
  ];

  it.each(cases)('%s routes to the correct query', async (type, expectedFragment) => {
    const { ds, calls } = makeDataSourceMock([]);
    await service.computeMetricsForType(type, PROJECT_IDS, ds);
    expect(calls[0]?.sql).toContain(expectedFragment);
  });
});
