import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from './guards/global-jwt.guard.js';
import { OrgService } from './org.service.js';
import { OrgResponseDto, UpdateOrgDto } from './dto/org.dto.js';

@ApiTags('org')
@ApiBearerAuth()
@Controller('org')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Get()
  @ApiOperation({ summary: 'Get current organisation details' })
  @ApiResponse({ status: 200, type: OrgResponseDto })
  async getOrg(@CurrentUser() user: JwtPayload): Promise<OrgResponseDto> {
    return this.orgService.getOrg(user.orgId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update organisation name or slug' })
  @ApiResponse({ status: 200, type: OrgResponseDto })
  async updateOrg(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOrgDto,
  ): Promise<OrgResponseDto> {
    return this.orgService.updateOrg(user.orgId, dto);
  }
}
