import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpanEntity } from '../../database/entities/index.js';
import { ElasticsearchService } from '../../span-processor/elasticsearch/elasticsearch.service.js';
import { SearchSpansQueryDto, SpanDetailDto, SpanSearchHitDto } from './dto/spans.dto.js';

@Injectable()
export class SpansService {
  constructor(
    @InjectRepository(SpanEntity)
    private readonly spanRepo: Repository<SpanEntity>,
    private readonly elasticsearchService: ElasticsearchService,
  ) {}

  async getSpan(projectId: string, spanId: string): Promise<SpanDetailDto> {
    const span = await this.spanRepo.findOne({ where: { id: spanId } });
    if (!span || span.projectId !== projectId) {
      throw new NotFoundException(`Span ${spanId} not found`);
    }

    // Retrieve input/output from Elasticsearch, fall back to PostgreSQL
    let inputText: string | undefined;
    let outputText: string | undefined;

    try {
      const esResult = await this.elasticsearchService.searchSpans(projectId, spanId, 0, 1);
      const hit = esResult.hits.find((h) => h._source.spanId === spanId);
      if (hit) {
        inputText = hit._source.input;
        outputText = hit._source.output;
      }
    } catch {
      // ES unavailable — fall back to PostgreSQL columns
    }

    // Fall back to DB if ES didn't have the data
    if (!inputText && span.input) inputText = span.input;
    if (!outputText && span.output) outputText = span.output;

    return SpanDetailDto.fromEntity(span, { input: inputText, output: outputText });
  }

  async searchSpans(
    projectId: string,
    query: SearchSpansQueryDto,
  ): Promise<{ hits: SpanSearchHitDto[]; total: number }> {
    const from = query.from ?? 0;
    const size = query.size ?? 20;

    const esResult = await this.elasticsearchService.searchSpans(projectId, query.q, from, size);

    const hits: SpanSearchHitDto[] = esResult.hits.map((h) => {
      const src = h._source;
      const hit = new SpanSearchHitDto();
      hit.spanId = src.spanId;
      hit.traceId = src.traceId;
      hit.name = src.name;
      hit.model = src.model;
      hit.provider = src.provider;
      hit.status = src.status;
      hit.startedAt = src.startedAt;
      hit.input = src.input;
      hit.output = src.output;
      // Elasticsearch does not expose _score in the typed response directly;
      // we default to 1 when no score is available
      hit.score = 1;
      return hit;
    });

    return { hits, total: esResult.total };
  }
}
