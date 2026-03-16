import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProjectEntity } from './project.entity.js';

export enum AlertType {
  ERROR_RATE = 'error_rate',
  COST_SPIKE = 'cost_spike',
  LATENCY_P95 = 'latency_p95',
  FAILURE = 'failure',
}

export enum AlertChannel {
  SLACK = 'slack',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
}

@Entity('alerts')
@Index('idx_alerts_project_active', ['projectId', 'isActive'])
export class AlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, (project) => project.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'enum', enum: AlertType })
  type!: AlertType;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  threshold!: string; // TypeORM returns DECIMAL as string

  @Column({ type: 'enum', enum: AlertChannel })
  channel!: AlertChannel;

  /** Slack webhook URL / email address / HTTPS endpoint, keyed by channel type. */
  @Column({ type: 'jsonb', default: '{}', name: 'channel_config' })
  channelConfig!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
