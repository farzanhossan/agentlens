import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AlertsService, type CreateAlertDto } from './alerts.service.js';
import type { AlertEntity } from './alert.entity.js';

@Controller('v1/projects/:projectId/alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: Omit<CreateAlertDto, 'projectId'>,
  ): Promise<AlertEntity> {
    return this.alertsService.create({ ...body, projectId });
  }

  @Get()
  async list(@Param('projectId') projectId: string): Promise<AlertEntity[]> {
    return this.alertsService.findByProject(projectId);
  }
}
