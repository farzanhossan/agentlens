import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import type { ProcessedSpan } from '../span-processor.types.js';
import {
  ILM_POLICY_NAME,
  INDEX_TEMPLATE_NAME,
  INDEX_ALIAS,
  INDEX_PATTERN,
  buildIlmPolicy,
  type IlmConfig,
} from './ilm-policy.js';

const INDEX = INDEX_ALIAS;

// ── ES Aggregation Response Shapes ──────────────────────────────────────────

/** A single-value metric aggregation result (sum, avg, cardinality, max). */
interface EsValueAgg {
  value: number | null;
  value_as_string?: string;
}

/** A percentiles aggregation result. */
interface EsPercentilesAgg {
  values: Record<string, number | null>;
}

/** A filter aggregation result. */
interface EsFilterAgg {
  doc_count: number;
}

/** A filter aggregation with a nested cardinality sub-aggregation. */
interface EsFilterWithCardinalityAgg extends EsFilterAgg {
  unique: EsValueAgg;
}

/** A generic terms bucket with doc_count and string key. */
interface EsTermsBucket {
  key: string;
  doc_count: number;
}

/** Hourly histogram bucket shape. */
interface EsHourlyBucket {
  key: number;
  key_as_string?: string;
  doc_count: number;
  errors: EsFilterAgg;
}

/** Model usage terms bucket shape. */
interface EsModelBucket extends EsTermsBucket {
  top_provider: { buckets: EsTermsBucket[] };
  total_cost: EsValueAgg;
  avg_latency: EsValueAgg;
  avg_input_tokens: EsValueAgg;
  avg_output_tokens: EsValueAgg;
}

/** Top agents terms bucket shape. */
interface EsAgentBucket extends EsTermsBucket {
  trace_count: EsValueAgg;
  error_traces: EsFilterWithCardinalityAgg;
  avg_latency: EsValueAgg;
  total_cost: EsValueAgg;
}

/** Daily cost histogram bucket shape. */
interface EsDailyBucket {
  key: number;
  key_as_string?: string;
  doc_count: number;
  cost: EsValueAgg;
}

/** Cost-by-agent terms bucket shape. */
interface EsCostByAgentBucket extends EsTermsBucket {
  cost: EsValueAgg;
}

/** Alert metrics per-project bucket shape. */
interface EsAlertProjectBucket extends EsTermsBucket {
  errors?: EsFilterAgg;
  total_cost?: EsValueAgg;
  latency_pct?: EsPercentilesAgg;
}

/** A top_hits result for error clusters. */
interface EsTopHitsResult {
  hits: { hits: Array<{ _source: { traceId?: string } }> };
}

/** Error pattern terms bucket shape. */
interface EsErrorPatternBucket extends EsTermsBucket {
  trace_count: EsValueAgg;
  sample_traces: EsTopHitsResult;
  affected_models: { buckets: EsTermsBucket[] };
  last_seen: EsValueAgg;
}

/** Summary stats aggregation shape. */
interface EsSummaryAggs {
  error_count: EsFilterAgg;
  total_cost: EsValueAgg;
  avg_latency: EsValueAgg;
  latency_percentiles: EsPercentilesAgg;
  total_input_tokens: EsValueAgg;
  total_output_tokens: EsValueAgg;
  unique_traces: EsValueAgg;
}

/** Wraps a buckets aggregation result. */
interface EsBucketsAgg<T> {
  buckets: T[];
}

/** Recent error source shape (partial ProcessedSpan). */
interface EsRecentErrorSource {
  traceId?: string;
  errorMessage?: string;
  agentName?: string;
  model?: string;
  startedAt?: string;
}

/** Elasticsearch hit total — can be number or object with value. */
type EsHitTotal = number | { value: number; relation?: string };

