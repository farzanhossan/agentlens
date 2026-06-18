import { EvaluationsService, computeSummary, computeLabelBreakdown } from '../evaluations.service';
import { F1GroupBy } from '../dto/evaluations.dto';
import type { DataSource } from 'typeorm';

interface RawRow {
  id: string;
  trace_id: string;
  model: string | null;
  started_at: string;
  input: string | null;
  output: string | null;
  expected: string | null;
  predicted: string | null;
  task: string;
  split: string;
  agent_name: string | null;
}

function row(expected: string, predicted: string, overrides: Partial<RawRow> = {}): RawRow {
  return {
    id: overrides.id ?? `span-${Math.random().toString(36).slice(2)}`,
    trace_id: overrides.trace_id ?? 'trace-1',
    model: overrides.model ?? 'gpt-4o',
    started_at: overrides.started_at ?? '2026-06-01T00:00:00.000Z',
    input: overrides.input ?? 'in',
    output: overrides.output ?? 'out',
    expected,
    predicted,
    task: overrides.task ?? 'default',
    split: overrides.split ?? 'default',
    agent_name: overrides.agent_name ?? 'classifier',
  };
}

function makeDataSourceMock(rows: RawRow[]): {
  ds: DataSource;
  queryCalls: Array<{ sql: string; params: unknown[] }>;
} {
  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
  const ds = {
    query: jest.fn((sql: string, params: unknown[]) => {
      queryCalls.push({ sql, params });
      return Promise.resolve(rows);
    }),
  } as unknown as DataSource;
  return { ds, queryCalls };
}

describe('computeSummary', () => {
  it('returns 1 for perfect classification', () => {
    const rows = [
      { expected: 'a', predicted: 'a' },
      { expected: 'b', predicted: 'b' },
    ].map((r) => ({ ...r, spanId: '', traceId: '', model: null, startedAt: '', input: null, output: null, task: 'd', split: 'd', agentName: null }));
    const s = computeSummary(rows);
    expect(s.evaluated).toBe(2);
    expect(s.correct).toBe(2);
    expect(s.accuracy).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
  });

  it('returns accuracy 0 for all-wrong classification', () => {
    const rows = [
      { expected: 'a', predicted: 'b' },
      { expected: 'b', predicted: 'a' },
    ].map((r) => ({ ...r, spanId: '', traceId: '', model: null, startedAt: '', input: null, output: null, task: 'd', split: 'd', agentName: null }));
    const s = computeSummary(rows);
    expect(s.accuracy).toBe(0);
    expect(s.f1).toBe(0);
    expect(s.falsePositive).toBe(2);
    expect(s.falseNegative).toBe(2);
  });

  it('returns zeroes for empty input', () => {
    const s = computeSummary([]);
    expect(s.evaluated).toBe(0);
    expect(s.accuracy).toBe(0);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(0);
    expect(s.f1).toBe(0);
  });
});

describe('computeLabelBreakdown', () => {
  it('computes per-label TP/FP/FN for mixed multiclass data', () => {
    const data = [
      { expected: 'a', predicted: 'a' }, // a: TP
      { expected: 'a', predicted: 'b' }, // a: FN, b: FP
      { expected: 'b', predicted: 'b' }, // b: TP
      { expected: 'c', predicted: 'a' }, // c: FN, a: FP
    ].map((r) => ({ ...r, spanId: '', traceId: '', model: null, startedAt: '', input: null, output: null, task: 'd', split: 'd', agentName: null }));
    const breakdown = computeLabelBreakdown(data);
    const byKey = Object.fromEntries(breakdown.map((b) => [b.key, b]));

    expect(byKey['a']?.truePositive).toBe(1);
    expect(byKey['a']?.falsePositive).toBe(1);
    expect(byKey['a']?.falseNegative).toBe(1);
    expect(byKey['a']?.support).toBe(2);

    expect(byKey['b']?.truePositive).toBe(1);
    expect(byKey['b']?.falsePositive).toBe(1);
    expect(byKey['b']?.falseNegative).toBe(0);

    expect(byKey['c']?.truePositive).toBe(0);
    expect(byKey['c']?.falseNegative).toBe(1);
    expect(byKey['c']?.support).toBe(1);
  });

  it('sorts breakdown rows by lowest F1 first', () => {
    const data = [
      { expected: 'good', predicted: 'good' },
      { expected: 'good', predicted: 'good' },
      { expected: 'bad', predicted: 'other' },
    ].map((r) => ({ ...r, spanId: '', traceId: '', model: null, startedAt: '', input: null, output: null, task: 'd', split: 'd', agentName: null }));
    const breakdown = computeLabelBreakdown(data);
    expect(breakdown[0].f1).toBeLessThanOrEqual(breakdown[breakdown.length - 1].f1);
  });
});

describe('EvaluationsService', () => {
  it('getF1Summary returns micro summary and label breakdown', async () => {
    const { ds } = makeDataSourceMock([
      row('a', 'a'),
      row('a', 'b'),
      row('b', 'b'),
    ]);
    const service = new EvaluationsService(ds);
    const result = await service.getF1Summary('project-1', {});
    expect(result.summary.evaluated).toBe(3);
    expect(result.summary.correct).toBe(2);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it('passes task, split, model, agentName, and date filters into the query', async () => {
    const { ds, queryCalls } = makeDataSourceMock([]);
    const service = new EvaluationsService(ds);
    await service.getF1Summary('project-1', {
      dateFrom: '2026-05-01T00:00:00.000Z',
      dateTo: '2026-06-01T00:00:00.000Z',
      task: 'intent',
      split: 'prod',
      model: 'gpt-4o',
      agentName: 'classifier',
    });
    const call = queryCalls[0];
    expect(call.params).toContain('project-1');
    expect(call.params).toContain('intent');
    expect(call.params).toContain('prod');
    expect(call.params).toContain('gpt-4o');
    expect(call.params).toContain('classifier');
    expect(call.sql).toContain("agentlens,eval,expected");
  });

  it('groups breakdown by agent when groupBy=agent', async () => {
    const { ds } = makeDataSourceMock([
      row('a', 'a', { agent_name: 'agent-1' }),
      row('a', 'b', { agent_name: 'agent-2' }),
    ]);
    const service = new EvaluationsService(ds);
    const result = await service.getF1Summary('project-1', { groupBy: F1GroupBy.AGENT });
    const keys = result.breakdown.map((b) => b.key).sort();
    expect(keys).toEqual(['agent-1', 'agent-2']);
  });

  it('getMisclassifications excludes correct rows and paginates', async () => {
    const { ds } = makeDataSourceMock([
      row('a', 'b', { id: 'wrong-1' }),
      row('a', 'a', { id: 'correct-1' }),
      row('b', 'c', { id: 'wrong-2' }),
    ]);
    const service = new EvaluationsService(ds);
    const result = await service.getMisclassifications('project-1', { limit: 1, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].expected).not.toBe(result.items[0].predicted);
  });

  it('truncates input/output preview to 200 chars', async () => {
    const long = 'x'.repeat(500);
    const { ds } = makeDataSourceMock([row('a', 'b', { input: long, output: long })]);
    const service = new EvaluationsService(ds);
    const result = await service.getMisclassifications('project-1', {});
    expect(result.items[0].inputPreview).toHaveLength(200);
    expect(result.items[0].outputPreview).toHaveLength(200);
  });
});
