import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertEntity, AlertFiringEntity, ProjectEntity, SpanEntity, TraceEntity } from '../database/entities/index.js';
import { ElasticsearchService } from '../span-processor/elasticsearch/elasticsearch.service.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { CostController } from './cost/cost.controller.js';
import { CostService } from './cost/cost.service.js';
import { OverviewController } from './overview/overview.controller.js';
import { OverviewService } from './overview/overview.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { SpansController } from './spans/spans.controller.js';
import { SpansService } from './spans/spans.service.js';
import { SystemHealthController } from './system-health/system-health.controller.js';
import { TracesController } from './traces/traces.controller.js';
import { TracesService } from './traces/traces.service.js';
import { TraceGateway } from './websocket/trace.gateway.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraceEntity, SpanEntity, AlertEntity, AlertFiringEntity, ProjectEntity]),
    BullModule.registerQueue({ name: 'notification-dispatch' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    TracesController,
    SpansController,
    CostController,
    AlertsController,
    OverviewController,
    SystemHealthController,
  ],
  providers: [
    JwtAuthGuard,
    TracesService,
    SpansService,
    CostService,
    AlertsService,
    TraceGateway,
    ElasticsearchService,
    OverviewService,
  ],
})
export class DashboardModule {}
