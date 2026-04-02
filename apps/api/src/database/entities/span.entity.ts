import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { TraceEntity } from './trace.entity.js';
import { ProjectEntity } from './project.entity.js';

export enum SpanStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  TIMEOUT = 'timeout',
}

@Entity('spans')
@Index('idx_spans_trace', ['traceId'])
@Index('idx_spans_project_created', ['projectId', 'startedAt'])
@Index('idx_spans_status', ['projectId', 'status'], {
  where: `"status" = 'error'`,
})
export class SpanEntity {
  /** PK is the spanId emitted by the SDK — not auto-generated. Accepts any string (e.g. OTel hex IDs). */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ type: 'varchar', length: 128, name: 'trace_id' })
  traceId!: string;

  @ManyToOne(() => TraceEntity, (trace) => trace.spans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trace_id' })
  trace!: TraceEntity;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, (project) => project.spans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  /**
   * Self-referencing FK. Null for root spans.
   * NOTE: LLM input/output text is stored in Elasticsearch only, not in this table.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'parent_span_id' })
  parentSpanId?: string;

  @ManyToOne(() => SpanEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_span_id' })
  parentSpan?: SpanEntity;

  @Column({ type: 'varchar', length: 512 })
  name!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider?: string;

  @Column({ type: 'int', nullable: true, name: 'input_tokens' })
  inputTokens?: number;

  @Column({ type: 'int', nullable: true, name: 'output_tokens' })
  outputTokens?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 6,
    nullable: true,
    name: 'cost_usd',
  })
  costUsd?: string; // TypeORM returns DECIMAL as string

  @Column({ type: 'int', nullable: true, name: 'latency_ms' })
  latencyMs?: number;

  @Column({
    type: 'enum',
    enum: SpanStatus,
    default: SpanStatus.SUCCESS,
  })
  status!: SpanStatus;

  /** LLM prompt text. Also indexed in Elasticsearch for full-text search. */
  @Column({ type: 'text', nullable: true })
  input?: string;

  /** LLM completion text. Also indexed in Elasticsearch for full-text search. */
  @Column({ type: 'text', nullable: true })
  output?: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage?: string;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt?: Date;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;
}
