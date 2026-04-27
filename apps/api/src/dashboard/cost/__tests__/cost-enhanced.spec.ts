import { CostService } from '../cost.service';
import type { DataSource } from 'typeorm';

function makeDataSource(results: unknown[][]): DataSource {
  let callIndex = 0;
  return {
    query: jest.fn(() => Promise.resolve(results[callIndex++] ?? [])),
  } as unknown as DataSource;
}

describe('CostService — enhanced summary', () => {
  it('returns totalInputTokens, totalOutputTokens, and model efficiency fields', async () => {
    const results = [
      // 1. Total cost
      [{ total_cost: '10.00' }],
      // 2. Token totals
      [{ total_input_tokens: '500000', total_output_tokens: '200000' }],
      // 3. By model (with efficiency fields)
      [{ model: 'gpt-4o', provider: 'openai', cost: '8.00', count: '100', avg_tokens: '3200', avg_cost: '0.08', avg_latency_ms: '2400' }],
      // 4. By date
      [{ date: '2026-04-01', cost: '5.00' }],
      // 5. By agent
      [{ agent_name: 'proxy', cost: '7.00' }],
      // 6. Previous period cost
      [{ total_cost: '8.50' }],
      // 7. Monthly cost
      [{ total_cost: '12.00' }],
    ];

    const ds = makeDataSource(results);
    const projectRepo = { findOne: jest.fn().mockResolvedValue(null) } as never;
    const esService = { getSummaryStats: jest.fn().mockRejectedValue(new Error('no ES')) } as any;
    const service = new CostService(ds, projectRepo, esService);
    const result = await service.getSummary('proj-1', '2026-03-25', '2026-04-01');

    expect(result.totalInputTokens).toBe(500000);
    expect(result.totalOutputTokens).toBe(200000);
    expect(result.prevPeriodCostUsd).toBe(8.5);
    expect(result.byModel[0].avgTokensPerCall).toBe(3200);
    expect(result.byModel[0].avgCostPerCall).toBe(0.08);
    expect(result.byModel[0].avgLatencyMs).toBe(2400);
    expect(result.byModel[0].callCount).toBe(100);
  });
});
