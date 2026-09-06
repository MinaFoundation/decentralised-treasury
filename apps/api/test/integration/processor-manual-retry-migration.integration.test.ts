import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DataSource } from "typeorm";
import { ensureDatabaseSchema } from "../../src/db/ensure-database-schema.js";
import { ConfigureProcessorSchema1775649313439 } from "../../src/db/migrations/1775649313439-configure-processor-schema.js";
import { InitializeProcessorSchema1775649313440 } from "../../src/db/migrations/1775649313440-initialize-processor-schema.js";
import { BackendPipelineHardening1788447600000 } from "../../src/db/migrations/1788447600000-backend-pipeline-hardening.js";
import { ProposalContractProjection1788451200000 } from "../../src/db/migrations/1788451200000-proposal-contract-projection.js";
import { ProcessorManualRetryAttemptCount1788454800000 } from "../../src/db/migrations/1788454800000-processor-manual-retry-attempt-count.js";

const databaseTestUrl = process.env.DATABASE_TEST_URL;

test(
  "PostgreSQL migration permits the manual retry attempt reset",
  { skip: databaseTestUrl ? false : "DATABASE_TEST_URL is not set" },
  async () => {
    assert.ok(databaseTestUrl);
    const schema = `processor_retry_${randomUUID().replaceAll("-", "")}`;
    const admin = new DataSource({ type: "postgres", url: databaseTestUrl });
    let dataSource: DataSource | null = null;

    try {
      await admin.initialize();
      await ensureDatabaseSchema(databaseTestUrl, schema);
      dataSource = new DataSource({
        type: "postgres",
        url: databaseTestUrl,
        schema,
        synchronize: false,
        migrations: [
          ConfigureProcessorSchema1775649313439,
          InitializeProcessorSchema1775649313440,
          BackendPipelineHardening1788447600000,
          ProposalContractProjection1788451200000,
          ProcessorManualRetryAttemptCount1788454800000,
        ],
        migrationsTableName: "typeorm_migrations",
      });
      await dataSource.initialize();
      const applied = await dataSource.runMigrations();
      assert.equal(
        applied.at(-1)?.name,
        "ProcessorManualRetryAttemptCount1788454800000",
      );

      await dataSource.query(
        `INSERT INTO "${schema}"."processor_event_failures" (
          "processor_name", "archive_event_id", "change_sequence", "state",
          "attempt_count", "error_code", "bounded_error_message",
          "event_snapshot", "last_failed_at"
        ) VALUES (
          'manual-retry-test', 1, 1, 'blocked', 1, 'EVENT_NOT_HANDLED',
          'test failure', '{}'::jsonb, now()
        )`,
      );
      await dataSource.query(
        `UPDATE "${schema}"."processor_event_failures"
         SET "state" = 'retrying', "attempt_count" = 0
         WHERE "processor_name" = 'manual-retry-test'`,
      );
      const [failure] = (await dataSource.query(
        `SELECT "state", "attempt_count"
         FROM "${schema}"."processor_event_failures"
         WHERE "processor_name" = 'manual-retry-test'`,
      )) as Array<{ state: string; attempt_count: number }>;
      assert.deepEqual(failure, { state: "retrying", attempt_count: 0 });
      await assert.rejects(
        dataSource.query(
          `UPDATE "${schema}"."processor_event_failures"
           SET "attempt_count" = -1
           WHERE "processor_name" = 'manual-retry-test'`,
        ),
        /check constraint|violates check/i,
      );
    } finally {
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
      if (admin.isInitialized) {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await admin.destroy();
        }
      }
    }
  },
);
