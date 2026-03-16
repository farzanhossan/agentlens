import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AlertEngineModule } from './alert-engine/alert-engine.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { SpanProcessorModule } from './span-processor/span-processor.module.js';
import { SpansModule } from './spans/spans.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { ProjectsModule } from './projects/projects.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    DatabaseModule,
    AuthModule,

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),

    SpanProcessorModule,
    SpansModule,
    AlertsModule,
    ProjectsModule,
    AlertEngineModule,
  ],
})
export class AppModule {}
