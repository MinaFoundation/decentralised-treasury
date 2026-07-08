import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { Field, PrivateKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalCreatedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { LIFECYCLE_DATA_UNAVAILABLE_ERROR } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildProposalCreatedEvent(): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = "1";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 77;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-proposal-created";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: "proposal-public-key-1",
    lifecycleId: 2,
    amount: "500000000",
    recipient: "recipient-public-key-1",
    zkAppUriHash: "123456",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "20",
    senderPublicKey: "sender-public-key-1",
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildProposalCreatedFieldEncodedEvent(): {
  event: ArchiveEventEntity;
  expectedProposalPublicKey: string;
  expectedSenderPublicKey: string;
} {
  const now = new Date();
  const payload = new ProposalCreatedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    lifecycleId: UInt32.from(2),
    amount: UInt64.from(500_000_000),
    recipient: PrivateKey.random().toPublicKey(),
    zkAppUriHash: Field(123456),
    stakingEpochDataLedgerHash: Field(999),
    stakingEpochDataLedgerTotalCurrency: UInt64.from(20),
    proposerPublicKey: PrivateKey.random().toPublicKey(),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  const event = new ArchiveEventEntity();
  event.id = "2";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 78;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-proposal-created-fields";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    data: ProposalCreatedEvent.toFields(payload).map((field) => field.toString()),
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    expectedProposalPublicKey: payload.proposalPublicKey.toBase58(),
    expectedSenderPublicKey: payload.senderPublicKey.toBase58(),
  };
}

describe("ProposalCreatedEventHandler", () => {
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
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("derives acceptance criteria using treasury balance from staking lookup", async () => {
    const event = buildProposalCreatedEvent();
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
        lifecycleId === 2 ? "10" : null,
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: "proposal-public-key-1",
    });
    assert.ok(proposal);

    assert.equal(proposal?.requiredParticipationBp, "1234");
    assert.equal(proposal?.requiredApprovalBp, "6789");
    assert.equal(proposal?.requiredParticipation, "55");
  });

  it("decodes the current field-encoded proposalCreated payload layout", async () => {
    const { event, expectedProposalPublicKey, expectedSenderPublicKey } =
      buildProposalCreatedFieldEncodedEvent();
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => "10",
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.senderPublicKey, expectedSenderPublicKey);
    assert.equal(proposal?.requiredParticipationBp, "1234");
    assert.equal(proposal?.requiredApprovalBp, "6789");
    assert.equal(proposal?.requiredParticipation, "55");
  });

  it("projects proposalCreated when lifecycle staking data is not available", async () => {
    const event = buildProposalCreatedEvent();
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: "treasury-owner-public-key",
      stakingLedgerServices: {
        getService: async () => {
          throw new Error(LIFECYCLE_DATA_UNAVAILABLE_ERROR);
        },
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: "proposal-public-key-1",
    });
    assert.ok(proposal);
    assert.equal(proposal?.requiredParticipationBp, null);
    assert.equal(proposal?.requiredApprovalBp, null);
    assert.equal(proposal?.requiredParticipation, null);
  });
});
