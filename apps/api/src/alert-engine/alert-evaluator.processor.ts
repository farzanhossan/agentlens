import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { AlertEvaluatorService } from './alert-evaluator.service.js';

const CRON_JOB_NAME = 'evaluate-all-alerts';

/**
 * BullMQ cron worker for the `alert-evaluation` queue.
 *
 * On startup it registers a repeating job (every 5 minutes). BullMQ's
 * deduplicated repeat keys ensure only one schedule exists even if the
 * process restarts.
 *
 * Processing is intentionally thin — all business logic lives in
 * AlertEvaluatorService for testability.
 */
@Processor('alert-evaluation')
export class AlertEvaluatorProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AlertEvaluatorProcessor.name);

  constructor(
    @InjectQueue('alert-evaluation')
    private readonly alertEvalQueue: Queue,
    private readonly service: AlertEvaluatorService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Upsert the repeating cron job. Calling add() with the same repeat key
    // is idempotent in BullMQ v5 — the schedule is not duplicated.
    await this.alertEvalQueue.add(
      CRON_JOB_NAME,
      {},
      {
        repeat: { pattern: '*/5 * * * *' },
        removeOnComplete: 10,
      },
    );
    this.logger.log('Scheduled alert-evaluation cron job (*/5 * * * *)');
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`Starting alert evaluation run (job ${job.id ?? '?'})`);
    const start = Date.now();

    await this.service.evaluateAllAlerts();

    this.logger.log(`Alert evaluation complete in ${Date.now() - start} ms (job ${job.id ?? '?'})`);
  }
}