/** Elasticsearch index mapping for spans. */
const INDEX_MAPPING = {
  mappings: {
    properties: {
      spanId: { type: 'keyword' },
      traceId: { type: 'keyword' },
      parentSpanId: { type: 'keyword' },
      projectId: { type: 'keyword' },
      name: { type: 'keyword' },
      model: { type: 'keyword' },
      provider: { type: 'keyword' },
      status: { type: 'keyword' },
      agentName: { type: 'keyword' },
      /** Full LLM prompt text — analyzed for full-text search. */
      input: {
        type: 'text',
        analyzer: 'standard',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      /** Full LLM completion text — analyzed for full-text search. */
      output: {
        type: 'text',
        analyzer: 'standard',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      startedAt: { type: 'date' },
      endedAt: { type: 'date' },
      inputTokens: { type: 'integer' },
      outputTokens: { type: 'integer' },
      costUsd: { type: 'float' },
      latencyMs: { type: 'integer' },
      errorMessage: { type: 'text' },
      metadata: { type: 'object', dynamic: true },
    },
  },
  settings: {
    number_of_shards: 2,
    number_of_replicas: 1,
    refresh_interval: '5s',
  },
} as const;

export interface SpanSearchResult {
  total: number;
  hits: Array<{ _id: string; _source: ProcessedSpan }>;
}

export interface SummaryStats {
  totalSpans: number;
  errorCount: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  uniqueTraces: number;
}

export interface HourlyVolumeBucket {
  hour: string;
  total: number;
  errors: number;
}

export interface ModelUsageBucket {
  model: string;
  provider: string;
  calls: number;
  costUsd: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
  avgLatencyMs: number;
}

export interface TopAgentBucket {
  agentName: string;
  traceCount: number;
  errorCount: number;
  avgLatencyMs: number;
  costUsd: number;
}

export interface RecentError {
  traceId: string;
  errorMessage: string;
  agentName?: string;
  model?: string;
  startedAt: string;
}

export interface CostByDateBucket {
  date: string;
  costUsd: number;
}

export interface CostByAgentBucket {
  agentName: string;
  costUsd: number;
}

export interface ErrorCluster {
  pattern: string;
  count: number;
  traceIds: string[];
  models: string[];
  lastSeen: string;
}

export type AlertMetricType = 'error_rate' | 'cost_spike' | 'latency_p95';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;

  private readonly ilmConfig: IlmConfig;

  constructor(config: ConfigService) {
    this.client = new Client({
      node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
      requestTimeout: 10_000,
    });
    this.ilmConfig = {
      hotMaxAgeDays: parseInt(config.get?.('ES_HOT_DAYS') ?? '7', 10),
      warmAfterDays: parseInt(config.get?.('ES_WARM_DAYS') ?? '30', 10),
      coldAfterDays: parseInt(config.get?.('ES_COLD_DAYS') ?? '60', 10),
      deleteAfterDays: parseInt(config.get?.('ES_DELETE_DAYS') ?? '90', 10),
    };
  }

  /**
   * Sets up ILM policy, index template, and bootstraps the first index
   * if it doesn't already exist. Falls back to a simple index if ILM
   * setup fails (e.g. single-node dev without ILM support).
   */
  async onModuleInit(): Promise<void> {
    try {
      // 1. Create or update ILM policy
      await this.ensureIlmPolicy();

      // 2. Create index template
      await this.ensureIndexTemplate();

      // 3. Bootstrap the first index + alias if alias doesn't exist
      const aliasExists = await this.client.indices.existsAlias({ name: INDEX });
      if (!aliasExists) {
        const exists = await this.client.indices.exists({ index: INDEX });
        if (exists) {
          // Legacy single index exists — keep using it
          this.logger.log(`Using existing index: ${INDEX}`);
        } else {
          // Bootstrap first rolling index
          const firstIndex = `${INDEX}-000001`;
          await this.client.indices.create({
            index: firstIndex,
            body: {
              ...INDEX_MAPPING,
              aliases: { [INDEX]: { is_write_index: true } },
            },
          });
          this.logger.log(`Created initial rolling index: ${firstIndex} with alias ${INDEX}`);
        }
      }
    } catch (err) {
      // Non-fatal — fall back to simple index creation
      this.logger.warn(`ILM setup failed, falling back to simple index: ${String(err)}`);
      try {
        const exists = await this.client.indices.exists({ index: INDEX });
        if (!exists) {
          await this.client.indices.create({ index: INDEX, body: INDEX_MAPPING });
          this.logger.log(`Created simple Elasticsearch index: ${INDEX}`);
        }
      } catch (innerErr) {
        this.logger.warn(`Failed to ensure ES index "${INDEX}": ${String(innerErr)}`);
      }
    }
  }

  private async ensureIlmPolicy(): Promise<void> {
    try {
      await this.client.ilm.putLifecycle({
        name: ILM_POLICY_NAME,
        body: buildIlmPolicy(this.ilmConfig),
      });
      this.logger.log(`ILM policy "${ILM_POLICY_NAME}" ensured`);
    } catch (err) {
      this.logger.warn(`Failed to create ILM policy: ${String(err)}`);
    }
  }

  private async ensureIndexTemplate(): Promise<void> {
    try {
      await this.client.indices.putIndexTemplate({
        name: INDEX_TEMPLATE_NAME,
        body: {
          index_patterns: [INDEX_PATTERN],
          template: {
            settings: {
              ...INDEX_MAPPING.settings,
              'index.lifecycle.name': ILM_POLICY_NAME,
              'index.lifecycle.rollover_alias': INDEX,
            },
            mappings: INDEX_MAPPING.mappings,
          },
        },
      });
      this.logger.log(`Index template "${INDEX_TEMPLATE_NAME}" ensured`);
    } catch (err) {
      this.logger.warn(`Failed to create index template: ${String(err)}`);
    }
  }

  /**
   * Indexes a fully processed span (including input/output text) into
   * Elasticsearch. Uses the spanId as the document ID for idempotency.
   */
  async indexSpan(span: ProcessedSpan): Promise<void> {
    await this.client.index({
      index: INDEX,
      id: span.spanId,
      document: {
        spanId: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        projectId: span.projectId,
        name: span.name,
        model: span.model,
        provider: span.provider,
        status: span.status,
        agentName: span.agentName,
        input: span.input,
        output: span.output,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        costUsd: span.costUsd,
        latencyMs: span.latencyMs,
        errorMessage: span.errorMessage,
        metadata: span.metadata,
      },
    });
  }

  /**
   * Full-text searches spans for a given project using a query string.
   * Searches across `input`, `output`, and `name` fields.
   */
  async searchSpans(
    projectId: string,
    query: string,
    from = 0,
    size = 20,
  ): Promise<SpanSearchResult> {
    const response = await this.client.search<ProcessedSpan>({
      index: INDEX,
      from,
      size,
      query: {
        bool: {
          filter: [{ term: { projectId } }],
          must: query
            ? [
                {
                  multi_match: {
                    query,
                    fields: ['input', 'output', 'name'],
                    type: 'best_fields',
                    fuzziness: 'AUTO',
                  },
                },
              ]
            : [],
        },
      },
      sort: [{ startedAt: { order: 'desc' } }],
    });

    return {
      total:
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0),
      hits: response.hits.hits.map((h) => ({
        _id: h._id ?? '',
        _source: h._source as ProcessedSpan,
      })),
    };
  }

  // ── Helpers ───────────────────────────────���──────────────────────────────────

  private baseFilter(projectId: string, from: string, to: string): object[] {
    return [
      { term: { projectId } },
      { range: { startedAt: { gte: from, lte: to } } },
    ];
  }

  private extractTotal(total: EsHitTotal | undefined): number {
    return typeof total === 'number' ? total : (total?.value ?? 0);
  }

  // ── Aggregation Methods ───────���─────────────────────────────────────────────

  /** Returns true if the ES cluster is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      return await this.client.ping();
    } catch {
      return false;
    }
  }

  /** Summary statistics for a project within a time range. */
  async getSummaryStats(
    projectId: string,
    from: string,
    to: string,
  ): Promise<SummaryStats> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: { bool: { filter: this.baseFilter(projectId, from, to) } },
      aggs: {
        error_count: {
          filter: { term: { status: 'error' } },
        },
        total_cost: { sum: { field: 'costUsd' } },
        avg_latency: { avg: { field: 'latencyMs' } },
        latency_percentiles: {
          percentiles: { field: 'latencyMs', percents: [95] },
        },
        total_input_tokens: { sum: { field: 'inputTokens' } },
        total_output_tokens: { sum: { field: 'outputTokens' } },
        unique_traces: { cardinality: { field: 'traceId' } },
      },
    });

    const aggs = response.aggregations as EsSummaryAggs | undefined;
    return {
      totalSpans: this.extractTotal(response.hits.total as EsHitTotal | undefined),
      errorCount: aggs?.error_count?.doc_count ?? 0,
      totalCostUsd: aggs?.total_cost?.value ?? 0,
      avgLatencyMs: aggs?.avg_latency?.value ?? 0,
      p95LatencyMs: aggs?.latency_percentiles?.values?.['95.0'] ?? 0,
      totalInputTokens: aggs?.total_input_tokens?.value ?? 0,
      totalOutputTokens: aggs?.total_output_tokens?.value ?? 0,
      uniqueTraces: aggs?.unique_traces?.value ?? 0,
    };
  }

  /** Hourly request volume with error breakdown. */
  async getHourlyVolume(
    projectId: string,
    from: string,
    to: string,
  ): Promise<HourlyVolumeBucket[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: { bool: { filter: this.baseFilter(projectId, from, to) } },
      aggs: {
        hourly: {
          date_histogram: {
            field: 'startedAt',
            fixed_interval: '1h',
          },
          aggs: {
            errors: { filter: { term: { status: 'error' } } },
          },
        },
      },
    });

    const aggs = response.aggregations as { hourly: EsBucketsAgg<EsHourlyBucket> } | undefined;
    const buckets: EsHourlyBucket[] = aggs?.hourly?.buckets ?? [];
    return buckets.map((b) => ({
      hour: b.key_as_string ?? new Date(b.key).toISOString(),
      total: b.doc_count,
      errors: b.errors?.doc_count ?? 0,
    }));
  }

  /** Model usage breakdown with cost and performance metrics. */
  async getModelUsage(
    projectId: string,
    from: string,
    to: string,
  ): Promise<ModelUsageBucket[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            ...this.baseFilter(projectId, from, to),
            { exists: { field: 'model' } },
          ],
        },
      },
      aggs: {
        models: {
          terms: { field: 'model', size: 50 },
          aggs: {
            top_provider: {
              terms: { field: 'provider', size: 1 },
            },
            total_cost: { sum: { field: 'costUsd' } },
            avg_latency: { avg: { field: 'latencyMs' } },
            avg_input_tokens: { avg: { field: 'inputTokens' } },
            avg_output_tokens: { avg: { field: 'outputTokens' } },
          },
        },
      },
    });

    const aggs = response.aggregations as { models: EsBucketsAgg<EsModelBucket> } | undefined;
    const buckets: EsModelBucket[] = aggs?.models?.buckets ?? [];
    return buckets.map((b) => ({
      model: b.key,
      provider: b.top_provider?.buckets?.[0]?.key ?? 'unknown',
      calls: b.doc_count,
      costUsd: b.total_cost?.value ?? 0,
      avgTokensPerCall:
        (b.avg_input_tokens?.value ?? 0) + (b.avg_output_tokens?.value ?? 0),
      avgCostPerCall:
        b.doc_count > 0 ? (b.total_cost?.value ?? 0) / b.doc_count : 0,
      avgLatencyMs: b.avg_latency?.value ?? 0,
    }));
  }

  /** Top agents by trace count with error/latency/cost metrics. */
  async getTopAgents(
    projectId: string,
    from: string,
    to: string,
    limit = 5,
  ): Promise<TopAgentBucket[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            ...this.baseFilter(projectId, from, to),
            { exists: { field: 'agentName' } },
          ],
        },
      },
      aggs: {
        agents: {
          terms: { field: 'agentName', size: limit },
          aggs: {
            trace_count: { cardinality: { field: 'traceId' } },
            error_traces: {
              filter: { term: { status: 'error' } },
              aggs: {
                unique: { cardinality: { field: 'traceId' } },
              },
            },
            avg_latency: { avg: { field: 'latencyMs' } },
            total_cost: { sum: { field: 'costUsd' } },
          },
        },
      },
    });

    const aggs = response.aggregations as { agents: EsBucketsAgg<EsAgentBucket> } | undefined;
    const buckets: EsAgentBucket[] = aggs?.agents?.buckets ?? [];
    return buckets.map((b) => ({
      agentName: b.key,
      traceCount: b.trace_count?.value ?? 0,
      errorCount: b.error_traces?.unique?.value ?? 0,
      avgLatencyMs: b.avg_latency?.value ?? 0,
      costUsd: b.total_cost?.value ?? 0,
    }));
  }

  /** Recent errors collapsed by trace ID (one error per trace). */
  async getRecentErrors(
    projectId: string,
    from: string,
    to: string,
    limit = 5,
  ): Promise<RecentError[]> {
    const response = await this.client.search<ProcessedSpan>({
      index: INDEX,
      size: limit,
      query: {
        bool: {
          filter: [
            ...this.baseFilter(projectId, from, to),
            { term: { status: 'error' } },
          ],
        },
      },
      collapse: { field: 'traceId' },
      sort: [{ startedAt: { order: 'desc' } }],
      _source: ['traceId', 'errorMessage', 'agentName', 'model', 'startedAt'],
    });

    return response.hits.hits.map((h) => {
      const s = h._source as EsRecentErrorSource | undefined;
      return {
        traceId: s?.traceId ?? '',
        errorMessage: s?.errorMessage ?? '',
        agentName: s?.agentName,
        model: s?.model,
        startedAt: s?.startedAt ?? '',
      };
    });
  }

  /** Daily cost time series. */
  async getCostByDate(
    projectId: string,
    from: string,
    to: string,
  ): Promise<CostByDateBucket[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: { bool: { filter: this.baseFilter(projectId, from, to) } },
      aggs: {
        daily: {
          date_histogram: {
            field: 'startedAt',
            calendar_interval: '1d',
          },
          aggs: {
            cost: { sum: { field: 'costUsd' } },
          },
        },
      },
    });

    const aggs = response.aggregations as { daily: EsBucketsAgg<EsDailyBucket> } | undefined;
    const buckets: EsDailyBucket[] = aggs?.daily?.buckets ?? [];
    return buckets.map((b) => ({
      date: (b.key_as_string ?? new Date(b.key).toISOString()).slice(0, 10),
      costUsd: b.cost?.value ?? 0,
    }));
  }

  /** Cost breakdown by agent. */
  async getCostByAgent(
    projectId: string,
    from: string,
    to: string,
  ): Promise<CostByAgentBucket[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            ...this.baseFilter(projectId, from, to),
            { exists: { field: 'agentName' } },
          ],
        },
      },
      aggs: {
        agents: {
          terms: { field: 'agentName', size: 50 },
          aggs: {
            cost: { sum: { field: 'costUsd' } },
          },
        },
      },
    });

    const aggs = response.aggregations as { agents: EsBucketsAgg<EsCostByAgentBucket> } | undefined;
    const buckets: EsCostByAgentBucket[] = aggs?.agents?.buckets ?? [];
    return buckets.map((b) => ({
      agentName: b.key,
      costUsd: b.cost?.value ?? 0,
    }));
  }

  /**
   * Batch alert metrics for multiple projects.
   * Returns a map of projectId → metric value.
   */
  async getAlertMetrics(
    type: AlertMetricType,
    projectIds: string[],
    windowMinutes = 5,
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    const now = new Date();
    const from = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
    const to = now.toISOString();

    const subAggs: Record<string, object> = {};
    if (type === 'error_rate') {
      subAggs.errors = { filter: { term: { status: 'error' } } };
    } else if (type === 'cost_spike') {
      subAggs.total_cost = { sum: { field: 'costUsd' } };
    } else if (type === 'latency_p95') {
      subAggs.latency_pct = {
        percentiles: { field: 'latencyMs', percents: [95] },
      };
    }

    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            { terms: { projectId: projectIds } },
            { range: { startedAt: { gte: from, lte: to } } },
          ],
        },
      },
      aggs: {
        by_project: {
          terms: { field: 'projectId', size: projectIds.length },
          aggs: subAggs,
        },
      },
    });

    const aggs = response.aggregations as { by_project: EsBucketsAgg<EsAlertProjectBucket> } | undefined;
    const buckets: EsAlertProjectBucket[] = aggs?.by_project?.buckets ?? [];
    const result = new Map<string, number>();

    for (const b of buckets) {
      let value = 0;
      if (type === 'error_rate') {
        value =
          b.doc_count > 0
            ? ((b.errors?.doc_count ?? 0) / b.doc_count) * 100
            : 0;
      } else if (type === 'cost_spike') {
        value = b.total_cost?.value ?? 0;
      } else if (type === 'latency_p95') {
        value = b.latency_pct?.values?.['95.0'] ?? 0;
      }
      result.set(b.key, value);
    }

    return result;
  }

  /** Groups similar error messages into clusters. */
  async getErrorClusters(
    projectId: string,
    from: string,
    to: string,
    limit = 10,
  ): Promise<ErrorCluster[]> {
    const response = await this.client.search({
      index: INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            ...this.baseFilter(projectId, from, to),
            { term: { status: 'error' } },
            { exists: { field: 'errorMessage' } },
          ],
        },
      },
      aggs: {
        error_patterns: {
          terms: { field: 'errorMessage.keyword', size: limit },
          aggs: {
            trace_count: { cardinality: { field: 'traceId' } },
            sample_traces: {
              top_hits: {
                size: 3,
                _source: ['traceId'],
                sort: [{ startedAt: { order: 'desc' } }],
              },
            },
            affected_models: {
              terms: { field: 'model', size: 5 },
            },
            last_seen: { max: { field: 'startedAt' } },
          },
        },
      },
    });

    const aggs = response.aggregations as { error_patterns: EsBucketsAgg<EsErrorPatternBucket> } | undefined;
    const buckets: EsErrorPatternBucket[] = aggs?.error_patterns?.buckets ?? [];
    return buckets.map((b) => ({
      pattern: b.key,
      count: b.trace_count?.value ?? b.doc_count,
      traceIds: (b.sample_traces?.hits?.hits ?? []).map(
        (h: { _source: { traceId?: string } }) => h._source?.traceId ?? '',
      ),
      models: (b.affected_models?.buckets ?? []).map((m: EsTermsBucket) => m.key),
      lastSeen: b.last_seen?.value_as_string ?? '',
    }));
  }
}
