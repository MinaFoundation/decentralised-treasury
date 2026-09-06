import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DataSource, type MigrationInterface } from "typeorm";
import { ensureDatabaseSchema } from "../../src/db/ensure-database-schema.js";
import { ConfigureProcessorSchema1775649313439 } from "../../src/db/migrations/1775649313439-configure-processor-schema.js";
import { InitializeProcessorSchema1775649313440 } from "../../src/db/migrations/1775649313440-initialize-processor-schema.js";
import { BackendPipelineHardening1788447600000 } from "../../src/db/migrations/1788447600000-backend-pipeline-hardening.js";
import { ProposalContractProjection1788451200000 } from "../../src/db/migrations/1788451200000-proposal-contract-projection.js";
import { rewindProposalProjectionReplay } from "../../src/processors/proposals/proposal-projection-replay-entity.js";

const databaseTestUrl = process.env.DATABASE_TEST_URL;

function migrationDataSource(
  databaseUrl: string,
  schema: string,
  migrations: Array<new () => MigrationInterface>,
): DataSource {
  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    schema,
    synchronize: false,
    migrations,
    migrationsTableName: "typeorm_migrations",
  });
}

test(
  "PostgreSQL migrations upgrade a legacy schema and preserve cursor order",
  { skip: databaseTestUrl ? false : "DATABASE_TEST_URL is not set" },
  async () => {
    const schema = `backend_test_${randomUUID().replaceAll("-", "")}`;
    const migrationProcessorName = `migration-processor-${randomUUID()}`;
    const runtimeProcessorName = `runtime-processor-${randomUUID()}`;
    const previousProcessorName = process.env.PROCESSOR_NAME;
    process.env.PROCESSOR_NAME = migrationProcessorName;
    const admin = new DataSource({ type: "postgres", url: databaseTestUrl });
    let legacyDataSource: DataSource | null = null;
    let upgradedDataSource: DataSource | null = null;

    try {
      await admin.initialize();
      const schemaBeforeBootstrap = (await admin.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schema],
      )) as unknown[];
      assert.equal(schemaBeforeBootstrap.length, 0);
      await ensureDatabaseSchema(databaseTestUrl!, schema);

      const schemaAfterBootstrap = (await admin.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schema],
      )) as unknown[];
      assert.equal(schemaAfterBootstrap.length, 1);

      legacyDataSource = migrationDataSource(databaseTestUrl!, schema, [
        ConfigureProcessorSchema1775649313439,
        InitializeProcessorSchema1775649313440,
      ]);
      await legacyDataSource.initialize();
      await legacyDataSource.runMigrations();

      const [legacyEvent] = (await legacyDataSource.query(`
        INSERT INTO "${schema}"."archive_events" (
          "status",
          "pending_seen_at_height",
          "block_height",
          "block_timestamp",
          "event_type",
          "tx_hash",
          "account_update_id",
          "account_update_index",
          "event_index",
          "raw_event_data",
          "updated_at"
        ) VALUES (
          'canonical',
          NULL,
          42,
          '2026-09-03T00:00:00.000001Z',
          'proposalCreated',
          'legacy-transaction',
          '1',
          0,
          0,
          '{"data":["0"]}'::jsonb,
          '2026-09-03T00:00:00.000001Z'
        )
        RETURNING "id"
      `)) as Array<{ id: string }>;
      assert.ok(legacyEvent);
      const legacyProposalPublicKey = `legacy-proposal-${randomUUID()}`;
      const legacyZkAppUriHash = "legacy-zkapp-uri-hash";
      const legacyContents = "# Legacy proposal content";
      await legacyDataSource.query(
        `
          INSERT INTO "${schema}"."processor_proposals" (
            "proposal_public_key",
            "lifecycle_id",
            "amount",
            "recipient",
            "zkapp_uri_hash",
            "status",
            "contents"
          ) VALUES ($1, 2, '1000', 'legacy-recipient', $2, 'canonical', $3)
        `,
        [legacyProposalPublicKey, legacyZkAppUriHash, legacyContents],
      );
      await legacyDataSource.query(
        `
          INSERT INTO "${schema}"."processor_offsets" (
            "processor_name",
            "last_seen_updated_at",
            "last_seen_event_id"
          ) VALUES
            ($1, '2026-09-03T00:00:00.000001Z', $2),
            ($3, '2026-09-03T00:00:00.000001Z', $2),
            ('unrelated-processor', '2026-09-03T00:00:00.000001Z', $2)
        `,
        [migrationProcessorName, legacyEvent.id, runtimeProcessorName],
      );
      await legacyDataSource.destroy();
      legacyDataSource = null;

      upgradedDataSource = migrationDataSource(databaseTestUrl!, schema, [
        ConfigureProcessorSchema1775649313439,
        InitializeProcessorSchema1775649313440,
        BackendPipelineHardening1788447600000,
        ProposalContractProjection1788451200000,
      ]);
      await upgradedDataSource.initialize();
      const applied = await upgradedDataSource.runMigrations();
      assert.deepEqual(
        applied.map((migration) => migration.name),
        [
          "BackendPipelineHardening1788447600000",
          "ProposalContractProjection1788451200000",
        ],
      );

      const projectionColumns = (await upgradedDataSource.query(
        `SELECT "table_name", "column_name", "is_nullable"
         FROM information_schema.columns
         WHERE "table_schema" = $1
           AND (
             ("table_name" = 'processor_proposals' AND "column_name" = 'contract_status')
             OR
            ("table_name" = 'processor_proposal_executions' AND "column_name" IN ('block_event_index', 'paid_out_amount', 'remaining_amount'))
            OR
            ("table_name" = 'processor_votes' AND "column_name" IN ('block_event_index', 'is_nullified', 'vote_weight'))
             OR
             ("table_name" = 'processor_vote_nullifiers' AND "column_name" IN ('block_height', 'source_event_id', 'vote_weight'))
           )
         ORDER BY "table_name", "column_name"`,
        [schema],
      )) as Array<{
        table_name: string;
        column_name: string;
        is_nullable: string;
      }>;
      assert.deepEqual(projectionColumns, [
        {
          table_name: "processor_proposal_executions",
          column_name: "block_event_index",
          is_nullable: "NO",
        },
        {
          table_name: "processor_proposal_executions",
          column_name: "paid_out_amount",
          is_nullable: "NO",
        },
        {
          table_name: "processor_proposal_executions",
          column_name: "remaining_amount",
          is_nullable: "NO",
        },
        {
          table_name: "processor_proposals",
          column_name: "contract_status",
          is_nullable: "NO",
        },
        {
          table_name: "processor_vote_nullifiers",
          column_name: "block_height",
          is_nullable: "NO",
        },
        {
          table_name: "processor_vote_nullifiers",
          column_name: "source_event_id",
          is_nullable: "NO",
        },
        {
          table_name: "processor_vote_nullifiers",
          column_name: "vote_weight",
          is_nullable: "NO",
        },
        {
          table_name: "processor_votes",
          column_name: "block_event_index",
          is_nullable: "NO",
        },
        {
          table_name: "processor_votes",
          column_name: "is_nullified",
          is_nullable: "NO",
        },
        {
          table_name: "processor_votes",
          column_name: "vote_weight",
          is_nullable: "NO",
        },
      ]);

      const [backfilledEvent] = (await upgradedDataSource.query(
        `SELECT "change_sequence", "block_event_index", "state_hash" FROM "${schema}"."archive_events" WHERE "id" = $1`,
        [legacyEvent.id],
      )) as Array<{
        change_sequence: string;
        block_event_index: number;
        state_hash: string | null;
      }>;
      assert.deepEqual(backfilledEvent, {
        change_sequence: "1",
        block_event_index: 0,
        state_hash: null,
      });

      const [backfilledProposal] = (await upgradedDataSource.query(
        `SELECT "creation_observation_status", "contract_status", "contract_status_finality"
         FROM "${schema}"."processor_proposals"
         WHERE "proposal_public_key" = $1`,
        [legacyProposalPublicKey],
      )) as Array<{
        creation_observation_status: string;
        contract_status: string;
        contract_status_finality: string;
      }>;
      assert.deepEqual(backfilledProposal, {
        creation_observation_status: "canonical",
        contract_status: "unknown",
        contract_status_finality: "pending",
      });

      const [migrationOffset] = (await upgradedDataSource.query(
        `SELECT "last_seen_change_sequence" FROM "${schema}"."processor_offsets" WHERE "processor_name" = $1`,
        [migrationProcessorName],
      )) as Array<{ last_seen_change_sequence: string }>;
      assert.equal(migrationOffset.last_seen_change_sequence, "1");

      const [runtimeOffsetBeforeStartup] = (await upgradedDataSource.query(
        `SELECT "last_seen_change_sequence" FROM "${schema}"."processor_offsets" WHERE "processor_name" = $1`,
        [runtimeProcessorName],
      )) as Array<{ last_seen_change_sequence: string }>;
      assert.equal(runtimeOffsetBeforeStartup.last_seen_change_sequence, "1");

      await upgradedDataSource.transaction(async (manager) => {
        await rewindProposalProjectionReplay(manager, runtimeProcessorName);
      });

      const [runtimeOffsetAfterStartup] = (await upgradedDataSource.query(
        `SELECT "last_seen_change_sequence" FROM "${schema}"."processor_offsets" WHERE "processor_name" = $1`,
        [runtimeProcessorName],
      )) as Array<{ last_seen_change_sequence: string }>;
      assert.equal(runtimeOffsetAfterStartup.last_seen_change_sequence, "0");

      const [migrationOffsetAfterStartup] = (await upgradedDataSource.query(
        `SELECT "last_seen_change_sequence" FROM "${schema}"."processor_offsets" WHERE "processor_name" = $1`,
        [migrationProcessorName],
      )) as Array<{ last_seen_change_sequence: string }>;
      assert.equal(migrationOffsetAfterStartup.last_seen_change_sequence, "1");

      const [unrelatedOffset] = (await upgradedDataSource.query(
        `SELECT "last_seen_change_sequence" FROM "${schema}"."processor_offsets" WHERE "processor_name" = 'unrelated-processor'`,
      )) as Array<{ last_seen_change_sequence: string }>;
      assert.equal(unrelatedOffset.last_seen_change_sequence, "1");

      const [replayState] = (await upgradedDataSource.query(
        `SELECT "target_change_sequence", "state", "completed_at" FROM "${schema}"."processor_proposal_projection_replay" WHERE "projection_name" = 'proposal'`,
      )) as Array<{
        target_change_sequence: string;
        state: string;
        completed_at: Date | null;
      }>;
      assert.deepEqual(replayState, {
        target_change_sequence: "1",
        state: "collecting",
        completed_at: null,
      });

      const [backfilledContent] = (await upgradedDataSource.query(
        `SELECT "proposal_public_key", "zkapp_uri_hash", "contents"
         FROM "${schema}"."processor_proposal_contents"
         WHERE "proposal_public_key" = $1 AND "zkapp_uri_hash" = $2`,
        [legacyProposalPublicKey, legacyZkAppUriHash],
      )) as Array<{
        proposal_public_key: string;
        zkapp_uri_hash: string;
        contents: string;
      }>;
      assert.deepEqual(backfilledContent, {
        proposal_public_key: legacyProposalPublicKey,
        zkapp_uri_hash: legacyZkAppUriHash,
        contents: legacyContents,
      });

      const [inserted] = (await upgradedDataSource.query(`
        INSERT INTO "${schema}"."archive_events" (
          "status",
          "pending_seen_at_height",
          "block_height",
          "block_timestamp",
          "event_type",
          "tx_hash",
          "account_update_id",
          "account_update_index",
          "event_index",
          "block_event_index",
          "raw_event_data"
        ) VALUES (
          'pending',
          43,
          43,
          '2026-09-03T00:00:00.000002Z',
          'proposalVoteDispatched',
          'new-transaction',
          '2',
          0,
          0,
          0,
          '{"data":["3"]}'::jsonb
        )
        RETURNING "id", "change_sequence"
      `)) as Array<{ id: string; change_sequence: string }>;
      assert.ok(BigInt(inserted.change_sequence) > 1n);

      const [timestampOnlyUpdateRows] = (await upgradedDataSource.query(
        `UPDATE "${schema}"."archive_events" SET "updated_at" = clock_timestamp() WHERE "id" = $1 RETURNING "change_sequence"`,
        [inserted.id],
      )) as [Array<{ change_sequence: string }>, number];
      const [timestampOnlyUpdate] = timestampOnlyUpdateRows;
      assert.ok(timestampOnlyUpdate);
      assert.equal(
        timestampOnlyUpdate.change_sequence,
        inserted.change_sequence,
      );

      const [semanticUpdateRows] = (await upgradedDataSource.query(
        `UPDATE "${schema}"."archive_events" SET "status" = 'canonical', "updated_at" = clock_timestamp() WHERE "id" = $1 RETURNING "change_sequence"`,
        [inserted.id],
      )) as [Array<{ change_sequence: string }>, number];
      const [semanticUpdate] = semanticUpdateRows;
      assert.ok(semanticUpdate);
      assert.ok(
        BigInt(semanticUpdate.change_sequence) >
          BigInt(inserted.change_sequence),
      );

      const [blockIdentityUpdateRows] = (await upgradedDataSource.query(
        `UPDATE "${schema}"."archive_events"
         SET "state_hash" = 'state-hash-43', "parent_hash" = 'state-hash-42'
         WHERE "id" = $1
         RETURNING "change_sequence"`,
        [inserted.id],
      )) as [Array<{ change_sequence: string }>, number];
      const [blockIdentityUpdate] = blockIdentityUpdateRows;
      assert.ok(blockIdentityUpdate);
      assert.ok(
        BigInt(blockIdentityUpdate.change_sequence) >
          BigInt(semanticUpdate.change_sequence),
      );

      const [orderMetadataUpdateRows] = (await upgradedDataSource.query(
        `UPDATE "${schema}"."archive_events"
         SET "block_event_index" = 2,
             "raw_event_data" = jsonb_set(
               "raw_event_data",
               '{transactionInfo}',
               '{"hash":"new-transaction","sequenceNumber":7,"zkappAccountUpdateIds":[2]}'::jsonb
             )
         WHERE "id" = $1
         RETURNING "change_sequence"`,
        [inserted.id],
      )) as [Array<{ change_sequence: string }>, number];
      const [orderMetadataUpdate] = orderMetadataUpdateRows;
      assert.ok(orderMetadataUpdate);
      assert.ok(
        BigInt(orderMetadataUpdate.change_sequence) >
          BigInt(blockIdentityUpdate.change_sequence),
      );

      const firstRunner = upgradedDataSource.createQueryRunner();
      const secondRunner = upgradedDataSource.createQueryRunner();
      await firstRunner.connect();
      await secondRunner.connect();
      await firstRunner.startTransaction();
      await secondRunner.startTransaction();
      try {
        const [firstConcurrent] = (await firstRunner.query(`
          INSERT INTO "${schema}"."archive_events" (
            "status", "block_height", "event_type", "tx_hash",
            "account_update_id", "account_update_index", "event_index",
            "block_event_index", "raw_event_data"
          ) VALUES (
            'canonical', 44, 'proposalCreated', 'concurrent-one',
            '3', 0, 0, 0, '{"data":["0"]}'::jsonb
          ) RETURNING "change_sequence"
        `)) as Array<{ change_sequence: string }>;

        const secondInsert = secondRunner.query(`
          INSERT INTO "${schema}"."archive_events" (
            "status", "block_height", "event_type", "tx_hash",
            "account_update_id", "account_update_index", "event_index",
            "block_event_index", "raw_event_data"
          ) VALUES (
            'canonical', 45, 'proposalCreated', 'concurrent-two',
            '4', 0, 0, 0, '{"data":["0"]}'::jsonb
          ) RETURNING "change_sequence"
        `) as Promise<Array<{ change_sequence: string }>>;

        await firstRunner.commitTransaction();
        const [secondConcurrent] = await secondInsert;
        await secondRunner.commitTransaction();
        assert.ok(
          BigInt(secondConcurrent.change_sequence) >
            BigInt(firstConcurrent.change_sequence),
        );
      } finally {
        if (firstRunner.isTransactionActive) {
          await firstRunner.rollbackTransaction();
        }
        if (secondRunner.isTransactionActive) {
          await secondRunner.rollbackTransaction();
        }
        await firstRunner.release();
        await secondRunner.release();
      }

      const updateRunner = upgradedDataSource.createQueryRunner();
      const upsertRunner = upgradedDataSource.createQueryRunner();
      await updateRunner.connect();
      await upsertRunner.connect();
      await updateRunner.startTransaction();
      await upsertRunner.startTransaction();
      try {
        const [updatedFirstRows] = (await updateRunner.query(
          `UPDATE "${schema}"."archive_events" SET "status" = 'orphaned' WHERE "id" = $1 RETURNING "change_sequence"`,
          [inserted.id],
        )) as [Array<{ change_sequence: string }>, number];
        const [updatedFirst] = updatedFirstRows;
        assert.ok(updatedFirst);

        const conflictingUpsert = upsertRunner.query(
          `
            INSERT INTO "${schema}"."archive_events" (
              "status", "block_height", "event_type", "tx_hash",
              "account_update_id", "account_update_index", "event_index",
              "block_event_index", "raw_event_data"
            ) VALUES (
              'canonical', 43, 'proposalVoteDispatched', 'new-transaction',
              '2', 0, 0, 0, '{"data":["3"]}'::jsonb
            )
            ON CONFLICT ("tx_hash", "account_update_id", "account_update_index", "event_index")
            DO UPDATE SET "status" = EXCLUDED."status"
            RETURNING "change_sequence"
          `,
        ) as Promise<Array<{ change_sequence: string }>>;

        await updateRunner.commitTransaction();
        const [upsertedSecond] = await conflictingUpsert;
        await upsertRunner.commitTransaction();
        assert.ok(
          BigInt(upsertedSecond.change_sequence) >
            BigInt(updatedFirst.change_sequence),
        );
      } finally {
        if (updateRunner.isTransactionActive) {
          await updateRunner.rollbackTransaction();
        }
        if (upsertRunner.isTransactionActive) {
          await upsertRunner.rollbackTransaction();
        }
        await updateRunner.release();
        await upsertRunner.release();
      }

      const tables = (await upgradedDataSource.query(
        `
          SELECT "table_name"
          FROM information_schema.tables
          WHERE "table_schema" = $1
            AND "table_name" IN (
              'archive_event_rejections',
              'indexer_runtime_status',
              'processor_event_failures',
              'processor_proposal_contents',
              'processor_proposal_projection_replay',
              'processor_runtime_status',
              'processor_proposal_event_facts'
            )
          ORDER BY "table_name"
        `,
        [schema],
      )) as Array<{ table_name: string }>;
      assert.deepEqual(
        tables.map((row) => row.table_name),
        [
          "archive_event_rejections",
          "indexer_runtime_status",
          "processor_event_failures",
          "processor_proposal_contents",
          "processor_proposal_event_facts",
          "processor_proposal_projection_replay",
          "processor_runtime_status",
        ],
      );

      const tallyIndexes = (await upgradedDataSource.query(
        `SELECT "indexname", "indexdef"
         FROM pg_indexes
         WHERE "schemaname" = $1
           AND "tablename" = 'processor_vote_tallies'`,
        [schema],
      )) as Array<{ indexname: string; indexdef: string }>;
      const runningTallyIndex = tallyIndexes.find(
        (row) =>
          row.indexname ===
          "ux_processor_vote_tallies_running_proposal_block_height",
      );
      assert.match(
        runningTallyIndex?.indexdef ?? "",
        /UNIQUE.*proposal_public_key.*block_height.*proposalVoteDispatched/i,
      );
      assert.equal(
        tallyIndexes.some(
          (row) =>
            row.indexname ===
            "ux_processor_vote_tallies_proposal_public_key_block_height",
        ),
        false,
      );
      const tallyForeignKeys = (await upgradedDataSource.query(
        `SELECT "constraint_name"
         FROM information_schema.table_constraints
         WHERE "constraint_schema" = $1
           AND "constraint_type" = 'FOREIGN KEY'
           AND "table_name" IN ('processor_votes', 'processor_vote_nullifiers')`,
        [schema],
      )) as Array<{ constraint_name: string }>;
      assert.equal(
        tallyForeignKeys.some((row) =>
          [
            "FK_b9163cc2e20ab4a8e7b6b4c16d4",
            "FK_5c3d3f889b02eb89aa1494d40f5",
          ].includes(row.constraint_name),
        ),
        false,
      );

      const uint32Columns = (await upgradedDataSource.query(
        `SELECT "table_name", "column_name", "data_type"
         FROM information_schema.columns
         WHERE "table_schema" = $1
           AND ("table_name", "column_name") IN (
             ('processor_proposals', 'lifecycle_id'),
             ('processor_proposal_executions', 'lifecycle_id'),
             ('archive_events', 'global_slot_since_genesis'),
             ('processor_proposal_event_facts', 'global_slot_since_genesis')
           )
         ORDER BY "table_name", "column_name"`,
        [schema],
      )) as Array<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>;
      assert.deepEqual(uint32Columns, [
        {
          table_name: "archive_events",
          column_name: "global_slot_since_genesis",
          data_type: "bigint",
        },
        {
          table_name: "processor_proposal_event_facts",
          column_name: "global_slot_since_genesis",
          data_type: "bigint",
        },
        {
          table_name: "processor_proposal_executions",
          column_name: "lifecycle_id",
          data_type: "bigint",
        },
        {
          table_name: "processor_proposals",
          column_name: "lifecycle_id",
          data_type: "bigint",
        },
      ]);

      const uint32Constraints = (await upgradedDataSource.query(
        `SELECT
           table_constraints."table_name",
           table_constraints."constraint_name",
           check_constraints."check_clause"
         FROM information_schema.table_constraints AS table_constraints
         INNER JOIN information_schema.check_constraints AS check_constraints
           ON check_constraints."constraint_catalog" = table_constraints."constraint_catalog"
          AND check_constraints."constraint_schema" = table_constraints."constraint_schema"
          AND check_constraints."constraint_name" = table_constraints."constraint_name"
         WHERE table_constraints."constraint_schema" = $1
           AND table_constraints."constraint_name" IN (
             'CK_processor_proposals_lifecycle_id_uint32',
             'CK_processor_proposal_executions_lifecycle_id_uint32',
             'CK_archive_events_global_slot_since_genesis_uint32',
             'CK_processor_proposal_facts_global_slot_uint32'
           )
         ORDER BY table_constraints."table_name", table_constraints."constraint_name"`,
        [schema],
      )) as Array<{
        table_name: string;
        constraint_name: string;
        check_clause: string;
      }>;
      assert.deepEqual(
        uint32Constraints.map((row) => [row.table_name, row.constraint_name]),
        [
          [
            "archive_events",
            "CK_archive_events_global_slot_since_genesis_uint32",
          ],
          [
            "processor_proposal_event_facts",
            "CK_processor_proposal_facts_global_slot_uint32",
          ],
          [
            "processor_proposal_executions",
            "CK_processor_proposal_executions_lifecycle_id_uint32",
          ],
          ["processor_proposals", "CK_processor_proposals_lifecycle_id_uint32"],
        ],
      );
      for (const constraint of uint32Constraints) {
        assert.match(constraint.check_clause, /(?:>=\s*0\b|BETWEEN\s+0\b)/i);
        assert.match(
          constraint.check_clause,
          /(?:<=\s*'?4294967295'?|AND\s+4294967295\b)/i,
        );
      }

      const boundaryExecutionEventId = `uint32-execution-${randomUUID()}`;
      const boundaryFactEventId = `uint32-fact-${randomUUID()}`;
      await upgradedDataSource.query(
        `INSERT INTO "${schema}"."processor_proposal_executions" (
           "archive_event_id",
           "proposal_public_key",
           "lifecycle_id",
           "recipient",
           "amount_to_pay_out",
           "proposal_amount",
           "bond_amount",
           "sender_public_key",
           "paid_out_amount",
           "remaining_amount",
           "status"
         ) VALUES ($1, $2, 0, 'boundary-recipient', '1', '1', '0',
           'boundary-sender', '1', '0', 'canonical')`,
        [boundaryExecutionEventId, legacyProposalPublicKey],
      );
      await upgradedDataSource.query(
        `INSERT INTO "${schema}"."processor_proposal_event_facts" (
           "archive_event_id",
           "change_sequence",
           "event_type",
           "proposal_public_key",
           "status",
           "block_height",
           "block_event_index",
           "tx_hash",
           "decoded_payload",
           "updated_at"
         ) VALUES ($1, 1, 'proposalCreated', $2, 'canonical', 42, 0,
           'uint32-boundary-fact', '{}'::jsonb, now())`,
        [boundaryFactEventId, legacyProposalPublicKey],
      );

      for (const boundary of ["2147483648", "4294967295"] as const) {
        await upgradedDataSource.query(
          `UPDATE "${schema}"."processor_proposals"
           SET "lifecycle_id" = $1
           WHERE "proposal_public_key" = $2`,
          [boundary, legacyProposalPublicKey],
        );
        await upgradedDataSource.query(
          `UPDATE "${schema}"."processor_proposal_executions"
           SET "lifecycle_id" = $1
           WHERE "archive_event_id" = $2`,
          [boundary, boundaryExecutionEventId],
        );
        await upgradedDataSource.query(
          `UPDATE "${schema}"."archive_events"
           SET "global_slot_since_genesis" = $1
           WHERE "id" = $2`,
          [boundary, legacyEvent.id],
        );
        await upgradedDataSource.query(
          `UPDATE "${schema}"."processor_proposal_event_facts"
           SET "global_slot_since_genesis" = $1
           WHERE "archive_event_id" = $2`,
          [boundary, boundaryFactEventId],
        );

        const [roundTrippedBoundary] = (await upgradedDataSource.query(
          `SELECT
             (SELECT "lifecycle_id"::text
              FROM "${schema}"."processor_proposals"
              WHERE "proposal_public_key" = $1) AS "proposal_lifecycle_id",
             (SELECT "lifecycle_id"::text
              FROM "${schema}"."processor_proposal_executions"
              WHERE "archive_event_id" = $2) AS "execution_lifecycle_id",
             (SELECT "global_slot_since_genesis"::text
              FROM "${schema}"."archive_events"
              WHERE "id" = $3) AS "archive_global_slot",
             (SELECT "global_slot_since_genesis"::text
              FROM "${schema}"."processor_proposal_event_facts"
              WHERE "archive_event_id" = $4) AS "fact_global_slot"`,
          [
            legacyProposalPublicKey,
            boundaryExecutionEventId,
            legacyEvent.id,
            boundaryFactEventId,
          ],
        )) as Array<{
          proposal_lifecycle_id: string;
          execution_lifecycle_id: string;
          archive_global_slot: string;
          fact_global_slot: string;
        }>;
        assert.deepEqual(roundTrippedBoundary, {
          proposal_lifecycle_id: boundary,
          execution_lifecycle_id: boundary,
          archive_global_slot: boundary,
          fact_global_slot: boundary,
        });
      }

      await upgradedDataSource.query(
        `DELETE FROM "${schema}"."processor_proposal_executions"
         WHERE "archive_event_id" = $1`,
        [boundaryExecutionEventId],
      );
      await upgradedDataSource.query(
        `DELETE FROM "${schema}"."processor_proposal_event_facts"
         WHERE "archive_event_id" = $1`,
        [boundaryFactEventId],
      );
      await upgradedDataSource.query(
        `UPDATE "${schema}"."archive_events"
         SET "global_slot_since_genesis" = NULL
         WHERE "id" = $1`,
        [legacyEvent.id],
      );
      await upgradedDataSource.query(
        `UPDATE "${schema}"."processor_proposals"
         SET "lifecycle_id" = 2
         WHERE "proposal_public_key" = $1`,
        [legacyProposalPublicKey],
      );

      await upgradedDataSource.undoLastMigration();
      const contractColumnsAfterDown = (await upgradedDataSource.query(
        `SELECT "column_name" FROM information_schema.columns
         WHERE "table_schema" = $1
           AND "table_name" = 'processor_proposals'
           AND "column_name" = 'contract_status'`,
        [schema],
      )) as Array<{ column_name: string }>;
      assert.equal(contractColumnsAfterDown.length, 0);

      await upgradedDataSource.undoLastMigration();
      const columnsAfterDown = (await upgradedDataSource.query(
        `SELECT "column_name" FROM information_schema.columns WHERE "table_schema" = $1 AND "table_name" = 'archive_events' AND "column_name" = 'change_sequence'`,
        [schema],
      )) as Array<{ column_name: string }>;
      assert.equal(columnsAfterDown.length, 0);
      const contentTablesAfterDown = (await upgradedDataSource.query(
        `SELECT "table_name" FROM information_schema.tables WHERE "table_schema" = $1 AND "table_name" = 'processor_proposal_contents'`,
        [schema],
      )) as Array<{ table_name: string }>;
      assert.equal(contentTablesAfterDown.length, 0);

      const reapplied = await upgradedDataSource.runMigrations();
      assert.deepEqual(
        reapplied.map((migration) => migration.name),
        [
          "BackendPipelineHardening1788447600000",
          "ProposalContractProjection1788451200000",
        ],
      );
      const [reappliedContent] = (await upgradedDataSource.query(
        `SELECT "contents" FROM "${schema}"."processor_proposal_contents" WHERE "proposal_public_key" = $1 AND "zkapp_uri_hash" = $2`,
        [legacyProposalPublicKey, legacyZkAppUriHash],
      )) as Array<{ contents: string }>;
      assert.equal(reappliedContent.contents, legacyContents);

      await upgradedDataSource.query(
        `INSERT INTO "${schema}"."processor_vote_tallies" (
           "archive_event_id",
           "source_status",
           "block_event_index",
           "proposal_public_key",
           "block_height",
           "created_by_event_type"
         ) VALUES
           ('same-height-final-canonical', 'canonical', 0, $1, 50, 'proposalVotesTallied'),
           ('same-height-final-pending', 'pending', 1, $1, 50, 'proposalVotesTallied'),
           (NULL, 'canonical', 2, $1, 50, 'proposalVoteDispatched')`,
        [legacyProposalPublicKey],
      );
      const [sameHeightTallyCount] = (await upgradedDataSource.query(
        `SELECT COUNT(*)::int AS "count"
         FROM "${schema}"."processor_vote_tallies"
         WHERE "proposal_public_key" = $1 AND "block_height" = 50`,
        [legacyProposalPublicKey],
      )) as Array<{ count: number }>;
      assert.equal(sameHeightTallyCount.count, 3);
      await assert.rejects(
        upgradedDataSource.query(
          `INSERT INTO "${schema}"."processor_vote_tallies" (
             "source_status",
             "block_event_index",
             "proposal_public_key",
             "block_height",
             "created_by_event_type"
           ) VALUES ('canonical', 3, $1, 50, 'proposalVoteDispatched')`,
          [legacyProposalPublicKey],
        ),
        /duplicate key|unique constraint/i,
      );
    } finally {
      try {
        if (legacyDataSource?.isInitialized) {
          await legacyDataSource.destroy();
        }
        if (upgradedDataSource?.isInitialized) {
          await upgradedDataSource.destroy();
        }
        if (admin.isInitialized) {
          try {
            await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          } finally {
            await admin.destroy();
          }
        }
      } finally {
        if (previousProcessorName === undefined) {
          delete process.env.PROCESSOR_NAME;
        } else {
          process.env.PROCESSOR_NAME = previousProcessorName;
        }
      }
    }
  },
);

