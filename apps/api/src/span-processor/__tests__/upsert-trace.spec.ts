import { SpanProcessorService } from '../span-processor.service';
import type { ProcessedSpan } from '../span-processor.types';
import type { EntityManager } from 'typeorm';

// Mock EntityManager that captures the SQL + params passed to .query()
function makeEntityManagerMock(): {
  em: EntityManager;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const em = {
    query: jest.fn((sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
  return { em, calls };
}

const service = new SpanProcessorService(null as never, null as never);

function processedSpan(overrides: Partial<ProcessedSpan> = {}): ProcessedSpan {
  return {
    spanId: 'span-abc',
    traceId: 'trace-xyz',
    projectId: '00000000-0000-0000-0000-000000000001',
    name: 'openai.chat.completions',
    provider: 'openai',
    model: 'gpt-4o',
    status: 'success',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.00125,
    latencyMs: 350,
    metadata: {},
    startedAt: '2024-06-01T10:00:00.000Z',
    endedAt: '2024-06-01T10:00:00.350Z',
    ...overrides,
  };
}

// New parameter order:
// [0] $1  traceId
// [1] $2  projectId
// [2] $3  agentName
// [3] $4  traceStatus
// [4] $5  totalTokens
// [5] $6  costUsd
// [6] $7  latencyMs
// [7] $8  startedAt
// [8] $9  endedAt
// [9] $10 metadata

describe('SpanProcessorService.upsertTrace', () => {
  it('calls em.query with the correct traceId and projectId', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan(), em);

    expect(calls).toHaveLength(1);
    const [{ params }] = calls;
    expect(params[0]).toBe('trace-xyz');   // $1 = traceId
    expect(params[1]).toBe('00000000-0000-0000-0000-000000000001'); // $2 = projectId
  });

  it('sets agentName from span name when no parentSpanId (root span)', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ parentSpanId: undefined }), em);
    const [{ params }] = calls;
    expect(params[2]).toBe('openai.chat.completions'); // $3 = agentName
  });

  it('sets agentName to null when span has a parentSpanId (child span)', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ parentSpanId: 'parent-span-id' }), em);
    const [{ params }] = calls;
    expect(params[2]).toBeNull(); // $3 = agentName
  });

  it('uses status=error when the span status is error', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ status: 'error' }), em);

    const [{ params }] = calls;
    expect(params[3]).toBe('error'); // $4 = traceStatus
  });

  it('uses status=success when the span status is success', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ status: 'success' }), em);

    const [{ params }] = calls;
    expect(params[3]).toBe('success'); // $4 = traceStatus
  });

  it('sums inputTokens + outputTokens into totalTokens', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(
      processedSpan({ inputTokens: 200, outputTokens: 100 }),
      em,
    );
    const [{ params }] = calls;
    expect(params[4]).toBe(300); // $5 = totalTokens
  });

  it('defaults missing tokens to zero', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(
      processedSpan({ inputTokens: undefined, outputTokens: undefined }),
      em,
    );
    const [{ params }] = calls;
    expect(params[4]).toBe(0);
  });

  it('passes costUsd=0 when span has no cost', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ costUsd: undefined }), em);
    const [{ params }] = calls;
    expect(params[5]).toBe(0); // $6 = costUsd
  });

  it('passes parsed Date for startedAt', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan(), em);
    const [{ params }] = calls;
    expect(params[7]).toBeInstanceOf(Date); // $8 = startedAt
  });

  it('passes null for endedAt when not provided', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ endedAt: undefined }), em);
    const [{ params }] = calls;
    expect(params[8]).toBeNull(); // $9 = endedAt
  });

  it('passes parsed Date for endedAt when provided', async () => {
    const { em, calls } = makeEntityManagerMock();
    await service.upsertTrace(processedSpan({ endedAt: '2024-06-01T10:00:01.000Z' }), em);
    const [{ params }] = calls;
    expect(params[8]).toBeInstanceOf(Date); // $9 = endedAt
  });
});
