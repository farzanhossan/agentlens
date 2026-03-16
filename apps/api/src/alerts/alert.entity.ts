import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AlertCondition {
  P99_LATENCY_MS = 'p99_latency_ms',
  ERROR_RATE_PCT = 'error_rate_pct',
  TOTAL_TOKENS = 'total_tokens',
  SPAN_COUNT = 'span_count',
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

@Entity('alerts')
export class AlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  projectId!: string;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'varchar', length: 64 })
  condition!: AlertCondition;

  @Column({ type: 'float' })
  threshold!: number;

  @Column({ type: 'varchar', length: 16 })
  severity!: AlertSeverity;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'text', nullable: true })
  webhookUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
