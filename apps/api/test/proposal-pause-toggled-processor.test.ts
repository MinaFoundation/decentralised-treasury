import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { Bool, PrivateKey } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalPauseToggledEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const PROPOSAL_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();
const CHILD_FIRST_PROPOSAL_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const RECIPIENT_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();
const SENDER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();

function buildProposalPauseToggledEvent(
  paused: boolean,
  status: "pending" | "canonical" | "orphaned" = "canonical",
  blockHeight = paused ? 88 : 89,
  id = paused ? "pause-event" : "unpause-event",
): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = id;
  event.changeSequence = String(blockHeight);
  event.status = status;
  event.pendingSeenAtHeight = null;
  event.blockHeight = blockHeight;
  event.blockTimestamp = now;
  event.eventType = "proposalPauseToggled";
  event.txHash = paused ? "tx-proposal-pause" : "tx-proposal-unpause";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: PROPOSAL_PUBLIC_KEY,
    paused,
    senderPublicKey: SENDER_PUBLIC_KEY,
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildProposalCreatedEvent(): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = "create-event";
  event.changeSequence = "77";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 77;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-proposal-create";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: CHILD_FIRST_PROPOSAL_PUBLIC_KEY,
    lifecycleId: 2,
    amount: "500000000",
    recipient: RECIPIENT_PUBLIC_KEY,
    zkAppUriHash: "123456",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "20",
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5100",
    requiredParticipation: "4",
    senderPublicKey: SENDER_PUBLIC_KEY,
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildFieldEncodedProposalPauseToggledEvent(paused: boolean): {
  event: ArchiveEventEntity;
  proposalPublicKey: string;
} {
  const now = new Date();
  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const payload = new ProposalPauseToggledEvent({
    proposalPublicKey,
    paused: Bool(paused),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  const event = new ArchiveEventEntity();
  event.id = "pause-field-event";
  event.changeSequence = "89";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 89;
  event.blockTimestamp = now;
  event.eventType = "proposalPauseToggled";
  event.txHash = "tx-proposal-pause-field";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    data: ProposalPauseToggledEvent.toFields(payload).map((field) =>
      field.toString(),
    ),
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    proposalPublicKey: proposalPublicKey.toBase58(),
  };
}

describe("ProposalPauseToggledEventHandler", () => {
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
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: PROPOSAL_PUBLIC_KEY,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key-1",
      zkAppUriHash: "123456",
      status: "unknown",
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 77,
      createdAtBlockTimestamp: new Date(),
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("updates proposal status to paused when the toggle event pauses the proposal", async () => {
    const handler = new ProposalPauseToggledEventHandler();

    assert.equal(
      await dataSource.transaction(
        async (manager) =>
          await handler.tryHandle(
            buildProposalPauseToggledEvent(true),
            manager,
          ),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: PROPOSAL_PUBLIC_KEY,
    });
    assert.equal(proposal?.status, "unknown");
    assert.equal(proposal?.isPaused, true);
  });

  it("reverts the paused flag on orphaned pause toggle events", async () => {
    const handler = new ProposalPauseToggledEventHandler();

    await dataSource
      .getRepository(ProposalEntity)
      .update(
        { proposalPublicKey: PROPOSAL_PUBLIC_KEY },
        { status: "approved", isPaused: true },
      );

    assert.equal(
      await dataSource.transaction(
        async (manager) =>
          await handler.tryHandle(
            buildProposalPauseToggledEvent(true, "orphaned"),
            manager,
          ),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: PROPOSAL_PUBLIC_KEY,
    });
    assert.equal(proposal?.status, "approved");
    assert.equal(proposal?.isPaused, false);
  });

  it("derives pause state from the last surviving source event", async () => {
    const handler = new ProposalPauseToggledEventHandler();
    const pause = buildProposalPauseToggledEvent(
      true,
      "canonical",
      88,
      "pause-1",
    );
    const unpause = buildProposalPauseToggledEvent(
      false,
      "canonical",
      89,
      "pause-2",
    );

    await dataSource.transaction(async (manager) => {
      await handler.tryHandle(pause, manager);
      await handler.tryHandle(unpause, manager);
    });
    unpause.status = "orphaned";
    unpause.changeSequence = "90";
    unpause.updatedAt = new Date(unpause.updatedAt.getTime() + 1);
    await dataSource.transaction(
      async (manager) => await handler.tryHandle(unpause, manager),
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: PROPOSAL_PUBLIC_KEY,
    });
    assert.equal(proposal?.isPaused, true);
  });

  it("retains a pause event until its proposal creation event arrives", async () => {
    const pauseHandler = new ProposalPauseToggledEventHandler();
    const pause = buildProposalPauseToggledEvent(
      true,
      "canonical",
      88,
      "pause-child-first",
    );
    pause.rawEventData = {
      proposalPublicKey: CHILD_FIRST_PROPOSAL_PUBLIC_KEY,
      paused: true,
      senderPublicKey: SENDER_PUBLIC_KEY,
    } as never;

    await dataSource.transaction(
      async (manager) => await pauseHandler.tryHandle(pause, manager),
    );
    assert.equal(
      await dataSource.getRepository(ProposalEntity).countBy({
        proposalPublicKey: CHILD_FIRST_PROPOSAL_PUBLIC_KEY,
      }),
      0,
    );

    const createHandler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => "1000000000",
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "2000",
        requiredApprovalBp: "5100",
        requiredParticipation: "4",
      }),
    });
    await dataSource.transaction(
      async (manager) =>
        await createHandler.tryHandle(buildProposalCreatedEvent(), manager),
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: CHILD_FIRST_PROPOSAL_PUBLIC_KEY,
    });
    assert.equal(proposal?.isPaused, true);
  });

  it("decodes field-encoded proposalPauseToggled events directly", async () => {
    const { event, proposalPublicKey } =
      buildFieldEncodedProposalPauseToggledEvent(true);
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 3,
      amount: "1000",
      recipient: "recipient-public-key-2",
      zkAppUriHash: "555",
      status: "pending",
      paidOutAmount: "0",
      contents: null,
      createdAtBlockHeight: 89,
      createdAtBlockTimestamp: new Date(),
    });

    const handler = new ProposalPauseToggledEventHandler();
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey,
    });
    assert.equal(proposal?.isPaused, true);
  });

  it("rejects a compatibility pause value that is not a contract Bool", async () => {
    const event = buildProposalPauseToggledEvent(true);
    event.rawEventData = {
      ...(event.rawEventData as object),
      paused: 1,
    } as never;
    const handler = new ProposalPauseToggledEventHandler();

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

  it("rejects a field-encoded pause value that is not a contract Bool", async () => {
    const { event } = buildFieldEncodedProposalPauseToggledEvent(true);
    (event.rawEventData as { data: string[] }).data[2] = "2";
    const handler = new ProposalPauseToggledEventHandler();

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
});
