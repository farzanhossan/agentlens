import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1742000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             UUID         NOT NULL DEFAULT gen_random_uuid(),
        org_id         UUID         NOT NULL,
        email          VARCHAR(320) NOT NULL,
        password_hash  VARCHAR(72)  NOT NULL,
        role           user_role    NOT NULL DEFAULT 'member',
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pk_users        PRIMARY KEY (id),
        CONSTRAINT uq_users_email  UNIQUE (email),
        CONSTRAINT fk_users_org    FOREIGN KEY (org_id)
          REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);
  }
}
