import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';
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
export class SpanProcessorProcessor extends WorkerHost {
  private readonly logger = new Logger(SpanProcessorProcessor.name);
  private readonly tracer = trace.getTracer(OTEL_TRACER);

  constructor(private readonly service: SpanProcessorService) {
    super();
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
