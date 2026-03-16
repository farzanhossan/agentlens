import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from './project.entity.js';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
  ) {}

  async create(name: string, description?: string): Promise<ProjectEntity> {
    return this.repo.save(this.repo.create({ name, description }));
  }

  async findAll(): Promise<ProjectEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<ProjectEntity | null> {
    return this.repo.findOneBy({ id });
  }
}
