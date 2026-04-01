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

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const modelFilter = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('model'),
    );
    expect(modelFilter).toBeDefined();
  });

  it('applies latency range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minLatencyMs: 1000, maxLatencyMs: 5000 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const minLatency = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_latency_ms >='),
    );
    const maxLatency = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_latency_ms <='),
    );
    expect(minLatency).toBeDefined();
    expect(maxLatency).toBeDefined();
  });

  it('applies cost range filters', async () => {
    const qb = makeQueryBuilder([]);
    const traceRepo = makeTraceRepo(qb);
    const service = new TracesService(traceRepo, makeSpanRepo(), makeDataSource(null));

    await service.listTraces('proj-1', { minCostUsd: 0.01, maxCostUsd: 0.10 });

    const andWhereCalls = (qb.andWhere as jest.Mock).mock.calls;
    const minCost = andWhereCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('total_cost_usd'),
    );
    expect(minCost).toBeDefined();
  });
});
