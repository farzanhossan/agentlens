import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';
import Redis from 'ioredis';
import { TraceGateway } from '../dashboard/websocket/trace.gateway.js';
import { SpanProcessorService } from './span-processor.service.js';
import type { SpanJobData } from './span-processor.types.js';

const QUEUE_NAME = 'span-ingestion';
const OTEL_TRACER = 'agentlens.span-processor';

/**
 * BullMQ worker that consumes the `span-ingestion` queue.
 *
 * Processing pipeline per job:
 * 1. Validate the raw payload (throws → BullMQ marks job as failed + retries)
 * 2. Scrub PII from input/output text
 * 3. Compute cost from model pricing table
 * 4. Persist to PostgreSQL inside a transaction (upsertTrace + insertSpan)
 * 5. Index full payload (including input/output) to Elasticsearch
 *
 * Each step is wrapped in an OpenTelemetry span for distributed tracing.
 * BullMQ will retry failed jobs up to 3 times with exponential backoff
 * (configured when the job was enqueued by the ingest worker).
 */
@Processor(QUEUE_NAME, { concurrency: 20 })
export class SpanProcessorProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpanProcessorProcessor.name);
  private readonly tracer = trace.getTracer(OTEL_TRACER);
  private publisher!: Redis;

  constructor(
    private readonly service: SpanProcessorService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  onModuleInit(): void {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    const url = new URL(redisUrl);
    this.publisher = new Redis({
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      lazyConnect: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher.quit();
  }

  async process(job: Job<SpanJobData>): Promise<void> {
    const otelSpan = this.tracer.startSpan(`${QUEUE_NAME}.process`, {
      attributes: {
        'job.id': job.id ?? 'unknown',
        'job.name': job.name,
        'job.attemptsMade': job.attemptsMade,
      },
    });

    try {
      // 1. Validate
      const validated = this.service.validateSpan(job.data.span);

      // 2. PII scrub
      const scrubbed = this.service.scrubPII(validated);

      // 3. Cost enrichment
      const enriched = this.service.calculateCost(scrubbed);

      otelSpan.setAttributes({
        'span.id': enriched.spanId,
        'span.traceId': enriched.traceId,
        'span.projectId': enriched.projectId,
        'span.model': enriched.model ?? '',
        'span.provider': enriched.provider ?? '',
        'span.status': enriched.status,
      });

      // 4. PostgreSQL (transactional)
      await this.service.persistSpan(enriched);

      // 5. Elasticsearch (best-effort, errors are swallowed in the service)
      await this.service.indexToElasticsearch(enriched);

      // 6. Publish to Redis for WebSocket live updates (best-effort)
      await Promise.all([
        TraceGateway.publishSpan(this.publisher, enriched),
        TraceGateway.publishSpanCompleted(this.publisher, enriched),
      ]).catch((err) => {
        this.logger.warn(`Redis publish failed for span ${enriched.spanId}: ${String(err)}`);
      });

      otelSpan.setStatus({ code: SpanStatusCode.OK });
      this.logger.debug(`Processed span ${enriched.spanId} (job ${job.id ?? '?'})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to process job ${job.id ?? '?'} (attempt ${job.attemptsMade}): ${message}`,
      );
      otelSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      otelSpan.recordException(err instanceof Error ? err : new Error(message));
      // Re-throw so BullMQ can retry according to the job's backoff config
      throw err;
    } finally {
      otelSpan.end();
    }
  }
}
