import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import type { DataSource } from "typeorm";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const UINT32_BOUNDARIES = [2_147_483_648, 4_294_967_295] as const;
const UINT32_OVERFLOW = 4_294_967_296;

describe("proposal UInt32 persistence", () => {
  let dataSource: DataSource;

  before(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      ProposalEventFactEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    await dataSource.initialize();
    await dataSource.synchronize();
  });

  after(async () => {
    await dataSource.destroy();
  });

  it("maps each lifecycle and global-slot column to PostgreSQL bigint", () => {
    const columns = [
      [ProposalEntity, "lifecycleId"],
      [ProposalExecutionEntity, "lifecycleId"],
      [ArchiveEventEntity, "globalSlotSinceGenesis"],
      [ProposalEventFactEntity, "globalSlotSinceGenesis"],
    ] as const;

    for (const [entity, propertyName] of columns) {
      const column = dataSource
        .getMetadata(entity)
        .columns.find((candidate) => candidate.propertyName === propertyName);
      assert.ok(column);
      assert.equal(column.type, "bigint");
    }
  });

  for (const value of UINT32_BOUNDARIES) {
    it(`round-trips UInt32 value ${value}`, async () => {
      const suffix = value.toString();
      const proposalPublicKey = `proposal-${suffix}`;
      await dataSource.getRepository(ProposalEntity).insert({
        proposalPublicKey,
        lifecycleId: value,
        amount: "1",
        recipient: `recipient-${suffix}`,
        zkAppUriHash: suffix,
        status: "canonical",
      });
      await dataSource.getRepository(ProposalExecutionEntity).insert({
        archiveEventId: `execution-event-${suffix}`,
        proposalPublicKey,
        lifecycleId: value,
        recipient: `recipient-${suffix}`,
        amountToPayOut: "1",
        proposalAmount: "1",
        bondAmount: "0",
        senderPublicKey: `sender-${suffix}`,
        paidOutAmount: "1",
        remainingAmount: "0",
        status: "canonical",
      });
      await dataSource.getRepository(ArchiveEventEntity).insert({
        status: "canonical",
        pendingSeenAtHeight: null,
        blockHeight: 1,
        blockTimestamp: null,
        globalSlotSinceGenesis: value,
        eventType: "proposalCreated",
        txHash: `tx-${suffix}`,
        accountUpdateId: suffix,
        accountUpdateIndex: 0,
        eventIndex: 0,
        blockEventIndex: 0,
        rawEventData: {} as never,
      });
      await dataSource.getRepository(ProposalEventFactEntity).insert({
        archiveEventId: `fact-event-${suffix}`,
        changeSequence: suffix,
        eventType: "proposalCreated",
        proposalPublicKey,
        status: "canonical",
        blockHeight: 1,
        blockTimestamp: null,
        globalSlotSinceGenesis: value,
        blockEventIndex: 0,
        txHash: `fact-tx-${suffix}`,
        decodedPayload: {},
        updatedAt: new Date(),
      });

      const proposal = await dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey });
      const execution = await dataSource
        .getRepository(ProposalExecutionEntity)
        .findOneByOrFail({ archiveEventId: `execution-event-${suffix}` });
      const archiveEvent = await dataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({ txHash: `tx-${suffix}` });
      const eventFact = await dataSource
        .getRepository(ProposalEventFactEntity)
        .findOneByOrFail({ archiveEventId: `fact-event-${suffix}` });

      assert.equal(proposal.lifecycleId, value);
      assert.equal(execution.lifecycleId, value);
      assert.equal(archiveEvent.globalSlotSinceGenesis, value);
      assert.equal(eventFact.globalSlotSinceGenesis, value);
    });
  }

  it("rejects values above the UInt32 maximum", async () => {
    await assert.rejects(
      dataSource.getRepository(ProposalEntity).insert({
        proposalPublicKey: "overflow-proposal",
        lifecycleId: UINT32_OVERFLOW,
        amount: "1",
        recipient: "overflow-recipient",
        zkAppUriHash: "1",
        status: "canonical",
      }),
      /UInt32 column value must be in the UInt32 range/,
    );

    await assert.rejects(
      dataSource.query(
        `INSERT INTO "archive_events" (
          "status", "block_height", "global_slot_since_genesis", "event_type",
          "tx_hash", "account_update_id", "account_update_index", "event_index",
          "block_event_index", "raw_event_data"
        ) VALUES ('canonical', 1, 4294967296, 'proposalCreated',
          'overflow-tx', 'overflow-account-update', 0, 0, 0, '{}')`,
      ),
    );
  });
});
