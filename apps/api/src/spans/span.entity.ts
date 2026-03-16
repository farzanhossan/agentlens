import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('spans')
@Index(['traceId'])
@Index(['projectId', 'startTimeMs'])
export class SpanEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  spanId!: string;

  @Column({ type: 'varchar', length: 32 })
  traceId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  parentSpanId?: string;

  @Column({ type: 'uuid' })
  projectId!: string;

  @Column({ type: 'varchar', length: 512 })
  name!: string;

  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  @Column({ type: 'bigint' })
  startTimeMs!: number;

  @Column({ type: 'bigint' })
  endTimeMs!: number;

  @Column({ type: 'int' })
  durationMs!: number;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'text', nullable: true })
  statusMessage?: string;

  @Column({ type: 'jsonb', default: '{}' })
  attributes!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '[]' })
  events!: unknown[];

  @CreateDateColumn()
  createdAt!: Date;
}
