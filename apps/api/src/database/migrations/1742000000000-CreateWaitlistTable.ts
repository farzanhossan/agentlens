import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWaitlistTable1742000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id         UUID         NOT NULL DEFAULT gen_random_uuid(),
        email      VARCHAR(255) NOT NULL,
        source     VARCHAR(50)  NOT NULL DEFAULT 'landing',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT pk_waitlist        PRIMARY KEY (id),
        CONSTRAINT uq_waitlist_email  UNIQUE      (email)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS waitlist`);
  }
}
