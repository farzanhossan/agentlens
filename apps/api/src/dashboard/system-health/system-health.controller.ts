import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ElasticsearchService } from '../../span-processor/elasticsearch/elasticsearch.service.js';

@ApiTags('system')
@Controller('system')
export class SystemHealthController {
  constructor(private readonly esService: ElasticsearchService) {}

  @Get('health')
  @ApiOperation({ summary: 'System health check including Elasticsearch status' })
  @ApiResponse({ status: 200 })
  async getHealth(): Promise<{ elasticsearch: 'connected' | 'unavailable' }> {
    let esStatus: 'connected' | 'unavailable' = 'unavailable';
    try {
      const healthy = await this.esService.isHealthy();
      esStatus = healthy ? 'connected' : 'unavailable';
    } catch {
      esStatus = 'unavailable';
    }
    return { elasticsearch: esStatus };
  }
}
