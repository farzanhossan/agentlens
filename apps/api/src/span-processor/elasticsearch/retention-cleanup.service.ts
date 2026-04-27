import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { Client } from '@elastic/elasticsearch';
import { ConfigService } from '@nestjs/config';
import { ProjectEntity } from '../../database/entities/index.js';

const INDEX = 'agentlens_spans';
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Daily cleanup job that deletes ES span documents older than each
 * project's configured `retentionDays`.
 *
 * Runs once on startup and then every 24 hours.
 */
@Injectable()
export class RetentionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCleanupService.name);
  private readonly client: Client;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    config: ConfigService,
  ) {
    this.client = new Client({
      node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
      requestTimeout: 30_000,
    });
  }

  onModuleInit(): void {
    // Schedule daily cleanup (first run after 1 hour to let the system settle)
    this.timer = setInterval(() => {
      this.handleCleanup().catch((err) =>
        this.logger.error(`Retention cleanup error: ${String(err)}`),
      );
    }, CLEANUP_INTERVAL_MS);
    this.logger.log('Retention cleanup scheduled (every 24h)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async handleCleanup(): Promise<void> {
    this.logger.log('Starting ES retention cleanup');

    const projects = await this.projectRepo.find({
      where: { retentionDays: Not(IsNull()) },
      select: ['id', 'name', 'retentionDays'],
    });

    if (projects.length === 0) {
      this.logger.log('No projects with custom retention — skipping');
      return;
    }

    let totalDeleted = 0;

    for (const project of projects) {
      const cutoff = new Date(
        Date.now() - project.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      try {
        const result = await this.client.deleteByQuery({
          index: INDEX,
          refresh: false,
          body: {
            query: {
              bool: {
                filter: [
                  { term: { projectId: project.id } },
                  { range: { startedAt: { lt: cutoff } } },
                ],
              },
            },
          },
        });

        const deleted = Number(result.deleted ?? 0);
        totalDeleted += deleted;

        if (deleted > 0) {
          this.logger.log(
            `Deleted ${deleted} expired spans for project "${project.name}" (retention: ${project.retentionDays}d)`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Retention cleanup failed for project "${project.name}": ${String(err)}`,
        );
      }
    }

    this.logger.log(`Retention cleanup complete. Total deleted: ${totalDeleted}`);
  }
}
