import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { ProjectEntity } from '../database/entities/index.js';
import type {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  ProjectWithKeyDto,
} from './dto/project.dto.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class ProjectsAuthService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly configService: ConfigService,
  ) {}

  async listProjects(orgId: string): Promise<ProjectResponseDto[]> {
    const projects = await this.projectRepo.find({ where: { organizationId: orgId }, order: { createdAt: 'DESC' } });
    return projects.map((p) => this.toDto(p));
  }

  async createProject(orgId: string, dto: CreateProjectDto): Promise<ProjectWithKeyDto> {
    // Create without apiKey first to get the UUID
    const project = this.projectRepo.create({
      organizationId: orgId,
      name: dto.name,
      apiKey: 'pending', // placeholder
    });
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.retentionDays !== undefined) project.retentionDays = dto.retentionDays;

    const saved = await this.projectRepo.save(project);

    // Generate key using the real UUID
    const rawKey = this.generateRawKey(saved.id);
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
    await this.projectRepo.update(saved.id, { apiKey: keyHash });

    return { ...this.toDto(saved), apiKey: rawKey };
  }

  async getProject(orgId: string, projectId: string): Promise<ProjectResponseDto> {
    const project = await this.findOwned(orgId, projectId);
    return this.toDto(project);
  }

  async updateProject(orgId: string, projectId: string, dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    const project = await this.findOwned(orgId, projectId);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.retentionDays !== undefined) project.retentionDays = dto.retentionDays;
    const saved = await this.projectRepo.save(project);
    return this.toDto(saved);
  }

  async deleteProject(orgId: string, projectId: string): Promise<void> {
    const project = await this.findOwned(orgId, projectId);
    await this.projectRepo.remove(project);
  }

  async rotateKey(orgId: string, projectId: string): Promise<ProjectWithKeyDto> {
    const project = await this.findOwned(orgId, projectId);
    const rawKey = this.generateRawKey(project.id);
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
    await this.projectRepo.update(project.id, { apiKey: keyHash });
    return { ...this.toDto(project), apiKey: rawKey };
  }

  // ---------------------------------------------------------------------------

  private generateRawKey(projectId: string): string {
    const secret = this.configService.getOrThrow<string>('HMAC_SECRET');
    const projectIdB64 = Buffer.from(projectId).toString('base64url');
    const hmac = crypto.createHmac('sha256', secret).update(projectId).digest('hex');
    return `proj_${projectIdB64}.${hmac}`;
  }

  private async findOwned(orgId: string, projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.organizationId !== orgId) throw new ForbiddenException('Access denied');
    return project;
  }

  private toDto(project: ProjectEntity): ProjectResponseDto {
    const dto: ProjectResponseDto = {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      retentionDays: project.retentionDays,
      createdAt: project.createdAt,
    };
    if (project.description !== undefined) dto.description = project.description;
    return dto;
  }
}
