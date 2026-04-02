import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

// ---------------------------------------------------------------------------
// Cost breakdown DTOs
// ---------------------------------------------------------------------------

export class CostByModelDto {
  @ApiProperty()
  model!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  costUsd!: number;

  @ApiProperty()
  spanCount!: number;

  @ApiProperty()
  avgTokensPerCall!: number;

  @ApiProperty()
  avgCostPerCall!: number;

  @ApiProperty()
  avgLatencyMs!: number;

  @ApiProperty()
  callCount!: number;
}

export class CostByDateDto {
  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  date!: string;

  @ApiProperty()
  costUsd!: number;
}

export class CostByAgentDto {
  @ApiProperty()
  agentName!: string;

  @ApiProperty()
  costUsd!: number;
}

export class CostSummaryDto {
  @ApiProperty()
  totalCostUsd!: number;

  @ApiProperty()
  totalInputTokens!: number;

  @ApiProperty()
  totalOutputTokens!: number;

  @ApiProperty()
  prevPeriodCostUsd!: number;

  @ApiProperty({ type: () => [CostByModelDto] })
  byModel!: CostByModelDto[];

  @ApiProperty({ type: () => [CostByDateDto] })
  byDate!: CostByDateDto[];

  @ApiProperty({ type: () => [CostByAgentDto] })
  byAgent!: CostByAgentDto[];

  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;
}

export class CostTimeseriesDto {
  @ApiProperty({ type: () => [CostByDateDto] })
  dates!: CostByDateDto[];
}

// ---------------------------------------------------------------------------
// Query DTO
// ---------------------------------------------------------------------------

export class CostQueryDto {
  @ApiProperty({ description: 'ISO 8601 start date (inclusive)' })
  @IsISO8601()
  dateFrom!: string;

  @ApiProperty({ description: 'ISO 8601 end date (inclusive)' })
  @IsISO8601()
  dateTo!: string;
}
