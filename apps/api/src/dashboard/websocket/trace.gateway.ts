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
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import type { ProcessedSpan } from '../../span-processor/span-processor.types.js';

interface SocketData {
  userId: string;
  orgId: string;
  email: string;
}

@WebSocketGateway({ namespace: '/ws/traces', cors: { origin: '*' } })
export class TraceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(TraceGateway.name);

  @WebSocketServer()
  server!: Server;

  private subscriber!: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    const url = new URL(redisUrl);

    this.subscriber = new Redis({
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      lazyConnect: false,
    });

    void this.subscriber.psubscribe(
      'agentlens:spans:*',
      'agentlens:spans-completed:*',
      (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to Redis patterns: ${String(err)}`);
        } else {
          this.logger.log('Subscribed to Redis patterns agentlens:spans:* and agentlens:spans-completed:*');
        }
      },
    );

    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const span = JSON.parse(message) as ProcessedSpan;
        const parts = channel.split(':');
        const channelType = parts[1]; // 'spans' or 'spans-completed'
        const traceId = parts[2];
        if (!traceId) return;

        if (channelType === 'spans') {
          this.server.to(`trace:${traceId}`).emit('span-added', span);
        } else if (channelType === 'spans-completed') {
          // Emit to the project-specific live-feed room only
          this.server
            .to(`live-feed:${span.projectId}`)
            .emit('span-completed', span);
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
    const token = (client.handshake.auth as { token?: string })?.token;
    if (!token) {
      this.logger.warn(`Client ${client.id} rejected: no auth token`);
      client.disconnect(true);
      return;
    }

    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      const payload = this.jwtService.verify<SocketData>(token, { secret });
      (client.data as SocketData) = {
        userId: payload.userId,
        orgId: payload.orgId,
        email: payload.email,
      };
      this.logger.debug(`Client connected: ${client.id} (user=${payload.userId})`);
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect(true);
    }
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

  @SubscribeMessage('subscribe-live-feed')
  async handleSubscribeLiveFeed(
    client: Socket,
    payload: { projectId: string },
  ): Promise<void> {
    const room = `live-feed:${payload.projectId}`;
    await client.join(room);
    this.logger.debug(`Client ${client.id} joined ${room}`);
  }

  @SubscribeMessage('unsubscribe-live-feed')
  async handleUnsubscribeLiveFeed(
    client: Socket,
    payload: { projectId: string },
  ): Promise<void> {
    const room = `live-feed:${payload.projectId}`;
    await client.leave(room);
    this.logger.debug(`Client ${client.id} left ${room}`);
  }

  /**
   * Publishes a processed span to the Redis pub/sub channel for the given trace.
   * Other service instances will receive this and forward it to connected WebSocket clients.
   */
  static async publishSpan(redis: Redis, span: ProcessedSpan): Promise<void> {
    const channel = `agentlens:spans:${span.traceId}`;
    await redis.publish(channel, JSON.stringify(span));
  }

  /**
   * Publishes a completed span to the Redis pub/sub channel for the live feed.
   * All clients subscribed to the live-feed room will receive a span-completed event.
   */
  static async publishSpanCompleted(redis: Redis, span: ProcessedSpan): Promise<void> {
    const channel = `agentlens:spans-completed:${span.traceId}`;
    await redis.publish(channel, JSON.stringify(span));
  }
}
