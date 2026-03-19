import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { IngestService } from './ingest.service.js';

@ApiTags('Ingest')
@Controller('v1/spans')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  /** SDK-facing endpoint — accepts gzip or plain JSON, requires X-API-Key only. */
  @Public()
  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Receive span batch directly from SDK' })
  async ingestFromSdk(
    @Body() body: { spans: unknown[] },
    @Headers('x-api-key') apiKey: string,
  ): Promise<{ accepted: boolean; count: number }> {
    if (!apiKey) throw new UnauthorizedException('X-API-Key header required');
    if (!body?.spans || !Array.isArray(body.spans)) {
      throw new BadRequestException('spans array required');
    }
    await this.ingestService.enqueueSpans(body.spans, apiKey);
    return { accepted: true, count: body.spans.length };
  }

  /** Worker-facing endpoint — called by the Cloudflare ingest worker. */
  @Public()
  @Post('ingest')
  @HttpCode(202)
  @ApiOperation({ summary: 'Receive span batch from CF Worker' })
  async ingest(
    @Body() body: { spans: unknown[] },
    @Headers('x-api-key') apiKey: string,
    @Headers('x-worker-secret') workerSecret: string,
  ): Promise<{ accepted: boolean; count: number }> {
    if (workerSecret !== process.env.WORKER_SECRET) {
      throw new UnauthorizedException('Invalid worker secret');
    }

    if (!body.spans || !Array.isArray(body.spans)) {
      throw new BadRequestException('spans array required');
    }

    await this.ingestService.enqueueSpans(body.spans, apiKey);

    return { accepted: true, count: body.spans.length };
  }
}
