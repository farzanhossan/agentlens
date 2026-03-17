import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestController } from './ingest.controller.js';
import { IngestService } from './ingest.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'span-ingestion' }),
  ],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
