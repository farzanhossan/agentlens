import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import type { JwtPayload } from '../guards/global-jwt.guard.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const jwtPayload = request.user;
    if (!jwtPayload) throw new ForbiddenException('No authenticated user');

    const user = await this.userRepo.findOne({ where: { id: jwtPayload.userId } });
    if (!user) throw new ForbiddenException('User not found');

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Role "${user.role}" is not authorized. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
