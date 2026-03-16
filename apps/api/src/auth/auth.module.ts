import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity, ProjectEntity } from '../database/entities/index.js';
import { UserEntity } from '../database/entities/user.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GlobalJwtGuard } from './guards/global-jwt.guard.js';
import { OrgController } from './org.controller.js';
import { OrgService } from './org.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsAuthService } from './projects.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, OrganizationEntity, ProjectEntity]),
    // JwtModule without secret — the guard reads JWT_SECRET from ConfigService at runtime
    JwtModule.register({}),
  ],
  controllers: [AuthController, OrgController, ProjectsController],
  providers: [
    AuthService,
    OrgService,
    ProjectsAuthService,
    GlobalJwtGuard,
    {
      provide: APP_GUARD,
      useExisting: GlobalJwtGuard,
    },
  ],
  exports: [GlobalJwtGuard],
})
export class AuthModule {}
