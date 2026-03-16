import { SpanProcessorService } from '../span-processor.service';
import type { RawSpanData } from '../span-processor.types';

// Minimal stubs — SpanProcessorService constructor deps are not exercised here
const service = new SpanProcessorService(
  null as never,
  null as never,
);

function makeSpan(overrides: Partial<RawSpanData> = {}): RawSpanData {
  return {
    spanId: 'span-1',
    traceId: 'trace-1',
    projectId: '00000000-0000-0000-0000-000000000001',
    name: 'test',
    status: 'success',
    metadata: {},
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SpanProcessorService.calculateCost', () => {
  it('computes cost for gpt-4o', () => {
    const span = makeSpan({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1_000,
      outputTokens: 500,
    });
    const result = service.calculateCost(span);
    // input: 1000/1000 * 0.005 = 0.005
    // output: 500/1000 * 0.015 = 0.0075
    // total: 0.0125
    expect(result.costUsd).toBeCloseTo(0.0125, 6);
  });

  it('computes cost for gpt-4o-mini', () => {
    const span = makeSpan({
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 2_000,
      outputTokens: 1_000,
    });
    const result = service.calculateCost(span);
    // input: 2000/1000 * 0.00015 = 0.0003
    // output: 1000/1000 * 0.0006 = 0.0006
    // total: 0.0009
    expect(result.costUsd).toBeCloseTo(0.0009, 6);
  });

  it('computes cost for claude-3-5-sonnet', () => {
    const span = makeSpan({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 500,
      outputTokens: 250,
    });
    const result = service.calculateCost(span);
    // input: 500/1000 * 0.003 = 0.0015
    // output: 250/1000 * 0.015 = 0.00375
    // total: 0.00525
    expect(result.costUsd).toBeCloseTo(0.00525, 6);
  });

  it('returns zero cost for Ollama models', () => {
    const span = makeSpan({
      provider: 'ollama',
      model: 'llama3',
      inputTokens: 1_000,
      outputTokens: 1_000,
    });
    const result = service.calculateCost(span);
    expect(result.costUsd).toBe(0);
  });

  it('returns undefined costUsd for unknown model', () => {
    const span = makeSpan({
      provider: 'openai',
      model: 'gpt-99-unknown',
      inputTokens: 100,
      outputTokens: 100,
    });
    const result = service.calculateCost(span);
    expect(result.costUsd).toBeUndefined();
  });

  it('skips cost calculation when provider is missing', () => {
    const span = makeSpan({ model: 'gpt-4o', inputTokens: 100, outputTokens: 100 });
    const result = service.calculateCost(span);
    expect(result.costUsd).toBeUndefined();
  });

  it('preserves pre-computed costUsd when model is unknown', () => {
    const span = makeSpan({
      provider: 'custom',
      model: 'my-model',
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 0.042,
    });
    const result = service.calculateCost(span);
    expect(result.costUsd).toBe(0.042);
  });

  it('resolves versioned model name', () => {
    const span = makeSpan({
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      inputTokens: 1_000,
      outputTokens: 1_000,
    });
    const result = service.calculateCost(span);
    // 1000/1000 * 0.00025 + 1000/1000 * 0.00125 = 0.0015
    expect(result.costUsd).toBeCloseTo(0.0015, 6);
  });
});
