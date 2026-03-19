import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistEntity } from './waitlist.entity.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WaitlistEntity])],
  controllers: [WaitlistController],
  providers: [WaitlistService],
})
export class WaitlistModule {}
