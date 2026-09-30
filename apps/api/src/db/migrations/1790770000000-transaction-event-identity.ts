import type { MigrationInterface, QueryRunner } from "typeorm";
import {
  qualifyTableName,
  resolveDatabaseSchema,
} from "../../database-schema.js";

export class TransactionEventIdentity1790770000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = resolveDatabaseSchema(queryRunner.connection);
    const table = (name: string) => qualifyTableName(schema, name);
    const events = table("archive_events");
    await queryRunner.query(`LOCK TABLE ${events} IN ACCESS EXCLUSIVE MODE`);
    // Refuse to choose between conflicting immutable payloads.
    const conflicts = await queryRunner.query(`SELECT 1 FROM ${events}
      GROUP BY tx_hash, account_update_index, event_index
      HAVING COUNT(DISTINCT ROW(event_type, raw_event_data -> 'data')) > 1 LIMIT 1`);
    if (conflicts.length)
      throw new Error(
        "Conflicting transaction-relative event payloads require operator review",
      );
    await queryRunner.query(`CREATE TEMP TABLE treasury_event_duplicates ON COMMIT DROP AS
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY tx_hash, account_update_index, event_index
          ORDER BY CASE status WHEN 'canonical' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
            change_sequence DESC, id ASC
        ) AS rank FROM ${events}
      ) ranked WHERE rank > 1`);
    // Historical failure snapshots remain available, but no longer gate replay.
    await queryRunner.query(`UPDATE ${table("processor_event_failures")}
      SET state = 'superseded', retry_after = NULL, resolved_at = NOW()
      WHERE archive_event_id IN (SELECT id FROM treasury_event_duplicates)`);
    await queryRunner.query(
      `DELETE FROM ${events} WHERE id IN (SELECT id FROM treasury_event_duplicates)`,
    );
    await queryRunner.query(
      `DROP INDEX ${table("ux_archive_events_identity")}`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX ux_archive_events_identity ON ${events}
      (tx_hash, account_update_index, event_index)`);
    // Previous pending observations did not establish a single branch.
    await queryRunner.query(
      `UPDATE ${events} SET status = 'orphaned', updated_at = NOW() WHERE status = 'pending'`,
    );
    for (const name of [
      "processor_votes",
      "processor_vote_nullifiers",
      "processor_proposal_executions",
      "processor_vote_tallies",
      "processor_proposal_event_facts",
    ]) {
      await queryRunner.query(`DELETE FROM ${table(name)}`);
    }
    await queryRunner.query(
      `UPDATE ${table("processor_offsets")} SET last_seen_change_sequence = 0`,
    );
    // An empty projection needs no event to finish replay. Unrelated events
    // cannot supply a target that proposal handlers will never reach.
    await queryRunner.query(`UPDATE ${table("processor_proposal_projection_replay")}
      SET target_change_sequence = source.target_change_sequence,
        state = CASE WHEN source.event_count = 0 AND source.projection_count = 0
          THEN 'complete' ELSE 'collecting' END,
        completed_at = CASE WHEN source.event_count = 0 AND source.projection_count = 0
          THEN NOW() ELSE NULL END,
        updated_at = NOW()
      FROM (
        SELECT COALESCE(MAX(change_sequence), 0) AS target_change_sequence,
          COUNT(*) AS event_count,
          (SELECT COUNT(*) FROM ${table("processor_proposals")}) AS projection_count
        FROM ${events}
        WHERE event_type IN (
          'proposalCreated', 'proposalExecuted', 'proposalPauseToggled',
          'proposalVoteDispatched', 'proposalVotesTallied'
        )
      ) AS source
      WHERE projection_name = 'proposal'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = resolveDatabaseSchema(queryRunner.connection);
    await queryRunner.query(
      `DROP INDEX ${qualifyTableName(schema, "ux_archive_events_identity")}`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX ux_archive_events_identity ON ${qualifyTableName(schema, "archive_events")}
      (tx_hash, account_update_id, account_update_index, event_index)`);
    // Deduplicated observations and rebuilt projections are not restored.
  }
}
