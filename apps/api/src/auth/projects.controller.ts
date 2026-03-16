import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from './guards/global-jwt.guard.js';
import { ProjectsAuthService } from './projects.service.js';
import { CreateProjectDto, ProjectResponseDto, ProjectWithKeyDto, UpdateProjectDto } from './dto/project.dto.js';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsAuthService) {}

  @Get()
  @ApiOperation({ summary: 'List all projects for the authenticated organisation' })
  @ApiResponse({ status: 200, type: [ProjectResponseDto] })
  async listProjects(@CurrentUser() user: JwtPayload): Promise<ProjectResponseDto[]> {
    return this.projectsService.listProjects(user.orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a project and generate its API key' })
  @ApiResponse({ status: 201, type: ProjectWithKeyDto, description: 'API key shown once — store securely' })
  async createProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectWithKeyDto> {
    return this.projectsService.createProject(user.orgId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getProject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.getProject(user.orgId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project metadata' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  async updateProject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.updateProject(user.orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  @ApiResponse({ status: 204 })
  async deleteProject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.projectsService.deleteProject(user.orgId, id);
  }

  @Post(':id/rotate-key')
  @ApiOperation({ summary: 'Rotate the API key for a project' })
  @ApiParam({ name: 'id', description: 'Project UUID' })
  @ApiResponse({ status: 201, type: ProjectWithKeyDto, description: 'New API key shown once' })
  async rotateKey(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<ProjectWithKeyDto> {
    return this.projectsService.rotateKey(user.orgId, id);
  }
}
