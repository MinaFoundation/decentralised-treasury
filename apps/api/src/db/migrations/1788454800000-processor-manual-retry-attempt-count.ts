import { MigrationInterface, QueryRunner } from "typeorm";

function getConfiguredSchema(queryRunner: QueryRunner): string {
  const schema = String(
    (queryRunner.connection.options as { schema?: string }).schema ?? "public",
  );
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("DATABASE_SCHEMA must be a valid SQL identifier");
  }
  return schema;
}

async function useConfiguredSchema(queryRunner: QueryRunner): Promise<void> {
  const schema = getConfiguredSchema(queryRunner);
  await queryRunner.query(`SET search_path TO "${schema}", public`);
}

export class ProcessorManualRetryAttemptCount1788454800000 implements MigrationInterface {
  public readonly name = "ProcessorManualRetryAttemptCount1788454800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await useConfiguredSchema(queryRunner);
    await queryRunner.query(
      `ALTER TABLE "processor_event_failures" DROP CONSTRAINT "CK_processor_event_failures_attempt_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_event_failures" ADD CONSTRAINT "CK_processor_event_failures_attempt_count" CHECK ("attempt_count" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await useConfiguredSchema(queryRunner);
    await queryRunner.query(
      `ALTER TABLE "processor_event_failures" DROP CONSTRAINT "CK_processor_event_failures_attempt_count"`,
    );
    await queryRunner.query(
      `UPDATE "processor_event_failures" SET "attempt_count" = 1 WHERE "attempt_count" = 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_event_failures" ADD CONSTRAINT "CK_processor_event_failures_attempt_count" CHECK ("attempt_count" > 0)`,
    );
  }
}
