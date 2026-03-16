import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { CostQueryDto, CostSummaryDto, CostTimeseriesDto } from './dto/cost.dto.js';
import { CostService } from './cost.service.js';

@ApiTags('cost')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/cost')
export class CostController {
  constructor(private readonly costService: CostService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get cost summary broken down by model, date, and agent' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'dateTo', required: true, description: 'ISO 8601 end date' })
  @ApiResponse({ status: 200, description: 'Cost summary', type: CostSummaryDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSummary(
    @Param('projectId') projectId: string,
    @Query() query: CostQueryDto,
  ): Promise<CostSummaryDto> {
    return this.costService.getSummary(projectId, query.dateFrom, query.dateTo);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Get cost time series data grouped by day' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'dateTo', required: true, description: 'ISO 8601 end date' })
  @ApiResponse({ status: 200, description: 'Cost time series', type: CostTimeseriesDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTimeseries(
    @Param('projectId') projectId: string,
    @Query() query: CostQueryDto,
  ): Promise<CostTimeseriesDto> {
    return this.costService.getTimeseries(projectId, query.dateFrom, query.dateTo);
  }
}
