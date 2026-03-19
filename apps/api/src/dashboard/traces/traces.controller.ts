import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import {
  ListTracesQueryDto,
  PaginatedDto,
  TraceDetailDto,
  TraceStatsDto,
  TraceSummaryDto,
} from './dto/traces.dto.js';
import { TracesService } from './traces.service.js';

class StatsQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

@ApiTags('traces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/traces')
export class TracesController {
  constructor(private readonly tracesService: TracesService) {}

  @Get()
  @ApiOperation({ summary: 'List traces for a project with cursor-based pagination' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by trace status' })
  @ApiQuery({ name: 'agentName', required: false, description: 'Filter by agent name' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO 8601 end date' })
  @ApiQuery({ name: 'search', required: false, description: 'Full-text search on agent name' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (max 100)' })
  @ApiResponse({ status: 200, description: 'Paginated list of trace summaries', type: PaginatedDto<TraceSummaryDto> })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listTraces(
    @Param('projectId') projectId: string,
    @Query() query: ListTracesQueryDto,
  ): Promise<PaginatedDto<TraceSummaryDto>> {
    return this.tracesService.listTraces(projectId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated trace statistics for a date range' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'dateFrom', required: true, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'dateTo', required: true, description: 'ISO 8601 end date' })
  @ApiResponse({ status: 200, description: 'Trace statistics', type: TraceStatsDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getStats(
    @Param('projectId') projectId: string,
    @Query() query: StatsQueryDto,
  ): Promise<TraceStatsDto> {
    const dateTo = query.dateTo ?? new Date().toISOString().split('T')[0]!;
    const dateFrom = query.dateFrom ?? new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]!;
    return this.tracesService.getStats(projectId, dateFrom, dateTo);
  }

  @Get(':traceId')
  @ApiOperation({ summary: 'Get a single trace with its full span tree' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'traceId', description: 'Trace UUID' })
  @ApiResponse({ status: 200, description: 'Trace detail with span tree', type: TraceDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Trace not found' })
  async getTrace(
    @Param('projectId') projectId: string,
    @Param('traceId') traceId: string,
  ): Promise<TraceDetailDto> {
    return this.tracesService.getTrace(projectId, traceId);
  }
}
