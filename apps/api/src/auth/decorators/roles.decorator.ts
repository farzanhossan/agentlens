import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../database/entities/user.entity.js';

export const ROLES_KEY = 'roles';

/**
 * Decorator that restricts endpoint access to users with specific roles.
 * Usage: @Roles(UserRole.OWNER, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
