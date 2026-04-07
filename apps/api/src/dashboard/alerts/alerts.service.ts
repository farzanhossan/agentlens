import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AlertEntity, AlertFiringEntity } from '../../database/entities/index.js';
import type { NotificationJobData } from '../../alert-engine/notification.processor.js';
import { AlertResponseDto, CreateAlertDto, UpdateAlertDto } from './dto/alerts.dto.js';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(AlertEntity)
    private readonly alertRepo: Repository<AlertEntity>,
    @InjectRepository(AlertFiringEntity)
    private readonly firingRepo: Repository<AlertFiringEntity>,
    @InjectQueue('notification-dispatch')
    private readonly notificationQueue: Queue<NotificationJobData>,
  ) {}

  async list(projectId: string): Promise<AlertResponseDto[]> {
    const alerts = await this.alertRepo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    return alerts.map((a) => AlertResponseDto.fromEntity(a));
  }

  async create(projectId: string, dto: CreateAlertDto): Promise<AlertResponseDto> {
    const alert = this.alertRepo.create({
      projectId,
      name: dto.name,
      type: dto.type,
      threshold: String(dto.threshold),
      channel: dto.channel,
      channelConfig: dto.channelConfig,
      isActive: true,
    });
    const saved = await this.alertRepo.save(alert);
    return AlertResponseDto.fromEntity(saved);
  }

  async update(
    projectId: string,
    alertId: string,
    dto: UpdateAlertDto,
  ): Promise<AlertResponseDto> {
    const alert = await this.alertRepo.findOne({ where: { id: alertId } });
    if (!alert || alert.projectId !== projectId) {
      throw new NotFoundException(`Alert ${alertId} not found`);
    }

    if (dto.name !== undefined) {
      alert.name = dto.name;
    }
    if (dto.type !== undefined) {
      alert.type = dto.type;
    }
    if (dto.threshold !== undefined) {
      alert.threshold = String(dto.threshold);
    }
    if (dto.channel !== undefined) {
      alert.channel = dto.channel;
    }
    if (dto.channelConfig !== undefined) {
      alert.channelConfig = dto.channelConfig;
    }
    if (dto.isActive !== undefined) {
      alert.isActive = dto.isActive;
    }

    const saved = await this.alertRepo.save(alert);
    return AlertResponseDto.fromEntity(saved);
  }

  async remove(projectId: string, alertId: string): Promise<void> {
    const alert = await this.alertRepo.findOne({ where: { id: alertId } });
    if (!alert || alert.projectId !== projectId) {
      throw new NotFoundException(`Alert ${alertId} not found`);
    }
    await this.alertRepo.remove(alert);
  }

  async getHistory(
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<AlertFiringEntity[]> {
    try {
      return await this.firingRepo.find({
        where: { projectId },
        order: { firedAt: 'DESC' },
        take: Math.min(limit, 100),
        skip: offset,
      });
    } catch {
      // alert_firings table may not exist yet if migration hasn't run
      return [];
    }
  }

  async sendTestNotification(projectId: string, alertId: string): Promise<void> {
    const alert = await this.alertRepo.findOne({ where: { id: alertId } });
    if (!alert || alert.projectId !== projectId) {
      throw new NotFoundException(`Alert ${alertId} not found`);
    }

    const dashboardBase = process.env['DASHBOARD_URL'] ?? 'https://app.agentlens.ai';
    const jobData: NotificationJobData = {
      alertId: alert.id,
      channel: alert.channel,
      channelConfig: alert.channelConfig,
      payload: {
        projectName: 'Test Project',
        alertName: `[TEST] ${alert.name}`,
        alertType: alert.type,
        currentValue: 0,
        threshold: parseFloat(alert.threshold),
        dashboardUrl: `${dashboardBase}/projects/${alert.projectId}/alerts`,
      },
    };

    await this.notificationQueue.add('send-notification', jobData, {
      attempts: 1,
    });
  }
}
