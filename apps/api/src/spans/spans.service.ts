import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpanEntity } from './span.entity.js';

export interface SpanFilter {
  projectId: string;
  traceId?: string;
  status?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
}

@Injectable()
export class SpansService {
  private readonly logger = new Logger(SpansService.name);

  constructor(
    @InjectRepository(SpanEntity)
    private readonly repo: Repository<SpanEntity>,
  ) {}

  async ingestBatch(spans: Partial<SpanEntity>[]): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(SpanEntity)
      // TypeORM's _QueryDeepPartialEntity doesn't accept Record<string, unknown>;
      // the cast is safe because values() accepts any plain object at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(spans as unknown as any[])
      .orIgnore()
      .execute();
    this.logger.debug(`Ingested ${spans.length} spans`);
  }

  async findByTrace(projectId: string, traceId: string): Promise<SpanEntity[]> {
    return this.repo.find({
      where: { projectId, traceId },
      order: { startTimeMs: 'ASC' },
    });
  }

  async query(filter: SpanFilter): Promise<{ spans: SpanEntity[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('s')
      .where('s.projectId = :projectId', { projectId: filter.projectId });

    if (filter.traceId) qb.andWhere('s.traceId = :traceId', { traceId: filter.traceId });
    if (filter.status) qb.andWhere('s.status = :status', { status: filter.status });
    if (filter.fromMs) qb.andWhere('s.startTimeMs >= :fromMs', { fromMs: filter.fromMs });
    if (filter.toMs) qb.andWhere('s.startTimeMs <= :toMs', { toMs: filter.toMs });

    qb.orderBy('s.startTimeMs', 'DESC')
      .skip(filter.offset ?? 0)
      .take(filter.limit ?? 50);

    const [spans, total] = await qb.getManyAndCount();
    return { spans, total };
  }
}
