import { MigrationInterface, QueryRunner } from "typeorm";

export class InitializeProcessorSchema1775649313440 implements MigrationInterface {
    name = 'InitializeProcessorSchema1775649313440'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "archive_events" ("id" BIGSERIAL NOT NULL, "status" text NOT NULL, "pending_seen_at_height" integer, "block_height" integer, "block_timestamp" TIMESTAMP WITH TIME ZONE, "event_type" text NOT NULL, "tx_hash" text NOT NULL, "account_update_id" text NOT NULL, "account_update_index" integer NOT NULL, "event_index" integer NOT NULL, "raw_event_data" jsonb NOT NULL, "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c052ebf7ed0b83789c683b0f410" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_archive_events_status_pending_seen_at_height" ON "archive_events" ("status", "pending_seen_at_height") `);
        await queryRunner.query(`CREATE INDEX "ix_archive_events_event_type_updated_at_id" ON "archive_events" ("event_type", "updated_at", "id") `);
        await queryRunner.query(`CREATE INDEX "ix_archive_events_updated_at_id" ON "archive_events" ("updated_at", "id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_archive_events_identity" ON "archive_events" ("tx_hash", "account_update_id", "account_update_index", "event_index") `);
        await queryRunner.query(`CREATE TABLE "indexer_cursors" ("cursor_name" text NOT NULL, "last_processed_block_height" integer NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_031ee8bf7a17089e5ea1c6a6f77" PRIMARY KEY ("cursor_name"))`);
        await queryRunner.query(`CREATE TABLE "processor_offsets" ("processor_name" text NOT NULL, "last_seen_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen_event_id" bigint NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_23824b269b932b6aac78d6ca7b5" PRIMARY KEY ("processor_name"))`);
        await queryRunner.query(`CREATE TABLE "processor_votes" ("id" BIGSERIAL NOT NULL, "archive_event_id" text NOT NULL, "proposal_public_key" text NOT NULL, "voter_public_key" text NOT NULL, "vote" text NOT NULL, "vote_weight" text NOT NULL, "block_height" integer, "is_nullified" boolean NOT NULL DEFAULT false, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5d06e53c7f36a6dfaef228eaeba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_votes_archive_event_id" ON "processor_votes" ("archive_event_id") `);
        await queryRunner.query(`CREATE INDEX "ix_processor_votes_proposal_public_key_voter_public_key" ON "processor_votes" ("proposal_public_key", "voter_public_key") `);
        await queryRunner.query(`CREATE INDEX "ix_processor_votes_proposal_public_key" ON "processor_votes" ("proposal_public_key") `);
        await queryRunner.query(`CREATE TABLE "processor_vote_nullifiers" ("id" BIGSERIAL NOT NULL, "source_event_id" text NOT NULL, "proposal_public_key" text NOT NULL, "voter_public_key" text NOT NULL, "vote" text NOT NULL, "vote_weight" text NOT NULL, "block_height" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c5e5b5a070b7fbe90f41bbc3365" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_vote_nullifiers_source_event_id" ON "processor_vote_nullifiers" ("source_event_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_vote_nullifiers_proposal_public_key_voter_public_key" ON "processor_vote_nullifiers" ("proposal_public_key", "voter_public_key") `);
        await queryRunner.query(`CREATE INDEX "ix_processor_vote_nullifiers_proposal_public_key" ON "processor_vote_nullifiers" ("proposal_public_key") `);
        await queryRunner.query(`CREATE TABLE "processor_vote_tallies" ("id" BIGSERIAL NOT NULL, "proposal_public_key" text NOT NULL, "block_height" integer NOT NULL, "yay_weight" text NOT NULL DEFAULT '0', "nay_weight" text NOT NULL DEFAULT '0', "abstain_weight" text NOT NULL DEFAULT '0', "required_participation_bp" text, "required_approval_bp" text, "required_participation" text, "total_participating_votes" text, "approval_bp" text, "vote_result" text, "created_by_event_type" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c748d6f0ef9b1d286bbafbb65c5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_processor_vote_tallies_proposal_public_key" ON "processor_vote_tallies" ("proposal_public_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_vote_tallies_proposal_public_key_block_height" ON "processor_vote_tallies" ("proposal_public_key", "block_height") `);
        await queryRunner.query(`CREATE TABLE "processor_proposals" ("id" BIGSERIAL NOT NULL, "proposal_public_key" text NOT NULL, "lifecycle_id" integer NOT NULL, "amount" text NOT NULL, "recipient" text NOT NULL, "sender_public_key" text, "zkapp_uri_hash" text NOT NULL, "staking_epoch_data_ledger_hash" text, "staking_epoch_data_ledger_total_currency" text, "required_participation_bp" text, "required_approval_bp" text, "required_participation" text, "status" text NOT NULL, "is_paused" boolean NOT NULL DEFAULT false, "paid_out_amount" text NOT NULL DEFAULT '0', "contents" text, "created_at_block_height" integer, "created_at_block_timestamp" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1a514439cffb95ee60395206838" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_proposals_proposal_public_key" ON "processor_proposals" ("proposal_public_key") `);
        await queryRunner.query(`CREATE TABLE "processor_proposal_executions" ("id" BIGSERIAL NOT NULL, "archive_event_id" text NOT NULL, "proposal_public_key" text NOT NULL, "lifecycle_id" integer NOT NULL, "recipient" text NOT NULL, "amount_to_pay_out" text NOT NULL, "proposal_amount" text NOT NULL, "bond_amount" text NOT NULL, "sender_public_key" text NOT NULL, "paid_out_amount" text NOT NULL, "remaining_amount" text NOT NULL, "block_height" integer, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6ebc39aee44a809280e9bf11f53" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_processor_proposal_executions_proposal_public_key" ON "processor_proposal_executions" ("proposal_public_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_processor_proposal_executions_archive_event_id" ON "processor_proposal_executions" ("archive_event_id") `);
        await queryRunner.query(`ALTER TABLE "processor_votes" ADD CONSTRAINT "FK_0bf5749986940532a641e3fc0e4" FOREIGN KEY ("proposal_public_key") REFERENCES "processor_proposals"("proposal_public_key") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "processor_votes" ADD CONSTRAINT "FK_b9163cc2e20ab4a8e7b6b4c16d4" FOREIGN KEY ("proposal_public_key", "block_height") REFERENCES "processor_vote_tallies"("proposal_public_key","block_height") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "processor_vote_nullifiers" ADD CONSTRAINT "FK_0aaf836a18700129861abdf43a9" FOREIGN KEY ("proposal_public_key") REFERENCES "processor_proposals"("proposal_public_key") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "processor_vote_nullifiers" ADD CONSTRAINT "FK_5c3d3f889b02eb89aa1494d40f5" FOREIGN KEY ("proposal_public_key", "block_height") REFERENCES "processor_vote_tallies"("proposal_public_key","block_height") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "processor_vote_tallies" ADD CONSTRAINT "FK_dcbe72772914877cbf5f9104582" FOREIGN KEY ("proposal_public_key") REFERENCES "processor_proposals"("proposal_public_key") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "processor_proposal_executions" ADD CONSTRAINT "FK_e0da46fd6fd4c5df50667d64350" FOREIGN KEY ("proposal_public_key") REFERENCES "processor_proposals"("proposal_public_key") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "processor_proposal_executions" DROP CONSTRAINT "FK_e0da46fd6fd4c5df50667d64350"`);
        await queryRunner.query(`ALTER TABLE "processor_vote_tallies" DROP CONSTRAINT "FK_dcbe72772914877cbf5f9104582"`);
        await queryRunner.query(`ALTER TABLE "processor_vote_nullifiers" DROP CONSTRAINT "FK_5c3d3f889b02eb89aa1494d40f5"`);
        await queryRunner.query(`ALTER TABLE "processor_vote_nullifiers" DROP CONSTRAINT "FK_0aaf836a18700129861abdf43a9"`);
        await queryRunner.query(`ALTER TABLE "processor_votes" DROP CONSTRAINT "FK_b9163cc2e20ab4a8e7b6b4c16d4"`);
        await queryRunner.query(`ALTER TABLE "processor_votes" DROP CONSTRAINT "FK_0bf5749986940532a641e3fc0e4"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_proposal_executions_archive_event_id"`);
        await queryRunner.query(`DROP INDEX "public"."ix_processor_proposal_executions_proposal_public_key"`);
        await queryRunner.query(`DROP TABLE "processor_proposal_executions"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_proposals_proposal_public_key"`);
        await queryRunner.query(`DROP TABLE "processor_proposals"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_vote_tallies_proposal_public_key_block_height"`);
        await queryRunner.query(`DROP INDEX "public"."ix_processor_vote_tallies_proposal_public_key"`);
        await queryRunner.query(`DROP TABLE "processor_vote_tallies"`);
        await queryRunner.query(`DROP INDEX "public"."ix_processor_vote_nullifiers_proposal_public_key"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_vote_nullifiers_proposal_public_key_voter_public_key"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_vote_nullifiers_source_event_id"`);
        await queryRunner.query(`DROP TABLE "processor_vote_nullifiers"`);
        await queryRunner.query(`DROP INDEX "public"."ix_processor_votes_proposal_public_key"`);
        await queryRunner.query(`DROP INDEX "public"."ix_processor_votes_proposal_public_key_voter_public_key"`);
        await queryRunner.query(`DROP INDEX "public"."ux_processor_votes_archive_event_id"`);
        await queryRunner.query(`DROP TABLE "processor_votes"`);
        await queryRunner.query(`DROP TABLE "processor_offsets"`);
        await queryRunner.query(`DROP TABLE "indexer_cursors"`);
        await queryRunner.query(`DROP INDEX "public"."ux_archive_events_identity"`);
        await queryRunner.query(`DROP INDEX "public"."ix_archive_events_updated_at_id"`);
        await queryRunner.query(`DROP INDEX "public"."ix_archive_events_event_type_updated_at_id"`);
        await queryRunner.query(`DROP INDEX "public"."ix_archive_events_status_pending_seen_at_height"`);
        await queryRunner.query(`DROP TABLE "archive_events"`);
    }

}
