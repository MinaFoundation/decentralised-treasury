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

function changeSequenceTriggerBody(
  sequence: string,
  includeBlockIdentity: boolean,
): string {
  const blockIdentityFields = includeBlockIdentity
    ? `,
          NEW."global_slot_since_genesis",
          NEW."state_hash",
          NEW."parent_hash",
          NEW."chain_status"`
    : "";
  const oldBlockIdentityFields = includeBlockIdentity
    ? `,
          OLD."global_slot_since_genesis",
          OLD."state_hash",
          OLD."parent_hash",
          OLD."chain_status"`
    : "";

  return `
    BEGIN
      IF TG_OP = 'INSERT' OR ROW(
        NEW."status",
        NEW."pending_seen_at_height",
        NEW."block_height",
        NEW."block_timestamp"${blockIdentityFields},
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
        OLD."block_timestamp"${oldBlockIdentityFields},
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
  `;
}

export class ProposalContractProjection1788451200000 implements MigrationInterface {
  public readonly name = "ProposalContractProjection1788451200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = await useConfiguredSchema(queryRunner);
    const sequence = `"${schema}"."archive_event_change_sequence_seq"`;
    const assignTriggerFunction = `"${schema}"."assign_archive_event_change_sequence"`;

    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ALTER COLUMN "lifecycle_id" TYPE bigint USING "lifecycle_id"::bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD CONSTRAINT "CK_processor_proposals_lifecycle_id_uint32" CHECK ("lifecycle_id" BETWEEN 0 AND 4294967295)`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" ALTER COLUMN "lifecycle_id" TYPE bigint USING "lifecycle_id"::bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" ADD CONSTRAINT "CK_processor_proposal_executions_lifecycle_id_uint32" CHECK ("lifecycle_id" BETWEEN 0 AND 4294967295)`,
    );

    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "global_slot_since_genesis" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD CONSTRAINT "CK_archive_events_global_slot_since_genesis_uint32" CHECK ("global_slot_since_genesis" IS NULL OR "global_slot_since_genesis" BETWEEN 0 AND 4294967295)`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "state_hash" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "parent_hash" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ADD "chain_status" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_archive_events_state_hash" ON "archive_events" ("state_hash")`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${assignTriggerFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      ${changeSequenceTriggerBody(sequence, true)}
      $function$
    `);

    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" ADD "global_slot_since_genesis" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" ADD CONSTRAINT "CK_processor_proposal_facts_global_slot_uint32" CHECK ("global_slot_since_genesis" IS NULL OR "global_slot_since_genesis" BETWEEN 0 AND 4294967295)`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" ADD "state_hash" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" ADD "parent_hash" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" ADD "chain_status" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_processor_proposal_event_facts_state_hash" ON "processor_proposal_event_facts" ("state_hash")`,
    );

    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD "contract_status" text NOT NULL DEFAULT 'unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD "contract_status_finality" text NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD "contract_status_source_event_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD "contract_status_block_height" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD "creation_observation_status" text NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(`
      UPDATE "processor_proposals"
      SET
        "creation_observation_status" = "status",
        "contract_status" = 'unknown',
        "contract_status_finality" = 'pending',
        "contract_status_source_event_id" = NULL,
        "contract_status_block_height" = NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD CONSTRAINT "CK_processor_proposals_contract_status" CHECK ("contract_status" IN ('unknown', 'approved', 'rejected', 'paused'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD CONSTRAINT "CK_processor_proposals_contract_status_finality" CHECK ("contract_status_finality" IN ('pending', 'canonical'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ADD CONSTRAINT "CK_processor_proposals_creation_observation_status" CHECK ("creation_observation_status" IN ('pending', 'canonical', 'orphaned'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" ADD "source_status" text NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" ADD "block_event_index" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_votes" ADD "block_event_index" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" ADD "block_event_index" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" ADD CONSTRAINT "CK_processor_vote_tallies_source_status" CHECK ("source_status" IN ('pending', 'canonical', 'orphaned'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_votes" DROP CONSTRAINT "FK_b9163cc2e20ab4a8e7b6b4c16d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_nullifiers" DROP CONSTRAINT "FK_5c3d3f889b02eb89aa1494d40f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "ux_processor_vote_tallies_proposal_public_key_block_height"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_processor_vote_tallies_running_proposal_block_height" ON "processor_vote_tallies" ("proposal_public_key", "block_height") WHERE "created_by_event_type" = 'proposalVoteDispatched'`,
    );

    // The new status and tally provenance fields cannot be inferred from the
    // old projection rows. Force the proposal replay to reconstruct them from
    // the current Archive facts before readiness can become healthy.
    await queryRunner.query(`
      UPDATE "processor_proposal_projection_replay"
      SET
        "target_change_sequence" = source."target_change_sequence",
        "state" = CASE
          WHEN source."event_count" = 0 AND source."projection_count" = 0
            THEN 'complete'
          ELSE 'collecting'
        END,
        "completed_at" = CASE
          WHEN source."event_count" = 0 AND source."projection_count" = 0
            THEN now()
          ELSE NULL
        END,
        "updated_at" = now()
      FROM (
        SELECT
          COALESCE(MAX("change_sequence"), 0) AS "target_change_sequence",
          COUNT(*) AS "event_count",
          (SELECT COUNT(*) FROM "processor_proposals") AS "projection_count"
        FROM "archive_events"
        WHERE "event_type" IN (
          'proposalCreated',
          'proposalExecuted',
          'proposalPauseToggled',
          'proposalVoteDispatched',
          'proposalVotesTallied'
        )
      ) AS source
      WHERE "projection_name" = 'proposal'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = await useConfiguredSchema(queryRunner);
    const sequence = `"${schema}"."archive_event_change_sequence_seq"`;
    const assignTriggerFunction = `"${schema}"."assign_archive_event_change_sequence"`;

    await queryRunner.query(
      `DROP INDEX "ux_processor_vote_tallies_running_proposal_block_height"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_processor_vote_tallies_proposal_public_key_block_height" ON "processor_vote_tallies" ("proposal_public_key", "block_height")`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_votes" ADD CONSTRAINT "FK_b9163cc2e20ab4a8e7b6b4c16d4" FOREIGN KEY ("proposal_public_key", "block_height") REFERENCES "processor_vote_tallies"("proposal_public_key","block_height") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_nullifiers" ADD CONSTRAINT "FK_5c3d3f889b02eb89aa1494d40f5" FOREIGN KEY ("proposal_public_key", "block_height") REFERENCES "processor_vote_tallies"("proposal_public_key","block_height") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" DROP CONSTRAINT "CK_processor_vote_tallies_source_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" DROP COLUMN "block_event_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" DROP COLUMN "block_event_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_votes" DROP COLUMN "block_event_index"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_vote_tallies" DROP COLUMN "source_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP CONSTRAINT "CK_processor_proposals_creation_observation_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP CONSTRAINT "CK_processor_proposals_contract_status_finality"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP CONSTRAINT "CK_processor_proposals_contract_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP COLUMN "creation_observation_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP COLUMN "contract_status_block_height"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP COLUMN "contract_status_source_event_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP COLUMN "contract_status_finality"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP COLUMN "contract_status"`,
    );

    await queryRunner.query(
      `DROP INDEX "ix_processor_proposal_event_facts_state_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" DROP COLUMN "chain_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" DROP COLUMN "parent_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" DROP COLUMN "state_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_event_facts" DROP COLUMN "global_slot_since_genesis"`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${assignTriggerFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      ${changeSequenceTriggerBody(sequence, false)}
      $function$
    `);

    await queryRunner.query(`DROP INDEX "ix_archive_events_state_hash"`);
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "chain_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "parent_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "state_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" DROP COLUMN "global_slot_since_genesis"`,
    );

    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" DROP CONSTRAINT "CK_processor_proposal_executions_lifecycle_id_uint32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposal_executions" ALTER COLUMN "lifecycle_id" TYPE integer USING "lifecycle_id"::integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" DROP CONSTRAINT "CK_processor_proposals_lifecycle_id_uint32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_proposals" ALTER COLUMN "lifecycle_id" TYPE integer USING "lifecycle_id"::integer`,
    );
  }
}
