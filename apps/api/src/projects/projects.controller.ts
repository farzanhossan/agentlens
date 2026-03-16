import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import type { ProjectEntity } from './project.entity.js';

@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(
    @Body() body: { name: string; description?: string },
  ): Promise<ProjectEntity> {
    return this.projectsService.create(body.name, body.description);
  }

  @Get()
  async findAll(): Promise<ProjectEntity[]> {
    return this.projectsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProjectEntity> {
    const project = await this.projectsService.findOne(id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }
}
