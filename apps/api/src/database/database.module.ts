import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AlertEntity,
  OrganizationEntity,
  ProjectEntity,
  SpanEntity,
  TraceEntity,
  UserEntity,
} from './entities/index.js';

const ENTITIES = [
  OrganizationEntity,
  ProjectEntity,
  TraceEntity,
  SpanEntity,
  AlertEntity,
  UserEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: ENTITIES,
        /**
         * Migrations run automatically on startup. The SQL DDL in infra/init.sql
         * bootstraps a fresh database; TypeORM migrations handle incremental changes.
         */
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: config.get('NODE_ENV') !== 'test',
        /**
         * synchronize must stay false in all environments — always use migrations.
         * Enabling it would silently drop columns during deploys.
         */
        synchronize: false,
        logging:
          config.get<string>('NODE_ENV') === 'development'
            ? ['query', 'error', 'migration']
            : ['error', 'migration'],
        ssl:
          config.get<string>('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
        /**
         * Connection pool tuning. For NestJS/BullMQ co-located services keep the
         * pool modest — BullMQ has its own Redis connection pool.
         */
        extra: {
          max: config.get<number>('DATABASE_POOL_MAX', 20),
          min: config.get<number>('DATABASE_POOL_MIN', 2),
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 30_000,
        },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
