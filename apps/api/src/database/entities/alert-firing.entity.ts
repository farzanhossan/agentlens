import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AlertEntity, AlertChannel, AlertType } from './alert.entity.js';

export enum DeliveryStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}

@Entity('alert_firings')
@Index('idx_alert_firings_project', ['projectId'])
@Index('idx_alert_firings_alert', ['alertId'])
export class AlertFiringEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'alert_id' })
  alertId!: string;

  @ManyToOne(() => AlertEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alert_id' })
  alert!: AlertEntity;

  @Column({ type: 'uuid', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', length: 256, name: 'alert_name' })
  alertName!: string;

  @Column({ type: 'enum', enum: AlertType, name: 'alert_type' })
  alertType!: AlertType;

  @Column({ type: 'decimal', precision: 10, scale: 4, name: 'current_value' })
  currentValue!: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  threshold!: string;

  @Column({ type: 'enum', enum: AlertChannel })
  channel!: AlertChannel;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
    name: 'delivery_status',
  })
  deliveryStatus!: DeliveryStatus;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage?: string;

  @CreateDateColumn({ name: 'fired_at' })
  firedAt!: Date;
}
