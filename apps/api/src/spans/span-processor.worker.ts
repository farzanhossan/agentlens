import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SpansService } from './spans.service.js';
import type { SpanEntity } from './span.entity.js';

export interface SpanBatchJob {
  projectId: string;
  spans: Partial<SpanEntity>[];
  receivedAt: number;
}

@Processor('spans')
export class SpanProcessorWorker extends WorkerHost {
  private readonly logger = new Logger(SpanProcessorWorker.name);

  constructor(private readonly spansService: SpansService) {
    super();
  }

  async process(job: Job<SpanBatchJob>): Promise<void> {
    const { projectId, spans } = job.data;
    this.logger.debug(`Processing ${spans.length} spans for project ${projectId}`);

    const enriched = spans.map((s) => ({ ...s, projectId }));
    await this.spansService.ingestBatch(enriched);
  }
}
