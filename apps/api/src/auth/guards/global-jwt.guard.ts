import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export interface JwtPayload {
  userId: string;
  orgId: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class GlobalJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

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
