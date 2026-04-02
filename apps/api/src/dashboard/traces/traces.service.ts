import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SpanEntity, TraceEntity } from '../../database/entities/index.js';
import {
  ListTracesQueryDto,
  PaginatedDto,
  TraceDetailDto,
  TraceStatsDto,
  TraceSummaryDto,
} from './dto/traces.dto.js';

interface CursorPayload {
  startedAt: string;
  id: string;
}

function encodeCursor(startedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ startedAt, id })).toString('base64');
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as CursorPayload;
}

@Injectable()
export class TracesService {
  constructor(
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
    @InjectRepository(SpanEntity)
    private readonly spanRepo: Repository<SpanEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async listTraces(
    projectId: string,
    query: ListTracesQueryDto,
  ): Promise<PaginatedDto<TraceSummaryDto>> {
    const limit = query.limit ?? 20;

    // Build the count query (no cursor, same filters)
    const countQb = this.traceRepo
      .createQueryBuilder('t')
      .where('t.projectId = :projectId', { projectId });

    if (query.status) {
      countQb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.agentName) {
      countQb.andWhere('t.agentName ILIKE :agentName', {
        agentName: `%${query.agentName}%`,
      });
    }
    if (query.search) {
      countQb.andWhere('t.agentName ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (query.dateFrom) {
      countQb.andWhere('t.startedAt >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      countQb.andWhere('t.startedAt <= :dateTo', { dateTo: query.dateTo });
    }
    if (query.model) {
      countQb.andWhere(
        `t.id IN (SELECT trace_id FROM spans WHERE model ILIKE :model AND project_id = :projectId)`,
        { model: `%${query.model}%` },
      );
    }
    if (query.minLatencyMs !== undefined) {
      countQb.andWhere('t.total_latency_ms >= :minLatencyMs', { minLatencyMs: query.minLatencyMs });
    }
    if (query.maxLatencyMs !== undefined) {
      countQb.andWhere('t.total_latency_ms <= :maxLatencyMs', { maxLatencyMs: query.maxLatencyMs });
    }
    if (query.minCostUsd !== undefined) {
      countQb.andWhere('t.total_cost_usd::float >= :minCostUsd', { minCostUsd: query.minCostUsd });
    }
    if (query.maxCostUsd !== undefined) {
      countQb.andWhere('t.total_cost_usd::float <= :maxCostUsd', { maxCostUsd: query.maxCostUsd });
    }

    const total = await countQb.getCount();

    // Build the data query (with cursor support)
    const dataQb = this.traceRepo
      .createQueryBuilder('t')
      .where('t.projectId = :projectId', { projectId });

    if (query.status) {
      dataQb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.agentName) {
      dataQb.andWhere('t.agentName ILIKE :agentName', {
        agentName: `%${query.agentName}%`,
      });
    }
    if (query.search) {
      dataQb.andWhere('t.agentName ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (query.dateFrom) {
      dataQb.andWhere('t.startedAt >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      dataQb.andWhere('t.startedAt <= :dateTo', { dateTo: query.dateTo });
    }
    if (query.model) {
      dataQb.andWhere(
        `t.id IN (SELECT trace_id FROM spans WHERE model ILIKE :model AND project_id = :projectId)`,
        { model: `%${query.model}%` },
      );
    }
    if (query.minLatencyMs !== undefined) {
      dataQb.andWhere('t.total_latency_ms >= :minLatencyMs', { minLatencyMs: query.minLatencyMs });
    }
    if (query.maxLatencyMs !== undefined) {
      dataQb.andWhere('t.total_latency_ms <= :maxLatencyMs', { maxLatencyMs: query.maxLatencyMs });
    }
    if (query.minCostUsd !== undefined) {
      dataQb.andWhere('t.total_cost_usd::float >= :minCostUsd', { minCostUsd: query.minCostUsd });
    }
    if (query.maxCostUsd !== undefined) {
      dataQb.andWhere('t.total_cost_usd::float <= :maxCostUsd', { maxCostUsd: query.maxCostUsd });
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      dataQb.andWhere(
        '(t.startedAt < :cursorStartedAt OR (t.startedAt = :cursorStartedAt AND t.id < :cursorId))',
        {
          cursorStartedAt: cursor.startedAt,
          cursorId: cursor.id,
        },
      );
    }

    dataQb.orderBy('t.startedAt', 'DESC').addOrderBy('t.id', 'DESC').limit(limit + 1);

    const rows = await dataQb.getMany();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor(
        last.startedAt instanceof Date ? last.startedAt.toISOString() : String(last.startedAt),
        last.id,
      );
    }

    // Populate inputPreview for each trace (gracefully skip if column doesn't exist yet)
    const dtos = pageRows.map((t) => TraceSummaryDto.fromEntity(t));
    if (dtos.length > 0) {
      const traceIds = dtos.map((d) => d.id);
      try {
        const previews = await this.dataSource.query<
          Array<{ trace_id: string; input_preview: string }>
        >(
          `SELECT
             s.trace_id,
             LEFT(s.input, 100) AS input_preview
           FROM spans s
           WHERE s.trace_id = ANY($1)
             AND s.parent_span_id IS NULL
             AND s.input IS NOT NULL`,
          [traceIds],
        );
        const previewMap = new Map(previews.map((p) => [p.trace_id, p.input_preview]));
        for (const dto of dtos) {
          dto.inputPreview = previewMap.get(dto.id);
        }
      } catch {
        // input column may not exist yet — skip inputPreview
      }
    }

    return { data: dtos, nextCursor, total };
  }

  async getTrace(projectId: string, traceId: string): Promise<TraceDetailDto> {
    const trace = await this.traceRepo.findOne({ where: { id: traceId } });
    if (!trace || trace.projectId !== projectId) {
      throw new NotFoundException(`Trace ${traceId} not found`);
    }

    const spans = await this.spanRepo
      .createQueryBuilder('s')
      .where('s.traceId = :traceId', { traceId })
      .orderBy('s.startedAt', 'ASC')
      .getMany();

    return TraceDetailDto.fromEntity(trace, spans);
  }

  async getStats(projectId: string, dateFrom: string, dateTo: string): Promise<TraceStatsDto> {
    const result = await this.dataSource.query<
      Array<{
        total_traces: string;
        success_count: string;
        error_count: string;
        avg_latency_ms: string | null;
        total_cost_usd: string | null;
      }>
    >(
      `SELECT
        COUNT(*) AS total_traces,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
        AVG(total_latency_ms) AS avg_latency_ms,
        SUM(total_cost_usd::float) AS total_cost_usd
       FROM traces
       WHERE project_id = $1
         AND started_at >= $2
         AND started_at < ($3::date + INTERVAL '1 day')`,
      [projectId, dateFrom, dateTo],
    );

    const row = result[0] ?? {
      total_traces: '0',
      success_count: '0',
      error_count: '0',
      avg_latency_ms: null,
      total_cost_usd: null,
    };

    const totalTraces = parseInt(row.total_traces, 10);
    const successCount = parseInt(row.success_count, 10);
    const errorCount = parseInt(row.error_count, 10);

    const dto = new TraceStatsDto();
    dto.totalTraces = totalTraces;
    dto.successCount = successCount;
    dto.errorCount = errorCount;
    dto.successRate = totalTraces > 0 ? successCount / totalTraces : 0;
    dto.avgLatencyMs = row.avg_latency_ms !== null ? parseFloat(row.avg_latency_ms) : 0;
    dto.totalCostUsd = row.total_cost_usd !== null ? parseFloat(row.total_cost_usd) : 0;
    dto.dateFrom = dateFrom;
    dto.dateTo = dateTo;

    return dto;
  }
}
