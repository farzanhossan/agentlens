import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertEntity, SpanEntity, TraceEntity } from '../database/entities/index.js';
import { ElasticsearchService } from '../span-processor/elasticsearch/elasticsearch.service.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { CostController } from './cost/cost.controller.js';
import { CostService } from './cost/cost.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { SpansController } from './spans/spans.controller.js';
import { SpansService } from './spans/spans.service.js';
import { TracesController } from './traces/traces.controller.js';
import { TracesService } from './traces/traces.service.js';
import { TraceGateway } from './websocket/trace.gateway.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraceEntity, SpanEntity, AlertEntity]),
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
  ],
  providers: [
    JwtAuthGuard,
    TracesService,
    SpansService,
    CostService,
    AlertsService,
    TraceGateway,
    ElasticsearchService,
  ],
})
export class DashboardModule {}
