import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** 15 minutes in seconds — alerts cannot re-fire within this window. */
const COOLDOWN_SECONDS = 15 * 60;

@Injectable()
export class AlertStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertStateService.name);
  private redis!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD') ?? undefined,
      lazyConnect: false,
    });
    this.redis.on('error', (err) =>
      this.logger.error(`AlertStateService Redis error: ${String(err)}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Records that an alert has fired. The key expires automatically after the
   * cooldown window, so `canFire` will return true again without any cleanup.
   */
  async setLastFired(alertId: string): Promise<void> {
    await this.redis.setex(`agentlens:alert:fired:${alertId}`, COOLDOWN_SECONDS, '1');
  }

  /**
   * Returns true when the alert has NOT fired within the last 15 minutes.
   */
  async canFire(alertId: string): Promise<boolean> {
    const val = await this.redis.get(`agentlens:alert:fired:${alertId}`);
    return val === null;
  }
}
