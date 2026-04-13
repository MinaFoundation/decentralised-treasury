import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { PrivateKey, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalExecutedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildFieldEncodedExecutedEvent(): {
  event: ArchiveEventEntity;
  expectedProposalPublicKey: string;
  expectedSenderPublicKey: string;
  expectedPaidOutAmount: string;
} {
  const now = new Date();
  const payload = new ProposalExecutedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    amountToPayOut: UInt64.from(100_000_000),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  const event = new ArchiveEventEntity();
  event.id = "1";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 101;
  event.blockTimestamp = now;
  event.eventType = "proposalExecuted";
  event.txHash = "tx-proposal-executed-fields";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    data: ProposalExecutedEvent.toFields(payload).map((field) => field.toString()),
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    expectedProposalPublicKey: payload.proposalPublicKey.toBase58(),
    expectedSenderPublicKey: payload.senderPublicKey.toBase58(),
    expectedPaidOutAmount: payload.amountToPayOut.toString(),
  };
}

function buildLegacyFieldEncodedExecutedEvent(): {
  event: ArchiveEventEntity;
  expectedProposalPublicKey: string;
  expectedSenderPublicKey: string;
  expectedPaidOutAmount: string;
  expectedRemainingAmount: string;
  expectedBondAmount: string;
} {
  const now = new Date();
  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const recipient = PrivateKey.random().toPublicKey();
  const senderPublicKey = PrivateKey.random().toPublicKey();
  const amountToPayOut = UInt64.from(100_000_000);
  const event = new ArchiveEventEntity();
  event.id = "2";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 102;
  event.blockTimestamp = now;
  event.eventType = "proposalExecuted";
  event.txHash = "tx-proposal-executed-legacy-fields";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    data: [
      ...proposalPublicKey.toFields().map((field) => field.toString()),
      ...recipient.toFields().map((field) => field.toString()),
      amountToPayOut.value.toString(),
      ...senderPublicKey.toFields().map((field) => field.toString()),
    ],
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    expectedProposalPublicKey: proposalPublicKey.toBase58(),
    expectedSenderPublicKey: senderPublicKey.toBase58(),
    expectedPaidOutAmount: "150000000",
    expectedRemainingAmount: "400000000",
    expectedBondAmount: "50000000",
  };
}

describe("ProposalExecutedEventHandler", () => {
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

  it("decodes the current field-encoded proposalExecuted payload layout", async () => {
    const {
      event,
      expectedProposalPublicKey,
      expectedSenderPublicKey,
      expectedPaidOutAmount,
    } = buildFieldEncodedExecutedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-1",
      zkAppUriHash: "123456",
      stakingEpochDataLedgerHash: null,
      stakingEpochDataLedgerTotalCurrency: null,
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
      status: "canonical",
      isPaused: false,
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });

    const handler = new ProposalExecutedEventHandler();
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const execution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneBy({ archiveEventId: event.id });
    assert.ok(execution);
    assert.equal(execution?.proposalPublicKey, expectedProposalPublicKey);
    assert.equal(execution?.senderPublicKey, expectedSenderPublicKey);
    assert.equal(execution?.paidOutAmount, expectedPaidOutAmount);

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);
  });

  it("derives missing fields from proposal state for legacy field-encoded proposalExecuted payloads", async () => {
    const {
      event,
      expectedProposalPublicKey,
      expectedSenderPublicKey,
      expectedPaidOutAmount,
      expectedRemainingAmount,
      expectedBondAmount,
    } = buildLegacyFieldEncodedExecutedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-2",
      zkAppUriHash: "123456",
      stakingEpochDataLedgerHash: null,
      stakingEpochDataLedgerTotalCurrency: null,
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
      status: "canonical",
      isPaused: false,
      paidOutAmount: "50000000",
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });
    await dataSource.getRepository(ProposalExecutionEntity).insert({
      archiveEventId: "legacy-existing-execution",
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      recipient: "recipient-public-key-2",
      amountToPayOut: "50000000",
      proposalAmount: "500000000",
      bondAmount: "50000000",
      senderPublicKey: "legacy-sender-1",
      paidOutAmount: "50000000",
      remainingAmount: "500000000",
      blockHeight: 101,
      status: "canonical",
    });

    const handler = new ProposalExecutedEventHandler();
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const execution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneBy({ archiveEventId: event.id });
    assert.ok(execution);
    assert.equal(execution?.proposalPublicKey, expectedProposalPublicKey);
    assert.equal(execution?.senderPublicKey, expectedSenderPublicKey);
    assert.equal(execution?.paidOutAmount, expectedPaidOutAmount);
    assert.equal(execution?.remainingAmount, expectedRemainingAmount);
    assert.equal(execution?.bondAmount, expectedBondAmount);

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);
  });

  it("does not double-count paidOutAmount when the same event status changes", async () => {
    const {
      event,
      expectedProposalPublicKey,
      expectedPaidOutAmount,
    } = buildFieldEncodedExecutedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-3",
      zkAppUriHash: "123456",
      stakingEpochDataLedgerHash: null,
      stakingEpochDataLedgerTotalCurrency: null,
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
      status: "canonical",
      isPaused: false,
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });

    const handler = new ProposalExecutedEventHandler();

    event.status = "pending";
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    event.status = "canonical";
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const executions = await dataSource.getRepository(ProposalExecutionEntity).find({
      where: {
        proposalPublicKey: expectedProposalPublicKey,
      },
    });
    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.status, "canonical");

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);
  });

  it("recalculates paidOutAmount when an execution becomes orphaned", async () => {
    const {
      event,
      expectedProposalPublicKey,
      expectedPaidOutAmount,
    } = buildFieldEncodedExecutedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-4",
      zkAppUriHash: "123456",
      stakingEpochDataLedgerHash: null,
      stakingEpochDataLedgerTotalCurrency: null,
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
      status: "canonical",
      isPaused: false,
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });

    const handler = new ProposalExecutedEventHandler();

    event.status = "canonical";
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    let proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);

    event.status = "orphaned";
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, "0");
  });
});
