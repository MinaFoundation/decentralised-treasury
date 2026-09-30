import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DataSource } from "typeorm";
import { ensureDatabaseSchema } from "../../src/db/ensure-database-schema.js";
import { TransactionEventIdentity1790770000000 } from "../../src/db/migrations/1790770000000-transaction-event-identity.js";

const url = process.env.DATABASE_TEST_URL;
test(
  "deduplicates Archive rebuilds, clears dependent facts, and schedules replay",
  { skip: !url },
  async () => {
    const schema = `identity_${randomUUID().replaceAll("-", "")}`;
    const directory = new URL("../../src/db/migrations/", import.meta.url);
    const migrations = (await readdir(directory))
      .filter((name) => name.endsWith(".ts") && name < "1790770000000")
      .map((name) => fileURLToPath(new URL(name, directory)));
    await ensureDatabaseSchema(url!, schema);
    const source = new DataSource({
      type: "postgres",
      url,
      schema,
      migrations,
      synchronize: false,
    });
    await source.initialize();
    try {
      await source.runMigrations();
      await source.query(`SET search_path TO "${schema}", public`);
      const rows = await source.query(`INSERT INTO archive_events
      (status, block_height, event_type, tx_hash, account_update_id, account_update_index, event_index, block_event_index, raw_event_data)
      VALUES ('pending', 12, 'proposalCreated', 'same-transaction', '1', 0, 0, 0, '{"data":["0","42"]}'),
             ('canonical', 12, 'proposalCreated', 'same-transaction', '1001', 0, 0, 0, '{"data":["0","42"]}') RETURNING id, change_sequence`);
      await source.query(
        `INSERT INTO processor_proposal_event_facts
      (archive_event_id, change_sequence, event_type, proposal_public_key, status, block_event_index, tx_hash, decoded_payload, updated_at)
      VALUES ($1, $2, 'proposalCreated', 'proposal', 'pending', 0, 'same-transaction', '{}', NOW())`,
        [String(rows[0].id), rows[0].change_sequence],
      );
      await source.query(
        `INSERT INTO processor_event_failures
      (processor_name, archive_event_id, change_sequence, state, attempt_count, error_code, bounded_error_message, event_snapshot, last_failed_at)
      VALUES ('proposal-processor', $1, $2, 'blocked', 5, 'OLD', 'old duplicate', '{}', NOW())`,
        [rows[0].id, rows[0].change_sequence],
      );
      await source.query(
        `INSERT INTO processor_offsets (processor_name, last_seen_updated_at, last_seen_event_id, last_seen_change_sequence)
      VALUES ('identity-test', NOW(), $1, $2)`,
        [rows[0].id, rows[0].change_sequence],
      );
      const runner = source.createQueryRunner();
      await runner.startTransaction();
      try {
        await new TransactionEventIdentity1790770000000().up(runner);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
      const remaining = await source.query(
        `SELECT id, status FROM archive_events WHERE tx_hash = 'same-transaction'`,
      );
      assert.deepEqual(remaining, [{ id: rows[1].id, status: "canonical" }]);
      assert.equal(
        (
          await source.query(
            `SELECT COUNT(*) FROM processor_proposal_event_facts`,
          )
        )[0].count,
        "0",
      );
      assert.equal(
        (await source.query(`SELECT state FROM processor_event_failures`))[0]
          .state,
        "superseded",
      );
      assert.equal(
        (
          await source.query(
            `SELECT last_seen_change_sequence FROM processor_offsets WHERE processor_name = 'identity-test'`,
          )
        )[0].last_seen_change_sequence,
        "0",
      );
      assert.equal(
        (
          await source.query(
            `SELECT state FROM processor_proposal_projection_replay WHERE projection_name = 'proposal'`,
          )
        )[0].state,
        "collecting",
      );
      await assert.rejects(
        source.query(`INSERT INTO archive_events
      (status, event_type, tx_hash, account_update_id, account_update_index, event_index, block_event_index, raw_event_data)
      VALUES ('canonical', 'proposalCreated', 'same-transaction', '2001', 0, 0, 0, '{"data":["0","42"]}')`),
        /duplicate key/,
      );
    } finally {
      await source.query(`DROP SCHEMA "${schema}" CASCADE`);
      await source.destroy();
    }
  },
);

for (const scenario of [
  {
    name: "fresh empty database",
    proposalEvent: false,
    unrelatedEvent: false,
    legacyProposal: false,
  },
  {
    name: "unrelated events only",
    proposalEvent: false,
    unrelatedEvent: true,
    legacyProposal: false,
  },
  {
    name: "legacy proposal without Archive facts",
    proposalEvent: false,
    unrelatedEvent: false,
    legacyProposal: true,
  },
  {
    name: "proposal event followed by an unrelated event",
    proposalEvent: true,
    unrelatedEvent: true,
    legacyProposal: false,
  },
]) {
  test(
    `identity migration sets a reachable replay target for ${scenario.name}`,
    { skip: !url },
    async () => {
      const schema = `identity_${randomUUID().replaceAll("-", "")}`;
      const directory = new URL("../../src/db/migrations/", import.meta.url);
      const migrations = (await readdir(directory))
        .filter((name) => name.endsWith(".ts") && name < "1790770000000")
        .map((name) => fileURLToPath(new URL(name, directory)));
      await ensureDatabaseSchema(url!, schema);
      const source = new DataSource({
        type: "postgres",
        url,
        schema,
        migrations,
        synchronize: false,
      });
      await source.initialize();
      try {
        await source.runMigrations();
        await source.query(`SET search_path TO "${schema}", public`);
        let target = "0";
        for (const eventType of [
          ...(scenario.proposalEvent ? ["proposalCreated"] : []),
          ...(scenario.unrelatedEvent ? ["unrelatedEvent"] : []),
        ]) {
          const [event] = await source.query(
            `INSERT INTO archive_events
          (status, event_type, tx_hash, account_update_id, account_update_index, event_index, block_event_index, raw_event_data)
          VALUES ('canonical', $1, $1, '1', 0, 0, 0, '{"data":[]}') RETURNING change_sequence`,
            [eventType],
          );
          if (eventType === "proposalCreated")
            target = String(event.change_sequence);
        }
        if (scenario.legacyProposal) {
          await source.query(`INSERT INTO processor_proposals
          (proposal_public_key, lifecycle_id, amount, recipient, zkapp_uri_hash, status)
          VALUES ('legacy', 0, '1000', 'recipient', 'uri', 'canonical')`);
        }
        const runner = source.createQueryRunner();
        await runner.startTransaction();
        try {
          await new TransactionEventIdentity1790770000000().up(runner);
          await runner.commitTransaction();
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        } finally {
          await runner.release();
        }
        const [replay] =
          await source.query(`SELECT target_change_sequence, state, completed_at
        FROM processor_proposal_projection_replay WHERE projection_name = 'proposal'`);
        const needsReplay = scenario.proposalEvent || scenario.legacyProposal;
        assert.equal(String(replay.target_change_sequence), target);
        assert.equal(replay.state, needsReplay ? "collecting" : "complete");
        if (needsReplay) assert.equal(replay.completed_at, null);
        else assert.ok(replay.completed_at instanceof Date);
      } finally {
        await source.query(`DROP SCHEMA "${schema}" CASCADE`);
        await source.destroy();
      }
    },
  );
}
