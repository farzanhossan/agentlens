import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertEntity, type AlertCondition, type AlertSeverity } from './alert.entity.js';

export interface CreateAlertDto {
  projectId: string;
  name: string;
  condition: AlertCondition;
  threshold: number;
  severity: AlertSeverity;
  webhookUrl?: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertEntity)
    private readonly repo: Repository<AlertEntity>,
  ) {}

  async create(dto: CreateAlertDto): Promise<AlertEntity> {
    const alert = this.repo.create(dto);
    return this.repo.save(alert);
  }

  async findByProject(projectId: string): Promise<AlertEntity[]> {
    return this.repo.find({ where: { projectId, enabled: true } });
  }

  async evaluate(projectId: string, metrics: Record<string, number>): Promise<void> {
    const alerts = await this.findByProject(projectId);
    for (const alert of alerts) {
      const value = metrics[alert.condition];
      if (value === undefined) continue;
      if (value > alert.threshold) {
        this.logger.warn(
          `Alert fired: [${alert.severity}] ${alert.name} — ${alert.condition}=${value} > ${alert.threshold}`,
        );
        if (alert.webhookUrl) {
          await this.fireWebhook(alert, value);
        }
      }
    }
  }

  private async fireWebhook(alert: AlertEntity, value: number): Promise<void> {
    try {
      await fetch(alert.webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertId: alert.id,
          name: alert.name,
          condition: alert.condition,
          threshold: alert.threshold,
          actualValue: value,
          severity: alert.severity,
          firedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      this.logger.error(`Webhook delivery failed for alert ${alert.id}:`, err);
    }
  }
}
