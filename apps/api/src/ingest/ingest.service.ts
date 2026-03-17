import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class IngestService {
  constructor(
    @InjectQueue('span-ingestion') private readonly spanQueue: Queue,
  ) {}

  async enqueueSpans(spans: unknown[], apiKey: string): Promise<void> {
    const jobs = spans.map((span) => ({
      name: 'ingest-span',
      data: { span, apiKey },
    }));

    await this.spanQueue.addBulk(jobs);
  }
}
