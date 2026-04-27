import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertEntity, AlertFiringEntity, ProjectEntity } from '../database/entities/index.js';
import { SpanProcessorModule } from '../span-processor/span-processor.module.js';
import { AlertEvaluatorProcessor } from './alert-evaluator.processor.js';
import { AlertEvaluatorService } from './alert-evaluator.service.js';
import { AlertStateService } from './alert-state.service.js';
import { NotificationProcessor } from './notification.processor.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertEntity, AlertFiringEntity, ProjectEntity]),
    SpanProcessorModule,

    // Cron queue — the processor bootstraps the repeating job on startup.
    BullModule.registerQueue({
      name: 'alert-evaluation',
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: { count: 100 },
      },
    }),

    // Dispatch queue — consumed by NotificationProcessor with retry logic.
    BullModule.registerQueue({
      name: 'notification-dispatch',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1_000 },
      },
    }),
  ],
  providers: [
    AlertStateService,
    NotificationService,
    AlertEvaluatorService,
    AlertEvaluatorProcessor,
    NotificationProcessor,
  ],
})
export class AlertEngineModule {}
