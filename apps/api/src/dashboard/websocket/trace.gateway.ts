import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import type { ProcessedSpan } from '../../span-processor/span-processor.types.js';

@WebSocketGateway({ namespace: '/ws/traces', cors: { origin: '*' } })
export class TraceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(TraceGateway.name);

  @WebSocketServer()
  server!: Server;

  private subscriber!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    this.subscriber = new Redis({
      host,
      port,
      password: password ?? undefined,
      lazyConnect: false,
    });

    void this.subscriber.psubscribe('agentlens:spans:*', (err) => {
      if (err) {
        this.logger.error(`Failed to subscribe to Redis pattern: ${String(err)}`);
      } else {
        this.logger.log('Subscribed to Redis pattern agentlens:spans:*');
      }
    });

    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const span = JSON.parse(message) as ProcessedSpan;
        const traceId = channel.split(':')[2];
        if (traceId) {
          this.server.to(`trace:${traceId}`).emit('span-added', span);
        }
      } catch (err) {
        this.logger.warn(`Failed to parse Redis message on channel ${channel}: ${String(err)}`);
      }
    });
  }

  afterInit(_server: Server): void {
    this.logger.log('TraceGateway WebSocket initialized');
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe-trace')
  async handleSubscribeTrace(
    client: Socket,
    payload: { traceId: string },
  ): Promise<void> {
    const room = `trace:${payload.traceId}`;
    await client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
  }

  @SubscribeMessage('unsubscribe-trace')
  async handleUnsubscribeTrace(
    client: Socket,
    payload: { traceId: string },
  ): Promise<void> {
    const room = `trace:${payload.traceId}`;
    await client.leave(room);
    this.logger.debug(`Client ${client.id} left room ${room}`);
  }

  /**
   * Publishes a processed span to the Redis pub/sub channel for the given trace.
   * Other service instances will receive this and forward it to connected WebSocket clients.
   */
  static async publishSpan(redis: Redis, span: ProcessedSpan): Promise<void> {
    const channel = `agentlens:spans:${span.traceId}`;
    await redis.publish(channel, JSON.stringify(span));
  }
}
