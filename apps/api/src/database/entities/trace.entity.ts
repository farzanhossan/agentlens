import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { ProjectEntity } from './project.entity.js';
import { SpanEntity } from './span.entity.js';

export enum TraceStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  ERROR = 'error',
  TIMEOUT = 'timeout',
}

@Entity('traces')
@Index('idx_traces_project_created', ['projectId', 'startedAt'])
@Index('idx_traces_session', ['sessionId'])
export class TraceEntity {
  /** PK is the traceId emitted by the SDK — not auto-generated. */
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, (project: ProjectEntity) => project.traces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'session_id' })
  sessionId?: string;

  @Column({ type: 'varchar', length: 256, nullable: true, name: 'agent_name' })
  agentName?: string;

  @Column({
    type: 'enum',
    enum: TraceStatus,
    default: TraceStatus.RUNNING,
  })
  status!: TraceStatus;

  @Column({ type: 'int', default: 0, name: 'total_spans' })
  totalSpans!: number;

  @Column({ type: 'int', default: 0, name: 'total_tokens' })
  totalTokens!: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 6,
    default: 0,
    name: 'total_cost_usd',
  })
  totalCostUsd!: string; // TypeORM returns DECIMAL as string to preserve precision

  @Column({ type: 'int', nullable: true, name: 'total_latency_ms' })
  totalLatencyMs?: number;

  // cspell:ignore timestamptz
  @Column({ type: 'timestamp with time zone', default: () => 'NOW()', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true, name: 'ended_at' })
  endedAt?: Date;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @OneToMany(() => SpanEntity, (span: SpanEntity) => span.trace)
  spans!: SpanEntity[];
}