test(
  "proposal projection migration keeps replay collecting for legacy rows without Archive facts",
  { skip: databaseTestUrl ? false : "DATABASE_TEST_URL is not set" },
  async () => {
    const schema = `backend_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new DataSource({ type: "postgres", url: databaseTestUrl });
    let legacyDataSource: DataSource | null = null;
    let upgradedDataSource: DataSource | null = null;

    try {
      await admin.initialize();
      await ensureDatabaseSchema(databaseTestUrl!, schema);
      legacyDataSource = migrationDataSource(databaseTestUrl!, schema, [
        ConfigureProcessorSchema1775649313439,
        InitializeProcessorSchema1775649313440,
      ]);
      await legacyDataSource.initialize();
      await legacyDataSource.runMigrations();
      await legacyDataSource.query(`
        INSERT INTO "${schema}"."processor_proposals" (
          "proposal_public_key",
          "lifecycle_id",
          "amount",
          "recipient",
          "zkapp_uri_hash",
          "status"
        ) VALUES (
          'legacy-without-archive-fact',
          2,
          '1000',
          'legacy-recipient',
          'legacy-zkapp-uri-hash',
          'canonical'
        )
      `);
      await legacyDataSource.destroy();
      legacyDataSource = null;

      upgradedDataSource = migrationDataSource(databaseTestUrl!, schema, [
        ConfigureProcessorSchema1775649313439,
        InitializeProcessorSchema1775649313440,
        BackendPipelineHardening1788447600000,
        ProposalContractProjection1788451200000,
      ]);
      await upgradedDataSource.initialize();
      await upgradedDataSource.runMigrations();

      const [replayState] = (await upgradedDataSource.query(
        `SELECT "target_change_sequence", "state", "completed_at"
         FROM "${schema}"."processor_proposal_projection_replay"
         WHERE "projection_name" = 'proposal'`,
      )) as Array<{
        target_change_sequence: string;
        state: string;
        completed_at: Date | null;
      }>;
      assert.deepEqual(replayState, {
        target_change_sequence: "0",
        state: "collecting",
        completed_at: null,
      });
    } finally {
      if (legacyDataSource?.isInitialized) {
        await legacyDataSource.destroy();
      }
      if (upgradedDataSource?.isInitialized) {
        await upgradedDataSource.destroy();
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
