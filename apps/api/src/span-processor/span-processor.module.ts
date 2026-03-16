import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SpanProcessorProcessor } from './span-processor.processor.js';
import { SpanProcessorService } from './span-processor.service.js';
import { ElasticsearchService } from './elasticsearch/elasticsearch.service.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'span-ingestion',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    }),
  ],
  providers: [SpanProcessorProcessor, SpanProcessorService, ElasticsearchService],
  exports: [SpanProcessorService, ElasticsearchService],
})
export class SpanProcessorModule {}
