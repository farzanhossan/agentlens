/**
 * Index Lifecycle Management (ILM) policy and index template for the
 * agentlens_spans rolling indices.
 *
 * The write alias `agentlens_spans` is used by all reads and writes.
 * ILM rolls over the backing index based on age/size thresholds and
 * moves old data through warm → cold → delete phases.
 */

export const ILM_POLICY_NAME = 'agentlens-spans-policy';
export const INDEX_TEMPLATE_NAME = 'agentlens-spans-template';
export const INDEX_ALIAS = 'agentlens_spans';
export const INDEX_PATTERN = 'agentlens_spans-*';

export interface IlmConfig {
  hotMaxAgeDays: number;
  warmAfterDays: number;
  coldAfterDays: number;
  deleteAfterDays: number;
}

export const DEFAULT_ILM_CONFIG: IlmConfig = {
  hotMaxAgeDays: 7,
  warmAfterDays: 30,
  coldAfterDays: 60,
  deleteAfterDays: 90,
};

export function buildIlmPolicy(config: IlmConfig = DEFAULT_ILM_CONFIG) {
  return {
    policy: {
      phases: {
        hot: {
          min_age: '0ms',
          actions: {
            rollover: {
              max_age: `${config.hotMaxAgeDays}d`,
              max_primary_shard_size: '10gb',
            },
          },
        },
        warm: {
          min_age: `${config.warmAfterDays}d`,
          actions: {
            forcemerge: { max_num_segments: 1 },
            shrink: { number_of_shards: 1 },
            allocate: { number_of_replicas: 0 },
          },
        },
        cold: {
          min_age: `${config.coldAfterDays}d`,
          actions: {
            freeze: {},
          },
        },
        delete: {
          min_age: `${config.deleteAfterDays}d`,
          actions: {
            delete: {},
          },
        },
      },
    },
  };
}
