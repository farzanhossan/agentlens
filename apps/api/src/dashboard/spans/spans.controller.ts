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
import { SearchSpansQueryDto, SpanDetailDto, SpanSearchHitDto } from './dto/spans.dto.js';
import { SpansService } from './spans.service.js';

@ApiTags('spans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/spans')
export class SpansController {
  constructor(private readonly spansService: SpansService) {}

  @Get('search')
  @ApiOperation({ summary: 'Full-text search spans via Elasticsearch' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query string' })
  @ApiQuery({ name: 'from', required: false, description: 'Pagination offset (default 0)' })
  @ApiQuery({ name: 'size', required: false, description: 'Number of results (default 20)' })
  @ApiResponse({ status: 200, description: 'Search results', type: [SpanSearchHitDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchSpans(
    @Param('projectId') projectId: string,
    @Query() query: SearchSpansQueryDto,
  ): Promise<{ hits: SpanSearchHitDto[]; total: number }> {
    return this.spansService.searchSpans(projectId, query);
  }

  @Get(':spanId')
  @ApiOperation({ summary: 'Get a single span including input/output from Elasticsearch' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'spanId', description: 'Span UUID' })
  @ApiResponse({ status: 200, description: 'Span detail', type: SpanDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Span not found' })
  async getSpan(
    @Param('projectId') projectId: string,
    @Param('spanId') spanId: string,
  ): Promise<SpanDetailDto> {
    return this.spansService.getSpan(projectId, spanId);
  }
}
