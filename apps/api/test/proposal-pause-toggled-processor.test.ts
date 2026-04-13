import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { Bool, PrivateKey } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalPauseToggledEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildProposalPauseToggledEvent(
  paused: boolean,
  status: "pending" | "canonical" | "orphaned" = "canonical",
): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = paused ? "pause-event" : "unpause-event";
  event.status = status;
  event.pendingSeenAtHeight = null;
  event.blockHeight = 88;
  event.blockTimestamp = now;
  event.eventType = "proposalPauseToggled";
  event.txHash = paused ? "tx-proposal-pause" : "tx-proposal-unpause";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: "proposal-public-key-1",
    paused,
    senderPublicKey: "sender-public-key-1",
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildFieldEncodedProposalPauseToggledEvent(
  paused: boolean,
): { event: ArchiveEventEntity; proposalPublicKey: string } {
  const now = new Date();
  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const payload = new ProposalPauseToggledEvent({
    proposalPublicKey,
    paused: Bool(paused),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  const event = new ArchiveEventEntity();
  event.id = "pause-field-event";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 89;
  event.blockTimestamp = now;
  event.eventType = "proposalPauseToggled";
  event.txHash = "tx-proposal-pause-field";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.rawEventData = {
    data: ProposalPauseToggledEvent.toFields(payload).map((field) => field.toString()),
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
        async (manager) => await handler.tryHandle(buildProposalPauseToggledEvent(true), manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: "proposal-public-key-1",
    });
    assert.equal(proposal?.status, "unknown");
    assert.equal(proposal?.isPaused, true);
  });

  it("reverts the paused flag on orphaned pause toggle events", async () => {
    const handler = new ProposalPauseToggledEventHandler();

    await dataSource.getRepository(ProposalEntity).update(
      { proposalPublicKey: "proposal-public-key-1" },
      { status: "approved", isPaused: true },
    );

    assert.equal(
      await dataSource.transaction(
        async (manager) =>
          await handler.tryHandle(buildProposalPauseToggledEvent(true, "orphaned"), manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: "proposal-public-key-1",
    });
    assert.equal(proposal?.status, "approved");
    assert.equal(proposal?.isPaused, false);
  });

  it("decodes field-encoded proposalPauseToggled events directly", async () => {
    const { event, proposalPublicKey } = buildFieldEncodedProposalPauseToggledEvent(true);
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
});
