import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { AlertChannel, AlertEntity, AlertType } from '../../../database/entities/index.js';

// ---------------------------------------------------------------------------
// CreateAlertDto
// ---------------------------------------------------------------------------

export class CreateAlertDto {
  @ApiProperty({ description: 'Human-readable name for the alert rule', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiProperty({ enum: AlertType, description: 'Alert trigger type' })
  @IsEnum(AlertType)
  type!: AlertType;

  @ApiProperty({ description: 'Threshold value that triggers the alert (must be positive)' })
  @IsPositive()
  threshold!: number;

  @ApiProperty({ enum: AlertChannel, description: 'Notification channel' })
  @IsEnum(AlertChannel)
  channel!: AlertChannel;

  @ApiProperty({
    type: Object,
    description: 'Channel-specific configuration (e.g., webhook URL, email address)',
  })
  @IsObject()
  channelConfig!: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// UpdateAlertDto
// ---------------------------------------------------------------------------

export class UpdateAlertDto {
  @ApiPropertyOptional({ description: 'Updated alert name', maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;

  @ApiPropertyOptional({ enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional({ description: 'Updated threshold value' })
  @IsOptional()
  @IsPositive()
  threshold?: number;

  @ApiPropertyOptional({ enum: AlertChannel })
  @IsOptional()
  @IsEnum(AlertChannel)
  channel?: AlertChannel;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  channelConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Enable or disable the alert rule' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// AlertResponseDto
// ---------------------------------------------------------------------------

export class AlertResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  projectId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: AlertType })
  type!: AlertType;

  @ApiProperty({ type: Number })
  threshold!: number;

  @ApiProperty({ enum: AlertChannel })
  channel!: AlertChannel;

  @ApiProperty({ type: Object })
  channelConfig!: Record<string, unknown>;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  static fromEntity(entity: AlertEntity): AlertResponseDto {
    const dto = new AlertResponseDto();
    dto.id = entity.id;
    dto.projectId = entity.projectId;
    dto.name = entity.name;
    dto.type = entity.type;
    dto.threshold = parseFloat(entity.threshold);
    dto.channel = entity.channel;
    dto.channelConfig = entity.channelConfig;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt instanceof Date
      ? entity.createdAt.toISOString()
      : String(entity.createdAt);
    return dto;
  }
}
