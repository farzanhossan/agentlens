import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { AlertsService } from './alerts.service.js';
import { AlertResponseDto, CreateAlertDto, UpdateAlertDto } from './dto/alerts.dto.js';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'List all alert rules for a project' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'List of alert rules', type: [AlertResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(@Param('projectId') projectId: string): Promise<AlertResponseDto[]> {
    return this.alertsService.list(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new alert rule' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ status: 201, description: 'Alert rule created', type: AlertResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAlertDto,
  ): Promise<AlertResponseDto> {
    return this.alertsService.create(projectId, dto);
  }

  @Patch(':alertId')
  @ApiOperation({ summary: 'Update an existing alert rule' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'alertId', description: 'Alert rule UUID' })
  @ApiResponse({ status: 200, description: 'Updated alert rule', type: AlertResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async update(
    @Param('projectId') projectId: string,
    @Param('alertId') alertId: string,
    @Body() dto: UpdateAlertDto,
  ): Promise<AlertResponseDto> {
    return this.alertsService.update(projectId, alertId, dto);
  }

  @Delete(':alertId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alert rule' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'alertId', description: 'Alert rule UUID' })
  @ApiResponse({ status: 204, description: 'Alert rule deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async remove(
    @Param('projectId') projectId: string,
    @Param('alertId') alertId: string,
  ): Promise<void> {
    return this.alertsService.remove(projectId, alertId);
  }
}
