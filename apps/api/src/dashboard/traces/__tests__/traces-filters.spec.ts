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

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls as unknown[][];
    const modelFilter = andWhereCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('model'),
    );
    expect(modelFilter).toBeDefined();
  });

  it('applies latency range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minLatencyMs: 1000, maxLatencyMs: 5000 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls as unknown[][];
    const minLatency = andWhereCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('total_latency_ms >='),
    );
    const maxLatency = andWhereCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('total_latency_ms <='),
    );
    expect(minLatency).toBeDefined();
    expect(maxLatency).toBeDefined();
  });

  it('applies cost range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minCostUsd: 0.01, maxCostUsd: 0.10 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls as unknown[][];
    const minCost = andWhereCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('total_cost_usd'),
    );
    expect(minCost).toBeDefined();
  });

  it('populates inputPreview from root span input', async () => {
    const traceRow = {
      id: 'trace-1',
      projectId: 'proj-1',
      agentName: 'test',
      status: 'success' as const,
      totalSpans: 1,
      totalCostUsd: '0.01',
      totalLatencyMs: 500,
      startedAt: new Date('2026-04-01'),
      endedAt: new Date('2026-04-01'),
    };
    const qb = makeQueryBuilder([traceRow]);
    const traceRepo = makeTraceRepo(qb);
    const ds = {
      query: jest.fn().mockResolvedValue([{ trace_id: 'trace-1', input_preview: 'Hello world' }]),
    } as unknown as DataSource;
    const service = new TracesService(traceRepo, makeSpanRepo(), ds);

    const result = await service.listTraces('proj-1', {});

    expect(result.data[0].inputPreview).toBe('Hello world');
  });
});
