import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add input and output text columns to the spans table.
 * These store LLM prompt/completion text alongside Elasticsearch
 * for fallback when ES is unavailable.
 */
export class AddInputOutputToSpans1742000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE spans
        ADD COLUMN IF NOT EXISTS input TEXT,
        ADD COLUMN IF NOT EXISTS output TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE spans
        DROP COLUMN IF EXISTS input,
        DROP COLUMN IF EXISTS output
    `);
  }
}
