import { Controller, Get, Param, Query } from '@nestjs/common';
import { SpansService } from './spans.service.js';
import type { SpanEntity } from './span.entity.js';

interface SpansQueryDto {
  traceId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

@Controller('v1/projects/:projectId/spans')
export class SpansController {
  constructor(private readonly spansService: SpansService) {}

  @Get()
  async listSpans(
    @Param('projectId') projectId: string,
    @Query() query: SpansQueryDto,
  ): Promise<{ spans: SpanEntity[]; total: number }> {
    return this.spansService.query({
      projectId,
      traceId: query.traceId,
      status: query.status,
      fromMs: query.from ? parseInt(query.from, 10) : undefined,
      toMs: query.to ? parseInt(query.to, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  }

  @Get('traces/:traceId')
  async getTrace(
    @Param('projectId') projectId: string,
    @Param('traceId') traceId: string,
  ): Promise<SpanEntity[]> {
    return this.spansService.findByTrace(projectId, traceId);
  }
}
