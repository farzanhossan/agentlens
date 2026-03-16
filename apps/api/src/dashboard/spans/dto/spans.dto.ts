import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { SpanEntity } from '../../../database/entities/index.js';

// ---------------------------------------------------------------------------
// SpanDetailDto
// ---------------------------------------------------------------------------

export class SpanDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  traceId!: string;

  @ApiProperty()
  projectId!: string;

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

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'LLM prompt text from Elasticsearch' })
  input?: string;

  @ApiPropertyOptional({ description: 'LLM completion text from Elasticsearch' })
  output?: string;

  static fromEntity(
    entity: SpanEntity,
    esData?: { input?: string; output?: string },
  ): SpanDetailDto {
    const dto = new SpanDetailDto();
    dto.id = entity.id;
    dto.traceId = entity.traceId;
    dto.projectId = entity.projectId;
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
    dto.input = esData?.input;
    dto.output = esData?.output;
    return dto;
  }
}

// ---------------------------------------------------------------------------
// SpanSearchHitDto
// ---------------------------------------------------------------------------

export class SpanSearchHitDto {
  @ApiProperty()
  spanId!: string;

  @ApiProperty()
  traceId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  model?: string;

  @ApiPropertyOptional()
  provider?: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  startedAt!: string;

  @ApiPropertyOptional({ description: 'LLM prompt text excerpt' })
  input?: string;

  @ApiPropertyOptional({ description: 'LLM completion text excerpt' })
  output?: string;

  @ApiProperty({ description: 'Relevance score from Elasticsearch' })
  score!: number;
}

// ---------------------------------------------------------------------------
// SearchSpansQueryDto
// ---------------------------------------------------------------------------

export class SearchSpansQueryDto {
  @ApiProperty({ description: 'Full-text search query string' })
  @IsString()
  q!: string;

  @ApiPropertyOptional({ description: 'Offset for pagination (default 0)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @ApiPropertyOptional({ description: 'Number of results to return (default 20)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
