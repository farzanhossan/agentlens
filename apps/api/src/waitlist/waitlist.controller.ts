import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator.js';
import { WaitlistService } from './waitlist.service.js';

class WaitlistDto {
  @IsEmail()
  email!: string;
}

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Public()
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Add an email to the waitlist' })
  @ApiResponse({ status: 201, description: 'Added to waitlist' })
  @ApiResponse({ status: 409, description: 'Already on waitlist' })
  async join(
    @Body() dto: WaitlistDto,
  ): Promise<{ message: string }> {
    const { created } = await this.waitlistService.saveEmail(dto.email);

    if (!created) {
      throw new ConflictException('Already on waitlist');
    }

    return { message: 'Added to waitlist' };
  }
}
