import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AlertChannel } from '../database/entities/index.js';
import type { NotificationPayload } from './notification.service.js';
import { NotificationService } from './notification.service.js';

export interface NotificationJobData {
  alertId: string;
  channel: AlertChannel;
  channelConfig: Record<string, unknown>;
  payload: NotificationPayload;
}

/**
 * Consumes the `notification-dispatch` queue.
 * Each job calls the appropriate NotificationService method.
 * BullMQ will retry up to 3 times with exponential back-off on failure.
 */
@Processor('notification-dispatch', { concurrency: 5 })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { alertId, channel, channelConfig, payload } = job.data;
    this.logger.debug(
      `Dispatching ${channel} notification for alert ${alertId} (job ${job.id ?? '?'})`,
    );

    switch (channel) {
      case AlertChannel.SLACK: {
        const webhookUrl = channelConfig['webhookUrl'] as string;
        await this.notificationService.sendSlack(webhookUrl, payload);
        break;
      }
      case AlertChannel.EMAIL: {
        const to = channelConfig['to'] as string;
        const subject = `[AgentLens] Alert fired: ${payload.alertName}`;
        await this.notificationService.sendEmail(to, subject, payload);
        break;
      }
      case AlertChannel.WEBHOOK: {
        const url = channelConfig['url'] as string;
        await this.notificationService.sendWebhook(url, payload);
        break;
      }
      default:
        this.logger.warn(`Unrecognised notification channel: ${String(channel)}`);
    }
  }
}
