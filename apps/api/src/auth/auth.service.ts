import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { OrganizationEntity, OrgPlan } from '../database/entities/index.js';
import { UserEntity, UserRole } from '../database/entities/user.entity.js';
import type { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const slugTaken = await this.orgRepo.findOne({ where: { slug: dto.orgSlug } });
    if (slugTaken) throw new ConflictException('Organisation slug already taken');

    const org = this.orgRepo.create({
      name: dto.orgName,
      slug: dto.orgSlug,
      plan: OrgPlan.FREE,
    });
    const savedOrg = await this.orgRepo.save(org);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = this.userRepo.create({
      orgId: savedOrg.id,
      email: dto.email,
      passwordHash,
      role: UserRole.OWNER,
    });
    const savedUser = await this.userRepo.save(user);

    return this.buildAuthResponse(savedUser, savedOrg.id);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResponse(user, user.orgId);
  }

  private buildAuthResponse(user: UserEntity, orgId: string): AuthResponseDto {
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');
    const token = this.jwtService.sign(
      { userId: user.id, orgId, email: user.email },
      { secret, expiresIn: '7d' },
    );
    return { token, userId: user.id, orgId, email: user.email };
  }
}
