import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { SpanEntity } from '../../../database/entities/index.js';
import type { TraceEntity } from '../../../database/entities/index.js';
import { TraceStatus } from '../../../database/entities/index.js';

// ---------------------------------------------------------------------------
// Query DTOs
// ---------------------------------------------------------------------------

export class ListTracesQueryDto {
  @ApiPropertyOptional({ enum: TraceStatus, description: 'Filter by trace status' })
  @IsOptional()
  @IsEnum(TraceStatus)
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by agent name (case-insensitive partial match)' })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 start date filter (inclusive)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date filter (inclusive)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Full-text search on agentName' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Opaque base64 pagination cursor from previous response' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page (default 20, max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter traces containing spans with this model' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Minimum latency in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minLatencyMs?: number;

  @ApiPropertyOptional({ description: 'Maximum latency in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLatencyMs?: number;

  @ApiPropertyOptional({ description: 'Minimum cost in USD' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCostUsd?: number;

  @ApiPropertyOptional({ description: 'Maximum cost in USD' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class TraceSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty({ enum: TraceStatus })
  status!: string;

  @ApiPropertyOptional()
  agentName?: string;

  @ApiPropertyOptional()
  sessionId?: string;

  @ApiProperty()
  totalSpans!: number;

  @ApiProperty()
  totalTokens!: number;

  @ApiProperty({ type: Number })
  totalCostUsd!: number;

  @ApiPropertyOptional()
  totalLatencyMs?: number;

  @ApiProperty({ description: 'ISO 8601 timestamp' })
  startedAt!: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp' })
  endedAt?: string;

  @ApiPropertyOptional({ description: 'First ~100 chars of root span input' })
  inputPreview?: string;

  static fromEntity(entity: TraceEntity): TraceSummaryDto {
    const dto = new TraceSummaryDto();
    dto.id = entity.id;
    dto.projectId = entity.projectId;
    dto.status = entity.status;
    dto.agentName = entity.agentName;
    dto.sessionId = entity.sessionId;
    dto.totalSpans = entity.totalSpans;
    dto.totalTokens = entity.totalTokens;
    dto.totalCostUsd = parseFloat(entity.totalCostUsd);
    dto.totalLatencyMs = entity.totalLatencyMs;
    dto.startedAt = entity.startedAt instanceof Date
      ? entity.startedAt.toISOString()
      : String(entity.startedAt);
    dto.endedAt = entity.endedAt instanceof Date
      ? entity.endedAt.toISOString()
      : entity.endedAt !== undefined ? String(entity.endedAt) : undefined;
    return dto;
  }
}

export class SpanNodeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  traceId!: string;

  @ApiPropertyOptional()
  parentSpanId?: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  model?: string;

  @ApiPropertyOptional()
  provider?: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  inputTokens?: number;

  @ApiPropertyOptional()
  outputTokens?: number;

  @ApiPropertyOptional({ type: Number })
  costUsd?: number;

  @ApiPropertyOptional()
  latencyMs?: number;

  @ApiProperty()
  startedAt!: string;

  @ApiPropertyOptional()
  endedAt?: string;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiPropertyOptional({ type: Object })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: () => [SpanNodeDto] })
  children: SpanNodeDto[] = [];

  static fromEntity(entity: SpanEntity): SpanNodeDto {
    const dto = new SpanNodeDto();
    dto.id = entity.id;
    dto.traceId = entity.traceId;
    dto.parentSpanId = entity.parentSpanId;
    dto.name = entity.name;
    dto.model = entity.model;
    dto.provider = entity.provider;
    dto.status = entity.status;
    dto.inputTokens = entity.inputTokens;
    dto.outputTokens = entity.outputTokens;
    dto.costUsd = entity.costUsd !== undefined ? parseFloat(entity.costUsd) : undefined;
    dto.latencyMs = entity.latencyMs;
    dto.startedAt = entity.startedAt instanceof Date
      ? entity.startedAt.toISOString()
      : String(entity.startedAt);
    dto.endedAt = entity.endedAt instanceof Date
      ? entity.endedAt.toISOString()
      : entity.endedAt !== undefined ? String(entity.endedAt) : undefined;
    dto.errorMessage = entity.errorMessage;
    dto.metadata = entity.metadata;
    dto.children = [];
    return dto;
  }
}

export class TraceDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty({ enum: TraceStatus })
  status!: string;

  @ApiPropertyOptional()
  agentName?: string;

  @ApiPropertyOptional()
  sessionId?: string;

  @ApiProperty()
  totalSpans!: number;

  @ApiProperty()
  totalTokens!: number;

  @ApiProperty({ type: Number })
  totalCostUsd!: number;

  @ApiPropertyOptional()
  totalLatencyMs?: number;

  @ApiProperty({ description: 'ISO 8601 timestamp' })
  startedAt!: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp' })
  endedAt?: string;

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: () => [SpanNodeDto] })
  spans!: SpanNodeDto[];

  static fromEntity(trace: TraceEntity, spans: SpanEntity[]): TraceDetailDto {
    const dto = new TraceDetailDto();
    dto.id = trace.id;
    dto.projectId = trace.projectId;
    dto.status = trace.status;
    dto.agentName = trace.agentName;
    dto.sessionId = trace.sessionId;
    dto.totalSpans = trace.totalSpans;
    dto.totalTokens = trace.totalTokens;
    dto.totalCostUsd = parseFloat(trace.totalCostUsd);
    dto.totalLatencyMs = trace.totalLatencyMs;
    dto.startedAt = trace.startedAt instanceof Date
      ? trace.startedAt.toISOString()
      : String(trace.startedAt);
    dto.endedAt = trace.endedAt instanceof Date
      ? trace.endedAt.toISOString()
      : trace.endedAt !== undefined ? String(trace.endedAt) : undefined;
    dto.metadata = trace.metadata;

    // Build span tree from flat list
    const nodeMap = new Map<string, SpanNodeDto>();
    for (const span of spans) {
      nodeMap.set(span.id, SpanNodeDto.fromEntity(span));
    }

    const roots: SpanNodeDto[] = [];
    for (const span of spans) {
      const node = nodeMap.get(span.id)!;
      if (span.parentSpanId && nodeMap.has(span.parentSpanId)) {
        nodeMap.get(span.parentSpanId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    dto.spans = roots;
    return dto;
  }
}

export class TraceStatsDto {
  @ApiProperty()
  totalTraces!: number;

  @ApiProperty()
  successCount!: number;

  @ApiProperty()
  errorCount!: number;

  @ApiProperty({ description: 'Success rate between 0 and 1' })
  successRate!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  totalCostUsd!: number;

  @ApiProperty({ description: 'ISO 8601 start of date range' })
  dateFrom!: string;

  @ApiProperty({ description: 'ISO 8601 end of date range' })
  dateTo!: string;
}

export class PaginatedDto<T> {
  @ApiProperty({ isArray: true })
  data!: T[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  total!: number;
}

// Re-export Transform for usage at call sites
export { Transform };
