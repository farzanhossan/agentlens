import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import {
  F1QueryDto,
  F1ResponseDto,
  MisclassificationsQueryDto,
  MisclassificationsResponseDto,
} from './dto/evaluations.dto.js';
import { EvaluationsService } from './evaluations.service.js';

@ApiTags('evaluations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/evaluations')
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get('f1')
  @ApiOperation({ summary: 'Get F1/precision/recall/accuracy summary and breakdown' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'F1 metrics', type: F1ResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getF1(
    @Param('projectId') projectId: string,
    @Query() query: F1QueryDto,
  ): Promise<F1ResponseDto> {
    return this.evaluationsService.getF1Summary(projectId, query);
  }

  @Get('misclassifications')
  @ApiOperation({ summary: 'List misclassified evaluation spans' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'Misclassifications', type: MisclassificationsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMisclassifications(
    @Param('projectId') projectId: string,
    @Query() query: MisclassificationsQueryDto,
  ): Promise<MisclassificationsResponseDto> {
    return this.evaluationsService.getMisclassifications(projectId, query);
  }
}
