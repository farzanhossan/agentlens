import { ElasticsearchService } from '../elasticsearch.service';
import type { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Mock ES client
// ---------------------------------------------------------------------------

interface MockClient {
  ping: jest.Mock;
  search: jest.Mock;
  indices: { exists: jest.Mock };
}

function makeService(searchResponse: unknown): ElasticsearchService {
  const mockClient: MockClient = {
    ping: jest.fn().mockResolvedValue(true),
    search: jest.fn().mockResolvedValue(searchResponse),
    indices: { exists: jest.fn().mockResolvedValue(true) },
  };
  const svc = new ElasticsearchService({
    getOrThrow: () => 'http://localhost:9200',
  } as unknown as ConfigService);
  // Replace internal client
  Object.assign(svc, { client: mockClient });
  return svc;
}

// ---------------------------------------------------------------------------
// isHealthy
// ---------------------------------------------------------------------------

describe('ElasticsearchService.isHealthy', () => {
  it('returns true when cluster responds', async () => {
    const svc = makeService({});
    expect(await svc.isHealthy()).toBe(true);
  });

  it('returns false when ping throws', async () => {
    const svc = makeService({});
    const client = svc as unknown as { client: MockClient };
    client.client.ping.mockRejectedValue(new Error('down'));
    expect(await svc.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSummaryStats
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getSummaryStats', () => {
  it('parses aggregation buckets correctly', async () => {
    const svc = makeService({
      hits: { total: { value: 500 } },
      aggregations: {
        error_count: { doc_count: 12 },
        total_cost: { value: 3.75 },
        avg_latency: { value: 450.2 },
        latency_percentiles: { values: { '95.0': 1200 } },
        total_input_tokens: { value: 100000 },
        total_output_tokens: { value: 50000 },
        unique_traces: { value: 80 },
      },
    });

    const result = await svc.getSummaryStats('proj-1', '2026-01-01', '2026-01-31');

    expect(result.totalSpans).toBe(500);
    expect(result.errorCount).toBe(12);
    expect(result.totalCostUsd).toBeCloseTo(3.75);
    expect(result.avgLatencyMs).toBeCloseTo(450.2);
    expect(result.p95LatencyMs).toBe(1200);
    expect(result.totalInputTokens).toBe(100000);
    expect(result.totalOutputTokens).toBe(50000);
    expect(result.uniqueTraces).toBe(80);
  });

  it('returns zeros for empty aggregations', async () => {
    const svc = makeService({
      hits: { total: { value: 0 } },
      aggregations: {},
    });

    const result = await svc.getSummaryStats('proj-1', '2026-01-01', '2026-01-31');

    expect(result.totalSpans).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.uniqueTraces).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getHourlyVolume
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getHourlyVolume', () => {
  it('maps date_histogram buckets', async () => {
    const svc = makeService({
      hits: { total: { value: 100 } },
      aggregations: {
        hourly: {
          buckets: [
            { key_as_string: '2026-01-01T10:00:00.000Z', key: 1, doc_count: 50, errors: { doc_count: 3 } },
            { key_as_string: '2026-01-01T11:00:00.000Z', key: 2, doc_count: 50, errors: { doc_count: 0 } },
          ],
        },
      },
    });

    const result = await svc.getHourlyVolume('proj-1', '2026-01-01', '2026-01-02');

    expect(result).toHaveLength(2);
    expect(result[0].hour).toBe('2026-01-01T10:00:00.000Z');
    expect(result[0].total).toBe(50);
    expect(result[0].errors).toBe(3);
    expect(result[1].errors).toBe(0);
  });

  it('returns empty array for no buckets', async () => {
    const svc = makeService({
      hits: { total: { value: 0 } },
      aggregations: { hourly: { buckets: [] } },
    });

    const result = await svc.getHourlyVolume('proj-1', '2026-01-01', '2026-01-02');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getModelUsage
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getModelUsage', () => {
  it('maps model terms buckets with sub-aggs', async () => {
    const svc = makeService({
      hits: { total: { value: 200 } },
      aggregations: {
        models: {
          buckets: [
            {
              key: 'gpt-4o',
              doc_count: 150,
              top_provider: { buckets: [{ key: 'openai' }] },
              total_cost: { value: 2.5 },
              avg_latency: { value: 800 },
              avg_input_tokens: { value: 1000 },
              avg_output_tokens: { value: 500 },
            },
          ],
        },
      },
    });

    const result = await svc.getModelUsage('proj-1', '2026-01-01', '2026-01-31');

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('gpt-4o');
    expect(result[0].provider).toBe('openai');
    expect(result[0].calls).toBe(150);
    expect(result[0].costUsd).toBeCloseTo(2.5);
    expect(result[0].avgTokensPerCall).toBe(1500);
    expect(result[0].avgCostPerCall).toBeCloseTo(2.5 / 150, 6);
    expect(result[0].avgLatencyMs).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// getTopAgents
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getTopAgents', () => {
  it('maps agent terms buckets with cardinality', async () => {
    const svc = makeService({
      hits: { total: { value: 300 } },
      aggregations: {
        agents: {
          buckets: [
            {
              key: 'support-agent',
              doc_count: 200,
              trace_count: { value: 50 },
              error_traces: { unique: { value: 3 } },
              avg_latency: { value: 600 },
              total_cost: { value: 1.2 },
            },
          ],
        },
      },
    });

    const result = await svc.getTopAgents('proj-1', '2026-01-01', '2026-01-31');

    expect(result).toHaveLength(1);
    expect(result[0].agentName).toBe('support-agent');
    expect(result[0].traceCount).toBe(50);
    expect(result[0].errorCount).toBe(3);
    expect(result[0].avgLatencyMs).toBe(600);
    expect(result[0].costUsd).toBeCloseTo(1.2);
  });
});

// ---------------------------------------------------------------------------
// getRecentErrors
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getRecentErrors', () => {
  it('maps collapsed error hits', async () => {
    const svc = makeService({
      hits: {
        total: { value: 5 },
        hits: [
          {
            _source: {
              traceId: 'trace-1',
              errorMessage: 'timeout',
              agentName: 'my-agent',
              model: 'gpt-4o',
              startedAt: '2026-01-01T10:00:00Z',
            },
          },
        ],
      },
    });

    const result = await svc.getRecentErrors('proj-1', '2026-01-01', '2026-01-31');

    expect(result).toHaveLength(1);
    expect(result[0].traceId).toBe('trace-1');
    expect(result[0].errorMessage).toBe('timeout');
    expect(result[0].agentName).toBe('my-agent');
  });
});

// ---------------------------------------------------------------------------
// getCostByDate
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getCostByDate', () => {
  it('maps daily cost buckets', async () => {
    const svc = makeService({
      hits: { total: { value: 100 } },
      aggregations: {
        daily: {
          buckets: [
            { key_as_string: '2026-01-01T00:00:00.000Z', key: 1, cost: { value: 1.5 } },
            { key_as_string: '2026-01-02T00:00:00.000Z', key: 2, cost: { value: 2.3 } },
          ],
        },
      },
    });

    const result = await svc.getCostByDate('proj-1', '2026-01-01', '2026-01-03');

    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-01-01');
    expect(result[0].costUsd).toBeCloseTo(1.5);
    expect(result[1].date).toBe('2026-01-02');
  });
});

// ---------------------------------------------------------------------------
// getCostByAgent
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getCostByAgent', () => {
  it('maps agent cost buckets', async () => {
    const svc = makeService({
      hits: { total: { value: 100 } },
      aggregations: {
        agents: {
          buckets: [
            { key: 'my-agent', cost: { value: 5.0 } },
          ],
        },
      },
    });

    const result = await svc.getCostByAgent('proj-1', '2026-01-01', '2026-01-31');

    expect(result).toHaveLength(1);
    expect(result[0].agentName).toBe('my-agent');
    expect(result[0].costUsd).toBe(5.0);
  });
});

// ---------------------------------------------------------------------------
// getAlertMetrics
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getAlertMetrics', () => {
  it('computes error_rate per project', async () => {
    const svc = makeService({
      hits: { total: { value: 100 } },
      aggregations: {
        by_project: {
          buckets: [
            { key: 'proj-1', doc_count: 100, errors: { doc_count: 10 } },
            { key: 'proj-2', doc_count: 50, errors: { doc_count: 0 } },
          ],
        },
      },
    });

    const result = await svc.getAlertMetrics('error_rate', ['proj-1', 'proj-2']);

    expect(result.get('proj-1')).toBeCloseTo(10);
    expect(result.get('proj-2')).toBe(0);
  });

  it('computes cost_spike per project', async () => {
    const svc = makeService({
      hits: { total: { value: 50 } },
      aggregations: {
        by_project: {
          buckets: [
            { key: 'proj-1', doc_count: 50, total_cost: { value: 0.75 } },
          ],
        },
      },
    });

    const result = await svc.getAlertMetrics('cost_spike', ['proj-1']);
    expect(result.get('proj-1')).toBeCloseTo(0.75);
  });

  it('computes latency_p95 per project', async () => {
    const svc = makeService({
      hits: { total: { value: 50 } },
      aggregations: {
        by_project: {
          buckets: [
            { key: 'proj-1', doc_count: 50, latency_pct: { values: { '95.0': 1500 } } },
          ],
        },
      },
    });

    const result = await svc.getAlertMetrics('latency_p95', ['proj-1']);
    expect(result.get('proj-1')).toBe(1500);
  });

  it('returns empty map for empty projectIds', async () => {
    const svc = makeService({});
    const result = await svc.getAlertMetrics('error_rate', []);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getErrorClusters
// ---------------------------------------------------------------------------

describe('ElasticsearchService.getErrorClusters', () => {
  it('maps error pattern buckets', async () => {
    const svc = makeService({
      hits: { total: { value: 20 } },
      aggregations: {
        error_patterns: {
          buckets: [
            {
              key: 'Connection refused',
              doc_count: 15,
              trace_count: { value: 8 },
              sample_traces: {
                hits: {
                  hits: [
                    { _source: { traceId: 't-1' } },
                    { _source: { traceId: 't-2' } },
                  ],
                },
              },
              affected_models: {
                buckets: [{ key: 'gpt-4o' }],
              },
              last_seen: { value_as_string: '2026-01-15T12:00:00Z' },
            },
          ],
        },
      },
    });

    const result = await svc.getErrorClusters('proj-1', '2026-01-01', '2026-01-31');

    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('Connection refused');
    expect(result[0].count).toBe(8);
    expect(result[0].traceIds).toEqual(['t-1', 't-2']);
    expect(result[0].models).toEqual(['gpt-4o']);
    expect(result[0].lastSeen).toBe('2026-01-15T12:00:00Z');
  });
});
