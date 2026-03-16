import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../database/entities/index.js';
import type { UpdateOrgDto, OrgResponseDto } from './dto/org.dto.js';

@Injectable()
export class OrgService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  async getOrg(orgId: string): Promise<OrgResponseDto> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    return this.toDto(org);
  }

  async updateOrg(orgId: string, dto: UpdateOrgDto): Promise<OrgResponseDto> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.slug !== undefined) org.slug = dto.slug;
    const saved = await this.orgRepo.save(org);
    return this.toDto(saved);
  }

  private toDto(org: OrganizationEntity): OrgResponseDto {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      createdAt: org.createdAt,
    };
  }
}
