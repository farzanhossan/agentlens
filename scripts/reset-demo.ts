/**
 * scripts/reset-demo.ts
 *
 * Wipes all demo data for the "Demo Corp" org from PostgreSQL and Elasticsearch.
 * Run with:  pnpm seed:reset
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Client as EsClient } from '@elastic/elasticsearch';

import { seedConfig } from './seed-demo.config';

import {
  AlertEntity,
  OrganizationEntity,
  ProjectEntity,
  SpanEntity,
  TraceEntity,
  UserEntity,
} from '../apps/api/src/database/entities/index';

async function main(): Promise<void> {
  const cfg = seedConfig;
  const startTime = Date.now();

  console.log(`\n🗑️  Resetting AgentLens demo data for org "${cfg.orgName}"...\n`);

  const DATABASE_URL =
    process.env['DATABASE_URL'] ?? 'postgresql://agentlens:agentlens@localhost:5432/agentlens';

  const dataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    synchronize: false,
    entities: [
      OrganizationEntity,
      ProjectEntity,
      TraceEntity,
      SpanEntity,
      AlertEntity,
      UserEntity,
    ],
    logging: false,
  });

  await dataSource.initialize();

  const ES_URL = process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200';
  const esClient = new EsClient({
    node: ES_URL,
    auth: {
      username: process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic',
      password: process.env['ELASTICSEARCH_PASSWORD'] ?? 'agentlens',
    },
    tls: { rejectUnauthorized: false },
    requestTimeout: 30_000,
  });

  try {
    const orgRepo  = dataSource.getRepository(OrganizationEntity);
    const projRepo = dataSource.getRepository(ProjectEntity);
    const userRepo = dataSource.getRepository(UserEntity);

    const org = await orgRepo.findOneBy({ slug: cfg.orgSlug });

    if (!org) {
      console.log(`  ℹ️  Demo org "${cfg.orgName}" not found — nothing to reset.\n`);
      return;
    }

    // Collect project IDs before cascade-delete removes them
    const projects = await projRepo.findBy({ organizationId: org.id });
    const projectIds = projects.map((p) => p.id);

    // Delete org (cascades to projects → traces → spans, alerts, users)
    await userRepo.delete({ orgId: org.id });
    await orgRepo.remove(org);
    console.log(`  ✓ Deleted org "${cfg.orgName}" and all associated data`);

    // Delete Elasticsearch docs for all spans in these projects
    if (projectIds.length > 0) {
      const INDEX = 'agentlens_spans';
      try {
        const indexExists = await esClient.indices.exists({ index: INDEX });
        if (indexExists) {
          const result = await esClient.deleteByQuery({
            index: INDEX,
            body: {
              query: {
                terms: { projectId: projectIds },
              },
            },
            refresh: true,
          });
          const deleted = result.deleted ?? 0;
          console.log(`  ✓ Removed ${deleted.toLocaleString()} spans from Elasticsearch`);
        }
      } catch (err) {
        console.warn(`  ⚠️  Elasticsearch cleanup skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Reset complete in ${elapsed}s\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ Reset failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
