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
import { OverviewDto, OverviewQueryDto } from './dto/overview.dto.js';
import { OverviewService } from './overview.service.js';

@ApiTags('overview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @ApiOperation({ summary: 'Get overview dashboard data' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'hours', required: false, description: 'Lookback window in hours (default 24)' })
  @ApiResponse({ status: 200, description: 'Overview data', type: OverviewDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getOverview(
    @Param('projectId') projectId: string,
    @Query() query: OverviewQueryDto,
  ): Promise<OverviewDto> {
    return this.overviewService.getOverview(projectId, query.hours ?? 24);
  }
}
