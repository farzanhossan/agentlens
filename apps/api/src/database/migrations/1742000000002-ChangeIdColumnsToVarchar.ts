import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Change trace and span ID columns from UUID to VARCHAR(128) so that
 * SDKs can use any string-based ID format (e.g. OpenTelemetry 32-char hex).
 * project_id columns remain UUID as they reference the projects table.
 */
export class ChangeIdColumnsToVarchar1742000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop FK constraints referencing these columns first
    await queryRunner.query(`
      ALTER TABLE spans
        DROP CONSTRAINT IF EXISTS "FK_spans_trace_id",
        DROP CONSTRAINT IF EXISTS "FK_spans_parent_span_id"
    `);

    // Drop any FK constraints that TypeORM may have auto-named
    await queryRunner.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = 'spans'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name IN ('trace_id', 'parent_span_id')
        ) LOOP
          EXECUTE 'ALTER TABLE spans DROP CONSTRAINT IF EXISTS "' || r.constraint_name || '"';
        END LOOP;
      END $$
    `);

    // Change traces.id
    await queryRunner.query(`ALTER TABLE traces ALTER COLUMN id TYPE VARCHAR(128) USING id::VARCHAR`);

    // Change spans.id, trace_id, parent_span_id
    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN id TYPE VARCHAR(128) USING id::VARCHAR`);
    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN trace_id TYPE VARCHAR(128) USING trace_id::VARCHAR`);
    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN parent_span_id TYPE VARCHAR(128) USING parent_span_id::VARCHAR`);

    // Recreate FK: spans.trace_id -> traces.id
    await queryRunner.query(`
      ALTER TABLE spans
        ADD CONSTRAINT fk_spans_trace_id
        FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
    `);

    // Recreate FK: spans.parent_span_id -> spans.id
    await queryRunner.query(`
      ALTER TABLE spans
        ADD CONSTRAINT fk_spans_parent_span_id
        FOREIGN KEY (parent_span_id) REFERENCES spans(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE spans DROP CONSTRAINT IF EXISTS fk_spans_trace_id`);
    await queryRunner.query(`ALTER TABLE spans DROP CONSTRAINT IF EXISTS fk_spans_parent_span_id`);

    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN parent_span_id TYPE UUID USING parent_span_id::UUID`);
    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN trace_id TYPE UUID USING trace_id::UUID`);
    await queryRunner.query(`ALTER TABLE spans ALTER COLUMN id TYPE UUID USING id::UUID`);
    await queryRunner.query(`ALTER TABLE traces ALTER COLUMN id TYPE UUID USING id::UUID`);

    await queryRunner.query(`
      ALTER TABLE spans
        ADD CONSTRAINT fk_spans_trace_id FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE,
        ADD CONSTRAINT fk_spans_parent_span_id FOREIGN KEY (parent_span_id) REFERENCES spans(id) ON DELETE SET NULL
    `);
  }
}
