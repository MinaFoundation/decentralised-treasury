import type { MigrationInterface, QueryRunner } from "typeorm";
import {
  qualifyTableName,
  resolveDatabaseSchema,
} from "../../database-schema.js";

export class ProcessorEventQuarantine1790586000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifyTableName(
      resolveDatabaseSchema(queryRunner.connection),
      "processor_event_failures",
    );
    await queryRunner.query(`ALTER TABLE ${table}
      DROP CONSTRAINT "CK_processor_event_failures_state"`);
    await queryRunner.query(`ALTER TABLE ${table}
      ADD CONSTRAINT "CK_processor_event_failures_state"
      CHECK ("state" IN ('retrying', 'blocked', 'quarantined', 'resolved', 'superseded'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = qualifyTableName(
      resolveDatabaseSchema(queryRunner.connection),
      "processor_event_failures",
    );
    // Preserve rejected observations for inspection on rollback.
    await queryRunner.query(`UPDATE ${table}
      SET "state" = 'blocked' WHERE "state" = 'quarantined'`);
    await queryRunner.query(`ALTER TABLE ${table}
      DROP CONSTRAINT "CK_processor_event_failures_state"`);
    await queryRunner.query(`ALTER TABLE ${table}
      ADD CONSTRAINT "CK_processor_event_failures_state"
      CHECK ("state" IN ('retrying', 'blocked', 'resolved', 'superseded'))`);
  }
}
