import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Query DTOs
// ---------------------------------------------------------------------------

export enum F1GroupBy {
  LABEL = 'label',
  AGENT = 'agent',
  MODEL = 'model',
  TASK = 'task',
}

export class EvaluationFilterQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601 start date (inclusive). Defaults to 30 days before dateTo.' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end date (inclusive). Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by eval task' })
  @IsOptional()
  @IsString()
  task?: string;

  @ApiPropertyOptional({ description: 'Filter by eval split' })
  @IsOptional()
  @IsString()
  split?: string;

  @ApiPropertyOptional({ description: 'Filter by agent name' })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ description: 'Filter by model' })
  @IsOptional()
  @IsString()
  model?: string;
}

export class F1QueryDto extends EvaluationFilterQueryDto {
  @ApiPropertyOptional({ enum: F1GroupBy, default: F1GroupBy.LABEL, description: 'How to group the breakdown rows' })
  @IsOptional()
  @IsEnum(F1GroupBy)
  groupBy?: F1GroupBy;
}

export class MisclassificationsQueryDto extends EvaluationFilterQueryDto {
  @ApiPropertyOptional({ description: 'Number of items to return (default 50, max 200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of items to skip (default 0)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Filter by expected label' })
  @IsOptional()
  @IsString()
  expected?: string;

  @ApiPropertyOptional({ description: 'Filter by predicted label' })
  @IsOptional()
  @IsString()
  predicted?: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class F1SummaryDto {
  @ApiProperty()
  evaluated!: number;

  @ApiProperty()
  correct!: number;

  @ApiProperty()
  accuracy!: number;

  @ApiProperty()
  precision!: number;

  @ApiProperty()
  recall!: number;

  @ApiProperty()
  f1!: number;

  @ApiProperty()
  truePositive!: number;

  @ApiProperty()
  falsePositive!: number;

  @ApiProperty()
  falseNegative!: number;
}

export class F1BreakdownRowDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  evaluated!: number;

  @ApiProperty()
  support!: number;

  @ApiProperty()
  correct!: number;

  @ApiProperty()
  accuracy!: number;

  @ApiProperty()
  precision!: number;

  @ApiProperty()
  recall!: number;

  @ApiProperty()
  f1!: number;

  @ApiProperty()
  truePositive!: number;

  @ApiProperty()
  falsePositive!: number;

  @ApiProperty()
  falseNegative!: number;
}

export class F1ResponseDto {
  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;

  @ApiProperty({ type: () => F1SummaryDto })
  summary!: F1SummaryDto;

  @ApiProperty({ type: () => [F1BreakdownRowDto] })
  breakdown!: F1BreakdownRowDto[];
}

export class MisclassificationItemDto {
  @ApiProperty()
  spanId!: string;

  @ApiProperty()
  traceId!: string;

  @ApiProperty({ nullable: true })
  agentName!: string | null;

  @ApiProperty({ nullable: true })
  model!: string | null;

  @ApiProperty()
  expected!: string;

  @ApiProperty()
  predicted!: string;

  @ApiProperty()
  task!: string;

  @ApiProperty()
  split!: string;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty({ nullable: true })
  inputPreview!: string | null;

  @ApiProperty({ nullable: true })
  outputPreview!: string | null;
}

export class MisclassificationsResponseDto {
  @ApiProperty({ type: () => [MisclassificationItemDto] })
  items!: MisclassificationItemDto[];

  @ApiProperty()
  total!: number;
}
