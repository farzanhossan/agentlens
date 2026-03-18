import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import type { ProcessedSpan } from '../span-processor.types.js';

const INDEX = 'agentlens_spans';

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

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;

  constructor(config: ConfigService) {
    this.client = new Client({
      node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
      requestTimeout: 10_000,
    });
  }

  /** Ensures the `agentlens_spans` index exists with the correct mapping. */
  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.indices.exists({ index: INDEX });
      if (!exists) {
        await this.client.indices.create({ index: INDEX, body: INDEX_MAPPING });
        this.logger.log(`Created Elasticsearch index: ${INDEX}`);
      }
    } catch (err) {
      // Non-fatal — processor can still run; ES writes will fail gracefully
      this.logger.warn(`Failed to ensure ES index "${INDEX}": ${String(err)}`);
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
}
