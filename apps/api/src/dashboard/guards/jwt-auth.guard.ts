import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  userId: string;
  orgId: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      request.user = this.jwtService.verify<JwtPayload>(token, { secret });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      throw new UnauthorizedException(
        message.includes('expired') ? 'Token has expired' : 'Invalid token',
      );
    }
  }
}
