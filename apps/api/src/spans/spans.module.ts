import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SpanEntity } from './span.entity.js';
import { SpansService } from './spans.service.js';
import { SpansController } from './spans.controller.js';
import { SpanProcessorWorker } from './span-processor.worker.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpanEntity]),
    BullModule.registerQueue({ name: 'spans' }),
  ],
  providers: [SpansService, SpanProcessorWorker],
  controllers: [SpansController],
  exports: [SpansService],
})
export class SpansModule {}
