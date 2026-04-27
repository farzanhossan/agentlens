/**
 * scripts/backfill-es-agent-name.ts
 *
 * One-time backfill: populates the `agentName` field on existing Elasticsearch
 * span documents by looking up `agent_name` from the PostgreSQL `traces` table.
 *
 * Run with:  npx tsx scripts/backfill-es-agent-name.ts
 *
 * Idempotent — safe to run multiple times.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Client as EsClient } from '@elastic/elasticsearch';

const INDEX = 'agentlens_spans';
const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const DATABASE_URL =
    process.env['DATABASE_URL'] ?? 'postgresql://agentlens:agentlens@localhost:5432/agentlens';

  const dataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    synchronize: false,
    entities: [],
  });

  await dataSource.initialize();

  const ES_URL = process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200';
  const esClient = new EsClient({
    node: ES_URL,
    auth: {
      username: process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic',
      password: process.env['ELASTICSEARCH_PASSWORD'] ?? '',
    },
  });

  // 1. Fetch all (trace_id, agent_name) pairs from Postgres
  const rows = await dataSource.query<Array<{ id: string; agent_name: string }>>(
    `SELECT id, agent_name FROM traces WHERE agent_name IS NOT NULL`,
  );

  console.log(`Found ${rows.length} traces with agent names to backfill`);

  // 2. Batch update ES documents
  let totalUpdated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      try {
        const result = await esClient.updateByQuery({
          index: INDEX,
          refresh: false,
          body: {
            query: {
              bool: {
                filter: [
                  { term: { traceId: row.id } },
                ],
                must_not: [
                  { exists: { field: 'agentName' } },
                ],
              },
            },
            script: {
              source: 'ctx._source.agentName = params.agentName',
              lang: 'painless',
              params: { agentName: row.agent_name },
            },
          },
        });

        const updated = Number(result.updated ?? 0);
        totalUpdated += updated;
      } catch (err) {
        console.error(`Failed to update spans for trace ${row.id}: ${err}`);
      }
    }

    console.log(`Processed ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} traces (${totalUpdated} spans updated)`);
  }

  // 3. Refresh the index so updates are visible
  await esClient.indices.refresh({ index: INDEX });

  console.log(`Backfill complete. Updated ${totalUpdated} span documents.`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
