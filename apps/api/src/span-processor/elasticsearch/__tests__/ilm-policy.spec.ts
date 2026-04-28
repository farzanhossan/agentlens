import {
  buildIlmPolicy,
  DEFAULT_ILM_CONFIG,
  ILM_POLICY_NAME,
  INDEX_TEMPLATE_NAME,
  INDEX_ALIAS,
  INDEX_PATTERN,
} from '../ilm-policy';

describe('ILM Policy', () => {
  it('exports correct constant names', () => {
    expect(ILM_POLICY_NAME).toBe('agentlens-spans-policy');
    expect(INDEX_TEMPLATE_NAME).toBe('agentlens-spans-template');
    expect(INDEX_ALIAS).toBe('agentlens_spans');
    expect(INDEX_PATTERN).toBe('agentlens_spans-*');
  });

  it('builds policy with default config', () => {
    const policy = buildIlmPolicy();
    const phases = policy.policy.phases;

    const hotRollover = phases.hot.actions['rollover'] as { max_age: string; max_primary_shard_size: string };
    expect(hotRollover.max_age).toBe('7d');
    expect(hotRollover.max_primary_shard_size).toBe('10gb');
    expect(phases.warm.min_age).toBe('30d');
    const warmForcemerge = phases.warm.actions['forcemerge'] as { max_num_segments: number };
    expect(warmForcemerge.max_num_segments).toBe(1);
    const warmAllocate = phases.warm.actions['allocate'] as { number_of_replicas: number };
    expect(warmAllocate.number_of_replicas).toBe(0);
    expect(phases.cold.min_age).toBe('60d');
    expect(phases.delete.min_age).toBe('90d');
  });

  it('builds policy with custom config', () => {
    const policy = buildIlmPolicy({
      hotMaxAgeDays: 3,
      warmAfterDays: 14,
      coldAfterDays: 30,
      deleteAfterDays: 60,
    });
    const phases = policy.policy.phases;

    const hotRollover = phases.hot.actions['rollover'] as { max_age: string };
    expect(hotRollover.max_age).toBe('3d');
    expect(phases.warm.min_age).toBe('14d');
    expect(phases.cold.min_age).toBe('30d');
    expect(phases.delete.min_age).toBe('60d');
  });

  it('default config has sensible values', () => {
    expect(DEFAULT_ILM_CONFIG.hotMaxAgeDays).toBe(7);
    expect(DEFAULT_ILM_CONFIG.warmAfterDays).toBe(30);
    expect(DEFAULT_ILM_CONFIG.coldAfterDays).toBe(60);
    expect(DEFAULT_ILM_CONFIG.deleteAfterDays).toBe(90);
    // Phases should be in ascending order
    expect(DEFAULT_ILM_CONFIG.warmAfterDays).toBeGreaterThan(DEFAULT_ILM_CONFIG.hotMaxAgeDays);
    expect(DEFAULT_ILM_CONFIG.coldAfterDays).toBeGreaterThan(DEFAULT_ILM_CONFIG.warmAfterDays);
    expect(DEFAULT_ILM_CONFIG.deleteAfterDays).toBeGreaterThan(DEFAULT_ILM_CONFIG.coldAfterDays);
  });
});
