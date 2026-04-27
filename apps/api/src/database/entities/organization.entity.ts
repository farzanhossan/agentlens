import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProjectEntity } from './project.entity.js';

export enum OrgPlan {
  SELF_HOSTED = 'self_hosted',
}

@Entity('organizations')
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  slug!: string;

  @Column({
    type: 'enum',
    enum: OrgPlan,
    default: OrgPlan.SELF_HOSTED,
  })
  plan!: OrgPlan;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => ProjectEntity, (project) => project.organization)
  projects!: ProjectEntity[];
}
