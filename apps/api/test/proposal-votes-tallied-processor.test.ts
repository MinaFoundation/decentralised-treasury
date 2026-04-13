import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { Field, PrivateKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalVotesTalliedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildTalliedEvent(status: string, id: string): ArchiveEventEntity {
  const event = new ArchiveEventEntity();
  const now = new Date();
  event.id = id;
  event.status = status;
  event.pendingSeenAtHeight = null;
  event.blockHeight = 100;
  event.blockTimestamp = null;
  event.eventType = "proposalVotesTallied";
  event.txHash = `tx-${id}`;
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: "proposal-public-key-1",
    lifecycleId: 2,
    yayWeight: "11",
    nayWeight: "0",
    abstainWeight: "7",
    voteResult: "approved",
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildFieldEncodedTalliedEvent(): {
  event: ArchiveEventEntity;
  expectedProposalPublicKey: string;
  expectedSenderPublicKey: string;
} {
  const now = new Date();
  const payload = new ProposalVotesTalliedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    lifecycleId: UInt32.from(2),
    yayWeight: UInt64.from(11),
    nayWeight: UInt64.from(0),
    abstainWeight: UInt64.from(7),
    voteResult: Field(1),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  const event = new ArchiveEventEntity();
  event.id = "field-tally";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 101;
  event.blockTimestamp = now;
  event.eventType = "proposalVotesTallied";
  event.txHash = "tx-field-tally";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    data: ProposalVotesTalliedEvent.toFields(payload).map((field) => field.toString()),
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    expectedProposalPublicKey: payload.proposalPublicKey.toBase58(),
    expectedSenderPublicKey: payload.senderPublicKey.toBase58(),
  };
}

describe("ProposalVotesTalliedEventHandler", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    await dataSource.initialize();
    await dataSource.synchronize();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: "proposal-public-key-1",
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-1",
      zkAppUriHash: "123456",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "20",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "4",
      status: "canonical",
      isPaused: false,
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("deletes tallied projection rows when tally events are orphaned", async () => {
    const handler = new ProposalVotesTalliedEventHandler();
    const canonicalEvent = buildTalliedEvent("canonical", "1");
    const orphanedEvent = buildTalliedEvent("orphaned", "2");

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(canonicalEvent, manager),
      ),
      true,
    );
    const talliesAfterCanonical = await dataSource
      .getRepository(VoteTallyEntity)
      .find();
    assert.equal(talliesAfterCanonical.length, 1);
    assert.equal(
      talliesAfterCanonical[0]?.createdByEventType,
      "proposalVotesTallied",
    );

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(orphanedEvent, manager),
      ),
      true,
    );
    assert.equal(await dataSource.getRepository(VoteTallyEntity).count(), 0);
  });

  it("decodes the current field-encoded proposalVotesTallied payload layout", async () => {
    const { event, expectedProposalPublicKey } =
      buildFieldEncodedTalliedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-2",
      zkAppUriHash: "987654",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "20",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "4",
      status: "canonical",
      isPaused: false,
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });

    const handler = new ProposalVotesTalliedEventHandler();
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const tally = await dataSource.getRepository(VoteTallyEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
      blockHeight: 101,
    });
    assert.ok(tally);
    assert.equal(tally?.yayWeight, "11");
    assert.equal(tally?.abstainWeight, "7");
    assert.equal(tally?.requiredParticipationBp, "2000");
    assert.equal(tally?.approvalBp, "10000");
    assert.equal(tally?.totalParticipatingVotes, "18");
    assert.equal(tally?.voteResult, "approved");
  });
});
