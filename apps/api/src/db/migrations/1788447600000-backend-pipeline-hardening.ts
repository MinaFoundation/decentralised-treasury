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

async function useConfiguredSchema(queryRunner: QueryRunner): Promise<string> {
  const schema = getConfiguredSchema(queryRunner);
  await queryRunner.query(`SET search_path TO "${schema}", public`);
  return schema;
}

export class BackendPipelineHardening1788447600000 implements MigrationInterface {
  public readonly name = "BackendPipelineHardening1788447600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = await useConfiguredSchema(queryRunner);
    const sequence = `"${schema}"."archive_event_change_sequence_seq"`;
    const lockTriggerFunction = `"${schema}"."lock_archive_event_change_sequence"`;
    const assignTriggerFunction = `"${schema}"."assign_archive_event_change_sequence"`;

    await queryRunner.query(
      `CREATE SEQUENCE "archive_event_change_sequence_seq" AS bigint START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "change_sequence" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "block_event_index" integer`,
    );
    await queryRunner.query(`
      WITH ordered_events AS (
        SELECT
          "id",
          row_number() OVER (ORDER BY "updated_at", "id") AS "change_sequence",
          row_number() OVER (
            PARTITION BY "block_height"
            ORDER BY "id"
          ) - 1 AS "block_event_index"
        FROM "archive_events"
      )
      UPDATE "archive_events" AS event
      SET
        "change_sequence" = ordered."change_sequence",
        "block_event_index" = ordered."block_event_index"
      FROM ordered_events AS ordered
      WHERE event."id" = ordered."id"
    `);
    await queryRunner.query(`
      SELECT setval(
        '${sequence}'::regclass,
        CASE WHEN EXISTS (SELECT 1 FROM "archive_events")
          THEN (SELECT MAX("change_sequence") FROM "archive_events")
          ELSE 1
        END,
        EXISTS (SELECT 1 FROM "archive_events")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "archive_events" ALTER COLUMN "change_sequence" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ALTER COLUMN "change_sequence" SET DEFAULT nextval('${sequence}'::regclass)`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ALTER COLUMN "block_event_index" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_archive_events_change_sequence" ON "archive_events" ("change_sequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_archive_events_event_type_change_sequence" ON "archive_events" ("event_type", "change_sequence")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION ${lockTriggerFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        PERFORM pg_advisory_xact_lock(1788447600, 1);
        RETURN NULL;
      END;
      $function$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_archive_events_change_sequence_lock"
      BEFORE INSERT OR UPDATE ON "archive_events"
      FOR EACH STATEMENT
      EXECUTE FUNCTION ${lockTriggerFunction}()
    `);
    await queryRunner.query(`
      CREATE FUNCTION ${assignTriggerFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF TG_OP = 'INSERT' OR ROW(
          NEW."status",
          NEW."pending_seen_at_height",
          NEW."block_height",
          NEW."block_timestamp",
          NEW."event_type",
          NEW."tx_hash",
          NEW."account_update_id",
          NEW."account_update_index",
          NEW."event_index",
          NEW."block_event_index",
          NEW."raw_event_data"
        ) IS DISTINCT FROM ROW(
          OLD."status",
          OLD."pending_seen_at_height",
          OLD."block_height",
          OLD."block_timestamp",
          OLD."event_type",
          OLD."tx_hash",
          OLD."account_update_id",
          OLD."account_update_index",
          OLD."event_index",
          OLD."block_event_index",
          OLD."raw_event_data"
        ) THEN
          NEW."change_sequence" := nextval('${sequence}'::regclass);
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_archive_events_change_sequence"
      BEFORE INSERT OR UPDATE ON "archive_events"
      FOR EACH ROW
      EXECUTE FUNCTION ${assignTriggerFunction}()
    `);

    await queryRunner.query(`
      CREATE TABLE "archive_event_rejections" (
        "id" BIGSERIAL NOT NULL,
        "archive_status" text NOT NULL,
        "block_height" integer,
        "block_event_index" integer,
        "reason_code" text NOT NULL,
        "reason" text NOT NULL,
        "observation_hash" text NOT NULL,
        "raw_observation" jsonb NOT NULL,
        "resolution_status" text NOT NULL DEFAULT 'unresolved',
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "occurrence_count" integer NOT NULL DEFAULT 1,
        "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_archive_event_rejections" PRIMARY KEY ("id"),
        CONSTRAINT "CK_archive_event_rejections_resolution_status" CHECK ("resolution_status" IN ('unresolved', 'resolved'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_archive_event_rejections_observation" ON "archive_event_rejections" ("archive_status", "observation_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_archive_event_rejections_last_seen_at" ON "archive_event_rejections" ("last_seen_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_archive_event_rejections_resolution_status" ON "archive_event_rejections" ("resolution_status")`,
    );
    await queryRunner.query(`
      CREATE TABLE "indexer_runtime_status" (
        "operation_name" text NOT NULL,
        "state" text NOT NULL,
        "last_started_at" TIMESTAMP WITH TIME ZONE,
        "last_succeeded_at" TIMESTAMP WITH TIME ZONE,
        "last_failed_at" TIMESTAMP WITH TIME ZONE,
        "last_error" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_indexer_runtime_status" PRIMARY KEY ("operation_name"),
        CONSTRAINT "CK_indexer_runtime_status_state" CHECK ("state" IN ('idle', 'running', 'succeeded', 'failed'))
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "processor_offsets" ADD "last_seen_change_sequence" bigint`,
    );
    await queryRunner.query(`
      UPDATE "processor_offsets" AS processor_offset
      SET "last_seen_change_sequence" = COALESCE((
        SELECT MAX(event."change_sequence")
        FROM "archive_events" AS event
        WHERE event."updated_at" < processor_offset."last_seen_updated_at"
          OR (
            event."updated_at" = processor_offset."last_seen_updated_at"
            AND event."id" <= processor_offset."last_seen_event_id"
          )
      ), 0)
    `);
    await queryRunner.query(
      `ALTER TABLE "processor_offsets" ALTER COLUMN "last_seen_change_sequence" SET NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "processor_event_failures" (
        "processor_name" text NOT NULL,
        "archive_event_id" bigint NOT NULL,
        "change_sequence" bigint NOT NULL,
        "state" text NOT NULL,
        "attempt_count" integer NOT NULL,
        "retry_after" TIMESTAMP WITH TIME ZONE,
        "error_code" text NOT NULL,
        "bounded_error_message" text NOT NULL,
        "event_snapshot" jsonb NOT NULL,
        "first_failed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_failed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_processor_event_failures" PRIMARY KEY ("processor_name", "archive_event_id", "change_sequence"),
        CONSTRAINT "CK_processor_event_failures_state" CHECK ("state" IN ('retrying', 'blocked', 'resolved', 'superseded')),
        CONSTRAINT "CK_processor_event_failures_attempt_count" CHECK ("attempt_count" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_processor_event_failures_processor_state_failed_at" ON "processor_event_failures" ("processor_name", "state", "last_failed_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE "processor_runtime_status" (
        "processor_name" text NOT NULL,
        "lifecycle_state" text NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "heartbeat_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_success_at" TIMESTAMP WITH TIME ZONE,
        "last_error_at" TIMESTAMP WITH TIME ZONE,
        "last_error_code" text,
        "bounded_last_error" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processor_runtime_status" PRIMARY KEY ("processor_name"),
        CONSTRAINT "CK_processor_runtime_status_lifecycle_state" CHECK ("lifecycle_state" IN ('starting', 'running', 'idle', 'degraded', 'blocked', 'stopping', 'stopped'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "processor_proposal_event_facts" (
        "archive_event_id" text NOT NULL,
        "change_sequence" bigint NOT NULL,
        "event_type" text NOT NULL,
        "proposal_public_key" text NOT NULL,
        "status" text NOT NULL,
        "block_height" integer,
        "block_timestamp" TIMESTAMP WITH TIME ZONE,
        "block_event_index" integer NOT NULL,
        "tx_hash" text NOT NULL,
        "decoded_payload" jsonb NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_processor_proposal_event_facts" PRIMARY KEY ("archive_event_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_processor_proposal_event_facts_proposal_source_order" ON "processor_proposal_event_facts" ("proposal_public_key", "block_height", "block_event_index", "archive_event_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "processor_proposal_contents" (
        "proposal_public_key" text NOT NULL,
        "zkapp_uri_hash" text NOT NULL,
        "contents" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processor_proposal_contents" PRIMARY KEY ("proposal_public_key", "zkapp_uri_hash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_processor_proposal_contents_proposal_public_key" ON "processor_proposal_contents" ("proposal_public_key")`,
    );
    await queryRunner.query(`
      INSERT INTO "processor_proposal_contents" (
        "proposal_public_key",
        "zkapp_uri_hash",
        "contents",
        "created_at",
        "updated_at"
      )
      SELECT
        "proposal_public_key",
        "zkapp_uri_hash",
        "contents",
        "created_at",
        "updated_at"
      FROM "processor_proposals"
      WHERE "contents" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "processor_proposal_projection_replay" (
        "projection_name" text NOT NULL,
        "target_change_sequence" bigint NOT NULL,
        "state" text NOT NULL,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processor_proposal_projection_replay" PRIMARY KEY ("projection_name"),
        CONSTRAINT "CK_processor_proposal_projection_replay_state" CHECK ("state" IN ('collecting', 'complete'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO "processor_proposal_projection_replay" (
        "projection_name",
        "target_change_sequence",
        "state",
        "completed_at"
      )
      SELECT
        'proposal',
        COALESCE(MAX("change_sequence"), 0),
        CASE WHEN COUNT(*) = 0 THEN 'complete' ELSE 'collecting' END,
        CASE WHEN COUNT(*) = 0 THEN now() ELSE NULL END
      FROM "archive_events"
      WHERE "event_type" IN (
        'proposalCreated',
        'proposalExecuted',
        'proposalPauseToggled',
        'proposalVoteDispatched',
        'proposalVotesTallied'
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" ADD "archive_event_id" text`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_processor_vote_tallies_archive_event_id" ON "processor_vote_tallies" ("archive_event_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = await useConfiguredSchema(queryRunner);
    const lockTriggerFunction = `"${schema}"."lock_archive_event_change_sequence"`;
    const assignTriggerFunction = `"${schema}"."assign_archive_event_change_sequence"`;

    await queryRunner.query(
      `DROP INDEX "ux_processor_vote_tallies_archive_event_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" DROP COLUMN "archive_event_id"`,
    );
    await queryRunner.query(
      `DROP TABLE "processor_proposal_projection_replay"`,
    );
    await queryRunner.query(
      `DROP INDEX "ix_processor_proposal_contents_proposal_public_key"`,
    );
    await queryRunner.query(`DROP TABLE "processor_proposal_contents"`);
    await queryRunner.query(
      `DROP INDEX "ix_processor_proposal_event_facts_proposal_source_order"`,
    );
    await queryRunner.query(`DROP TABLE "processor_proposal_event_facts"`);
    await queryRunner.query(`DROP TABLE "processor_runtime_status"`);
    await queryRunner.query(
      `DROP INDEX "ix_processor_event_failures_processor_state_failed_at"`,
    );
    await queryRunner.query(`DROP TABLE "processor_event_failures"`);
    await queryRunner.query(
      `ALTER TABLE "processor_offsets" DROP COLUMN "last_seen_change_sequence"`,
    );
    await queryRunner.query(`DROP TABLE "indexer_runtime_status"`);
    await queryRunner.query(
      `DROP INDEX "ix_archive_event_rejections_resolution_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "ix_archive_event_rejections_last_seen_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "ux_archive_event_rejections_observation"`,
    );
    await queryRunner.query(`DROP TABLE "archive_event_rejections"`);
    await queryRunner.query(
      `DROP TRIGGER "trg_archive_events_change_sequence" ON "archive_events"`,
    );
    await queryRunner.query(`DROP FUNCTION ${assignTriggerFunction}()`);
    await queryRunner.query(
      `DROP TRIGGER "trg_archive_events_change_sequence_lock" ON "archive_events"`,
    );
    await queryRunner.query(`DROP FUNCTION ${lockTriggerFunction}()`);
    await queryRunner.query(
      `DROP INDEX "ix_archive_events_event_type_change_sequence"`,
    );
    await queryRunner.query(`DROP INDEX "ux_archive_events_change_sequence"`);
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "block_event_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "change_sequence"`,
    );
    await queryRunner.query(
      `DROP SEQUENCE "archive_event_change_sequence_seq"`,
    );
  }
}
