import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the alert_firings table, add monthly_budget_usd to projects,
 * and add 'viewer' to the user_role enum.
 */
export class AddAlertFiringsAndBudget1742000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create delivery_status enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE delivery_status AS ENUM ('success', 'failed', 'pending');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 2. Create alert_firings table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alert_firings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        project_id UUID NOT NULL,
        alert_name VARCHAR(256) NOT NULL,
        alert_type alert_type NOT NULL,
        current_value DECIMAL(10, 4) NOT NULL,
        threshold DECIMAL(10, 4) NOT NULL,
        channel alert_channel NOT NULL,
        delivery_status delivery_status NOT NULL DEFAULT 'pending',
        error_message TEXT,
        fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_firings_project ON alert_firings (project_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_firings_alert ON alert_firings (alert_id)
    `);

    // 3. Add monthly_budget_usd to projects
    await queryRunner.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS monthly_budget_usd DECIMAL(10, 2)
    `);

    // 4. Add 'viewer' to user role enum if not present
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS alert_firings`);
    await queryRunner.query(`DROP TYPE IF EXISTS delivery_status`);
    await queryRunner.query(`
      ALTER TABLE projects DROP COLUMN IF EXISTS monthly_budget_usd
    `);
    // Note: PostgreSQL does not support removing enum values
  }
}
