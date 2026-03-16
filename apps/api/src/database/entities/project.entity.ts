import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationEntity } from './organization.entity.js';
import { TraceEntity } from './trace.entity.js';
import { SpanEntity } from './span.entity.js';
import { AlertEntity } from './alert.entity.js';

@Entity('projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, (org) => org.projects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  /** Bcrypt hash of the raw API key. Never expose raw value after creation. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'api_key' })
  apiKey!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int', default: 30, name: 'retention_days' })
  retentionDays!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => TraceEntity, (trace) => trace.project)
  traces!: TraceEntity[];

  @OneToMany(() => SpanEntity, (span) => span.project)
  spans!: SpanEntity[];

  @OneToMany(() => AlertEntity, (alert) => alert.project)
  alerts!: AlertEntity[];
}
