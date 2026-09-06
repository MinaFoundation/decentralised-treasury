import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { PrivateKey, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalExecutedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const SOURCE_ORDER_PROPOSAL_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const SOURCE_ORDER_SENDER_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();

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
  event.changeSequence = "1";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 101;
  event.blockTimestamp = now;
  event.eventType = "proposalExecuted";
  event.txHash = "tx-proposal-executed-fields";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    data: ProposalExecutedEvent.toFields(payload).map((field) =>
      field.toString(),
    ),
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
  expectedRecipient: string;
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
  event.changeSequence = "2";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 102;
  event.blockTimestamp = now;
  event.eventType = "proposalExecuted";
  event.txHash = "tx-proposal-executed-legacy-fields";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
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
    expectedRecipient: recipient.toBase58(),
    expectedSenderPublicKey: senderPublicKey.toBase58(),
    expectedPaidOutAmount: "100000000",
    expectedRemainingAmount: "450000000",
    expectedBondAmount: "50000000",
  };
}

function buildArchiveExecutedEvent(input: {
  id: string;
  amountToPayOut: string;
  blockEventIndex: number;
  blockHeight?: number;
}): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = input.id;
  event.changeSequence = input.id;
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = input.blockHeight ?? 101;
  event.blockTimestamp = now;
  event.eventType = "proposalExecuted";
  event.txHash = `tx-proposal-executed-${input.id}`;
  event.accountUpdateId = input.id;
  event.accountUpdateIndex = 0;
  event.eventIndex = input.blockEventIndex;
  event.blockEventIndex = input.blockEventIndex;
  event.rawEventData = {
    proposalPublicKey: SOURCE_ORDER_PROPOSAL_PUBLIC_KEY,
    amountToPayOut: input.amountToPayOut,
    senderPublicKey: SOURCE_ORDER_SENDER_PUBLIC_KEY,
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

describe("ProposalExecutedEventHandler", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
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

  it("decodes the recipient and derives projection fields for legacy field-encoded proposalExecuted payloads", async () => {
    const {
      event,
      expectedProposalPublicKey,
      expectedRecipient,
      expectedSenderPublicKey,
      expectedPaidOutAmount,
      expectedRemainingAmount,
      expectedBondAmount,
    } = buildLegacyFieldEncodedExecutedEvent();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: expectedRecipient,
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
    assert.equal(execution?.recipient, expectedRecipient);
    assert.equal(execution?.senderPublicKey, expectedSenderPublicKey);
    assert.equal(execution?.paidOutAmount, expectedPaidOutAmount);
    assert.equal(execution?.remainingAmount, expectedRemainingAmount);
    assert.equal(execution?.bondAmount, expectedBondAmount);

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);

    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: event.id });
    assert.equal(fact.decodedPayload.recipient, expectedRecipient);
  });

  it("rejects a legacy execution recipient that differs from the proposal recipient", async () => {
    const { event, expectedProposalPublicKey, expectedRecipient } =
      buildLegacyFieldEncodedExecutedEvent();
    const committedRecipient = PrivateKey.random().toPublicKey().toBase58();
    assert.notEqual(committedRecipient, expectedRecipient);
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: expectedProposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: committedRecipient,
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
    await assert.rejects(
      dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      /execution recipient=.* does not match proposal recipient=/,
    );
    assert.equal(
      await dataSource.getRepository(ProposalExecutionEntity).count(),
      0,
    );
  });

  it("does not double-count paidOutAmount when the same event status changes", async () => {
    const { event, expectedProposalPublicKey, expectedPaidOutAmount } =
      buildFieldEncodedExecutedEvent();
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

    const pendingExecution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneByOrFail({ archiveEventId: event.id });
    assert.equal(pendingExecution.status, "pending");
    assert.equal(pendingExecution.paidOutAmount, expectedPaidOutAmount);
    assert.equal(pendingExecution.remainingAmount, "450000000");
    const pendingProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: expectedProposalPublicKey });
    assert.equal(pendingProposal.paidOutAmount, expectedPaidOutAmount);

    event.status = "canonical";
    event.changeSequence = "2";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const executions = await dataSource
      .getRepository(ProposalExecutionEntity)
      .find({
        where: {
          proposalPublicKey: expectedProposalPublicKey,
        },
      });
    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.status, "canonical");
    assert.equal(executions[0]?.paidOutAmount, pendingExecution.paidOutAmount);
    assert.equal(
      executions[0]?.remainingAmount,
      pendingExecution.remainingAmount,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.paidOutAmount, expectedPaidOutAmount);
  });

  it("recalculates paidOutAmount when an execution becomes orphaned", async () => {
    const { event, expectedProposalPublicKey, expectedPaidOutAmount } =
      buildFieldEncodedExecutedEvent();
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
    event.changeSequence = "2";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1);
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
    assert.equal(
      await dataSource
        .getRepository(ProposalExecutionEntity)
        .countBy({ archiveEventId: event.id }),
      0,
    );
    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: event.id });
    assert.equal(fact.status, "orphaned");
  });

  it("computes exact execution cumulatives in source order at the same height", async () => {
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: SOURCE_ORDER_PROPOSAL_PUBLIC_KEY,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-source-order",
      zkAppUriHash: "123456",
      status: "canonical",
      isPaused: false,
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: null,
    });
    const first = buildArchiveExecutedEvent({
      id: "11",
      amountToPayOut: "100000000",
      blockEventIndex: 0,
    });
    const second = buildArchiveExecutedEvent({
      id: "12",
      amountToPayOut: "200000000",
      blockEventIndex: 1,
    });
    const third = buildArchiveExecutedEvent({
      id: "13",
      amountToPayOut: "50000000",
      blockEventIndex: 0,
      blockHeight: 102,
    });
    const handler = new ProposalExecutedEventHandler();

    await dataSource.transaction(async (manager) => {
      await handler.tryHandle(second, manager);
      await handler.tryHandle(first, manager);
      await handler.tryHandle(third, manager);
    });

    const firstProjection = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneBy({ archiveEventId: first.id });
    const secondProjection = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneBy({ archiveEventId: second.id });
    const thirdProjection = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneBy({ archiveEventId: third.id });
    assert.equal(firstProjection?.paidOutAmount, "100000000");
    assert.equal(firstProjection?.remainingAmount, "450000000");
    assert.equal(firstProjection?.blockEventIndex, 0);
    assert.equal(secondProjection?.paidOutAmount, "300000000");
    assert.equal(secondProjection?.remainingAmount, "250000000");
    assert.equal(secondProjection?.blockEventIndex, 1);
    assert.equal(thirdProjection?.paidOutAmount, "350000000");
    assert.equal(thirdProjection?.remainingAmount, "200000000");
    assert.equal(thirdProjection?.blockEventIndex, 0);
    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: SOURCE_ORDER_PROPOSAL_PUBLIC_KEY,
    });
    assert.equal(proposal?.paidOutAmount, "350000000");
  });

  it("rejects compatibility payout values outside the UInt64 domain", async () => {
    const { event, expectedProposalPublicKey, expectedSenderPublicKey } =
      buildFieldEncodedExecutedEvent();
    event.rawEventData = {
      proposalPublicKey: expectedProposalPublicKey,
      amountToPayOut: "18446744073709551616",
      senderPublicKey: expectedSenderPublicKey,
    } as never;
    const handler = new ProposalExecutedEventHandler();

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      false,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });

  it("rejects current and legacy field-encoded payout overflows", async () => {
    const handler = new ProposalExecutedEventHandler();
    const current = buildFieldEncodedExecutedEvent().event;
    (current.rawEventData as { data: string[] }).data[2] =
      "18446744073709551616";
    const legacy = buildLegacyFieldEncodedExecutedEvent().event;
    (legacy.rawEventData as { data: string[] }).data[4] =
      "18446744073709551616";

    for (const event of [current, legacy]) {
      assert.equal(
        await dataSource.transaction(
          async (manager) => await handler.tryHandle(event, manager),
        ),
        false,
      );
    }
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });
});
