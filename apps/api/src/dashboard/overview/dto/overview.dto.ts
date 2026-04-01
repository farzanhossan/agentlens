import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class OverviewQueryDto {
  @ApiPropertyOptional({ description: 'Number of hours to look back (default 24)', default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;
}

export class HourlyVolumeDto {
  @ApiProperty()
  hour!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  errors!: number;
}

export class ModelUsageDto {
  @ApiProperty()
  model!: string;

  @ApiProperty()
  calls!: number;

  @ApiProperty()
  costUsd!: number;
}

export class TopAgentDto {
  @ApiProperty()
  agentName!: string;

  @ApiProperty()
  calls!: number;

  @ApiProperty()
  errors!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  costUsd!: number;
}

export class RecentErrorDto {
  @ApiProperty()
  traceId!: string;

  @ApiProperty()
  errorMessage!: string;

  @ApiPropertyOptional()
  agentName?: string;

  @ApiPropertyOptional()
  model?: string;

  @ApiProperty()
  startedAt!: string;
}

export class OverviewDto {
  @ApiProperty()
  totalRequests!: number;

  @ApiProperty()
  totalRequestsPrev!: number;

  @ApiProperty()
  errorCount!: number;

  @ApiProperty()
  errorCountPrev!: number;

  @ApiProperty()
  totalCostUsd!: number;

  @ApiProperty()
  monthCostUsd!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  p95LatencyMs!: number;

  @ApiProperty()
  activeTraces!: number;

  @ApiProperty({ type: () => [HourlyVolumeDto] })
  hourlyVolume!: HourlyVolumeDto[];

  @ApiProperty({ type: () => [ModelUsageDto] })
  modelUsage!: ModelUsageDto[];

  @ApiProperty({ type: () => [TopAgentDto] })
  topAgents!: TopAgentDto[];

  @ApiProperty({ type: () => [RecentErrorDto] })
  recentErrors!: RecentErrorDto[];
}
