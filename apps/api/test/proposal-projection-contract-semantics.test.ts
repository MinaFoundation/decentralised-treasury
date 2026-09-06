import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import {
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { DataSource } from "typeorm";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalProjectionReplayEntity } from "../src/processors/proposals/proposal-projection-replay-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

type FactStatus = "pending" | "canonical" | "orphaned";

function archiveEvent(input: {
  id: string;
  changeSequence: string;
  eventType: string;
  status?: FactStatus;
  blockHeight: number;
  blockEventIndex?: number;
}): ArchiveEventEntity {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  const result = new ArchiveEventEntity();
  result.id = input.id;
  result.changeSequence = input.changeSequence;
  result.status = input.status ?? "canonical";
  result.pendingSeenAtHeight = null;
  result.blockHeight = input.blockHeight;
  result.blockTimestamp = timestamp;
  result.globalSlotSinceGenesis = null;
  result.stateHash = null;
  result.parentHash = null;
  result.chainStatus = null;
  result.eventType = input.eventType;
  result.txHash = `tx-${input.id}`;
  result.accountUpdateId = input.id;
  result.accountUpdateIndex = 0;
  result.eventIndex = 0;
  result.blockEventIndex = input.blockEventIndex ?? 0;
  result.rawEventData = {} as never;
  result.indexedAt = timestamp;
  result.updatedAt = timestamp;
  return result;
}

async function insertProposal(
  dataSource: DataSource,
  proposalPublicKey: string,
  criteria: {
    requiredParticipation?: string | null;
    requiredApprovalBp?: string | null;
  } = {},
): Promise<void> {
  await dataSource.getRepository(ProposalEntity).insert({
    proposalPublicKey,
    lifecycleId: 2,
    amount: "500",
    recipient: "recipient",
    senderPublicKey: "sender",
    zkAppUriHash: "123",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "1000",
    requiredParticipationBp: "2000",
    requiredApprovalBp:
      criteria.requiredApprovalBp === undefined
        ? "5100"
        : criteria.requiredApprovalBp,
    requiredParticipation:
      criteria.requiredParticipation === undefined
        ? "200"
        : criteria.requiredParticipation,
    status: "canonical",
    contractStatus: "unknown",
    contractStatusFinality: "canonical",
    creationObservationStatus: "canonical",
    isPaused: false,
    paidOutAmount: "0",
    contents: null,
    createdAtBlockHeight: 1,
    createdAtBlockTimestamp: new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function record(
  dataSource: DataSource,
  reconciler: ProposalProjectionReconciler,
  source: ArchiveEventEntity,
  payload: Record<string, unknown> & { proposalPublicKey: string },
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await reconciler.recordAndReconcile(
      source,
      source.eventType,
      payload,
      manager,
    );
  });
}

describe("proposal projection contract semantics", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
      ProposalProjectionReplayEntity,
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

  it("keeps the newer fact after a stale conditional upsert and post-upsert read", async () => {
    const proposalPublicKey = "conditional-upsert";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);

    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "fact-1",
        changeSequence: "10",
        eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        blockHeight: 10,
      }),
      { proposalPublicKey, paused: true, senderPublicKey: "canonical-sender" },
    );
    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "fact-1",
        changeSequence: "9",
        eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        status: "orphaned",
        blockHeight: 9,
      }),
      { proposalPublicKey, paused: false, senderPublicKey: "stale-sender" },
    );

    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: "fact-1" });
    assert.equal(String(fact.changeSequence), "10");
    assert.equal(fact.status, "canonical");
    assert.equal(
      (fact.decodedPayload as { senderPublicKey: string }).senderPublicKey,
      "canonical-sender",
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).isPaused,
      true,
    );
  });

  it("accepts an identical equal-sequence replay and rejects a conflicting replay", async () => {
    const proposalPublicKey = "equal-sequence-conflict";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);
    const source = archiveEvent({
      id: "equal-fact",
      changeSequence: "10",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      blockHeight: 10,
    });
    const payload = {
      proposalPublicKey,
      paused: true,
      senderPublicKey: "sender",
    };

    await record(dataSource, reconciler, source, payload);
    await record(dataSource, reconciler, source, payload);
    await assert.rejects(
      record(
        dataSource,
        reconciler,
        { ...source, status: "orphaned" } as ArchiveEventEntity,
        payload,
      ),
      /conflicting fact observation/,
    );
    await assert.rejects(
      record(
        dataSource,
        reconciler,
        {
          ...source,
          blockEventIndex: source.blockEventIndex + 1,
        } as ArchiveEventEntity,
        payload,
      ),
      /conflicting fact observation.*blockEventIndex/,
    );
    await assert.rejects(
      record(
        dataSource,
        reconciler,
        {
          ...source,
          txHash: "different-transaction",
        } as ArchiveEventEntity,
        payload,
      ),
      /conflicting fact observation.*txHash/,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .findOneByOrFail({ archiveEventId: source.id })
      ).status,
      "canonical",
    );
  });

  it("applies pending effects, preserves them on promotion, and rolls them back on orphaning", async () => {
    const proposalPublicKey = "pending-current-view";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 11n,
      calculateVoteResult: async () => "rejected",
    });
    await insertProposal(dataSource, proposalPublicKey);

    const votePayload = {
      proposalPublicKey,
      voterPublicKey: "voter",
      vote: "yay",
      senderPublicKey: "sender",
    };
    const voteEvent = archiveEvent({
      id: "current-vote",
      changeSequence: "1",
      eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      status: "pending",
      blockHeight: 2,
    });
    await record(dataSource, reconciler, voteEvent, votePayload);
    const pendingVote = await dataSource
      .getRepository(VoteEntity)
      .findOneByOrFail({ archiveEventId: voteEvent.id });
    assert.equal(pendingVote.status, "pending");
    assert.equal(pendingVote.voteWeight, "11");
    assert.equal(pendingVote.isNullified, false);
    assert.equal(
      (
        await dataSource
          .getRepository(VoteNullifierEntity)
          .findOneByOrFail({ proposalPublicKey, voterPublicKey: "voter" })
      ).sourceEventId,
      voteEvent.id,
    );
    const pendingRunningTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 2 });
    assert.equal(pendingRunningTally.yayWeight, "11");
    assert.equal(pendingRunningTally.sourceStatus, "pending");

    voteEvent.status = "canonical";
    voteEvent.changeSequence = "2";
    await record(dataSource, reconciler, voteEvent, votePayload);
    const promotedVote = await dataSource
      .getRepository(VoteEntity)
      .findOneByOrFail({ archiveEventId: voteEvent.id });
    assert.equal(promotedVote.status, "canonical");
    assert.equal(promotedVote.voteWeight, pendingVote.voteWeight);
    assert.equal(promotedVote.isNullified, pendingVote.isNullified);
    assert.equal(
      (
        await dataSource
          .getRepository(VoteTallyEntity)
          .findOneByOrFail({ proposalPublicKey, blockHeight: 2 })
      ).yayWeight,
      pendingRunningTally.yayWeight,
    );

    voteEvent.status = "orphaned";
    voteEvent.changeSequence = "3";
    await record(dataSource, reconciler, voteEvent, votePayload);
    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(VoteTallyEntity)
        .countBy({ proposalPublicKey }),
      0,
    );

    const tallyPayload = {
      proposalPublicKey,
      lifecycleId: 2,
      yayWeight: "1000",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: "sender",
    };
    const tallyEvent = archiveEvent({
      id: "current-tally",
      changeSequence: "4",
      eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      status: "pending",
      blockHeight: 3,
    });
    await record(dataSource, reconciler, tallyEvent, tallyPayload);
    let proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "pending");
    const pendingFinalTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: tallyEvent.id });
    assert.equal(pendingFinalTally.sourceStatus, "pending");

    tallyEvent.status = "canonical";
    tallyEvent.changeSequence = "5";
    await record(dataSource, reconciler, tallyEvent, tallyPayload);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "canonical");
    const promotedFinalTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: tallyEvent.id });
    assert.equal(promotedFinalTally.yayWeight, pendingFinalTally.yayWeight);
    assert.equal(promotedFinalTally.voteResult, pendingFinalTally.voteResult);
    assert.equal(promotedFinalTally.sourceStatus, "canonical");

    const executionPayload = {
      proposalPublicKey,
      recipient: "recipient",
      amountToPayOut: "550",
      senderPublicKey: "sender",
    };
    const executionEvent = archiveEvent({
      id: "current-execution",
      changeSequence: "6",
      eventType: PROPOSAL_EXECUTED_EVENT_NAME,
      status: "pending",
      blockHeight: 4,
    });
    await record(dataSource, reconciler, executionEvent, executionPayload);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.paidOutAmount, "550");
    const pendingExecution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneByOrFail({ archiveEventId: executionEvent.id });
    assert.equal(pendingExecution.paidOutAmount, "550");
    assert.equal(pendingExecution.remainingAmount, "0");

    executionEvent.status = "canonical";
    executionEvent.changeSequence = "7";
    await record(dataSource, reconciler, executionEvent, executionPayload);
    const promotedExecution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneByOrFail({ archiveEventId: executionEvent.id });
    assert.equal(
      promotedExecution.paidOutAmount,
      pendingExecution.paidOutAmount,
    );
    assert.equal(
      promotedExecution.remainingAmount,
      pendingExecution.remainingAmount,
    );

    executionEvent.status = "orphaned";
    executionEvent.changeSequence = "8";
    await record(dataSource, reconciler, executionEvent, executionPayload);
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).paidOutAmount,
      "0",
    );

    const pausePayload = {
      proposalPublicKey,
      paused: true,
      senderPublicKey: "sender",
    };
    const pauseEvent = archiveEvent({
      id: "current-pause",
      changeSequence: "9",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      status: "pending",
      blockHeight: 5,
    });
    await record(dataSource, reconciler, pauseEvent, pausePayload);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.isPaused, true);
    assert.equal(proposal.contractStatus, "paused");

    pauseEvent.status = "canonical";
    pauseEvent.changeSequence = "10";
    await record(dataSource, reconciler, pauseEvent, pausePayload);
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).isPaused,
      true,
    );

    pauseEvent.status = "orphaned";
    pauseEvent.changeSequence = "11";
    await record(dataSource, reconciler, pauseEvent, pausePayload);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.isPaused, false);
    assert.equal(proposal.contractStatus, "approved");

    tallyEvent.status = "orphaned";
    tallyEvent.changeSequence = "12";
    await record(dataSource, reconciler, tallyEvent, tallyPayload);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "unknown");
    assert.equal(
      await dataSource
        .getRepository(VoteTallyEntity)
        .countBy({ proposalPublicKey }),
      0,
    );
  });

  it("uses the first active vote regardless of pending or canonical status", async () => {
    const proposalPublicKey = "active-vote-order";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 11n,
      calculateVoteResult: async () => "rejected",
    });
    await insertProposal(dataSource, proposalPublicKey);

    for (const [id, status, blockHeight] of [
      ["pending-owner", "pending", 2],
      ["canonical-owner", "canonical", 3],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence: String(blockHeight),
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          status,
          blockHeight,
        }),
        {
          proposalPublicKey,
          voterPublicKey: "same-voter",
          vote: "yay",
          senderPublicKey: "sender",
        },
      );
    }

    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "same-voter" });
    assert.equal(nullifier.sourceEventId, "pending-owner");
    assert.equal(nullifier.voteWeight, "11");
    const pendingVote = await dataSource
      .getRepository(VoteEntity)
      .findOneByOrFail({ archiveEventId: "pending-owner" });
    assert.equal(pendingVote.voteWeight, "11");
    assert.equal(pendingVote.isNullified, false);
    const canonicalVote = await dataSource
      .getRepository(VoteEntity)
      .findOneByOrFail({ archiveEventId: "canonical-owner" });
    assert.equal(canonicalVote.voteWeight, "0");
    assert.equal(canonicalVote.isNullified, true);
  });

  it("uses contract event order for same-block duplicate votes", async () => {
    const proposalPublicKey = "same-block-source-order-limit";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 13n,
      calculateVoteResult: async () => "rejected",
    });
    await insertProposal(dataSource, proposalPublicKey);

    for (const [id, blockEventIndex] of [
      ["higher-index-first-arrival", 9],
      ["lower-index-later-arrival", 2],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence: String(20 + blockEventIndex),
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          status: "pending",
          blockHeight: 20,
          blockEventIndex,
        }),
        {
          proposalPublicKey,
          voterPublicKey: "same-voter",
          vote: "yay",
          senderPublicKey: "sender",
        },
      );
    }

    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey, voterPublicKey: "same-voter" }),
      1,
    );
    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "same-voter" });
    assert.equal(nullifier.sourceEventId, "lower-index-later-arrival");
    const votes = await dataSource
      .getRepository(VoteEntity)
      .findBy({ proposalPublicKey });
    assert.equal(votes.length, 2);
    assert.deepEqual(
      new Map(
        votes.map((vote) => [
          vote.archiveEventId,
          { isNullified: vote.isNullified, voteWeight: vote.voteWeight },
        ]),
      ),
      new Map([
        ["lower-index-later-arrival", { isNullified: false, voteWeight: "13" }],
        ["higher-index-first-arrival", { isNullified: true, voteWeight: "0" }],
      ]),
    );
    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 20 });
    assert.equal(tally.yayWeight, "13");
    assert.equal(tally.totalParticipatingVotes, "13");

    for (const [id, blockEventIndex, changeSequence] of [
      ["higher-index-first-arrival", 0, "100"],
      ["lower-index-later-arrival", 10, "101"],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence,
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          status: "canonical",
          blockHeight: 20,
          blockEventIndex,
        }),
        {
          proposalPublicKey,
          voterPublicKey: "same-voter",
          vote: "yay",
          senderPublicKey: "sender",
        },
      );
    }

    const promotedNullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "same-voter" });
    assert.equal(
      promotedNullifier.sourceEventId,
      "lower-index-later-arrival",
      "promotion must not change nullifier ownership",
    );
    const promotedFacts = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findBy({ proposalPublicKey });
    assert.deepEqual(
      new Map(
        promotedFacts.map((fact) => [
          fact.archiveEventId,
          fact.blockEventIndex,
        ]),
      ),
      new Map([
        ["higher-index-first-arrival", 9],
        ["lower-index-later-arrival", 2],
      ]),
    );
  });

  it("uses contract event order for mixed-label same-block votes", async () => {
    const proposalPublicKey = "same-block-mixed-label-limit";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 13n,
      calculateVoteResult: async () => "rejected",
    });
    await insertProposal(dataSource, proposalPublicKey);

    for (const [id, vote, blockEventIndex] of [
      ["mixed-yay", "yay", 8],
      ["mixed-nay", "nay", 1],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence: String(30 + blockEventIndex),
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 21,
          blockEventIndex,
        }),
        {
          proposalPublicKey,
          voterPublicKey: "same-voter",
          vote,
          senderPublicKey: "sender",
        },
      );
    }

    assert.equal(
      await dataSource.getRepository(VoteTallyEntity).countBy({
        proposalPublicKey,
        createdByEventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      }),
      1,
    );
    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "same-voter" });
    assert.equal(nullifier.sourceEventId, "mixed-nay");
    const votes = await dataSource
      .getRepository(VoteEntity)
      .findBy({ proposalPublicKey });
    assert.deepEqual(
      new Map(
        votes.map((vote) => [
          vote.archiveEventId,
          { isNullified: vote.isNullified, voteWeight: vote.voteWeight },
        ]),
      ),
      new Map([
        ["mixed-nay", { isNullified: false, voteWeight: "13" }],
        ["mixed-yay", { isNullified: true, voteWeight: "0" }],
      ]),
    );
    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 21 });
    assert.equal(tally.yayWeight, "0");
    assert.equal(tally.nayWeight, "13");
  });

  it("validates a final tally from its payload and exact persisted BigInt criteria", async () => {
    const proposalPublicKey = "payload-local-bigint-tally";
    const requiredParticipation = "9007199254740993";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 3n,
      calculateVoteResult: async () => "rejected",
    });
    await insertProposal(dataSource, proposalPublicKey, {
      requiredParticipation,
      requiredApprovalBp: "5100",
    });

    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "final-before-vote-arrival",
        changeSequence: "2",
        eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        blockHeight: 30,
      }),
      {
        proposalPublicKey,
        lifecycleId: 2,
        yayWeight: requiredParticipation,
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: "sender",
      },
    );
    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "earlier-vote-later-arrival",
        changeSequence: "3",
        eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        blockHeight: 20,
      }),
      {
        proposalPublicKey,
        voterPublicKey: "late-source-fact-voter",
        vote: "nay",
        senderPublicKey: "sender",
      },
    );

    const finalTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: "final-before-vote-arrival" });
    assert.equal(finalTally.totalParticipatingVotes, requiredParticipation);
    assert.equal(finalTally.approvalBp, "10000");
    assert.equal(finalTally.voteResult, "approved");

    await assert.rejects(
      record(
        dataSource,
        reconciler,
        archiveEvent({
          id: "zero-decisive-approved",
          changeSequence: "4",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          blockHeight: 40,
        }),
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "0",
          nayWeight: "0",
          abstainWeight: requiredParticipation,
          voteResult: "approved",
          senderPublicKey: "sender",
        },
      ),
      /final tally has no decisive votes/,
    );
    const insufficientProposalPublicKey = "insufficient-bigint-participation";
    await insertProposal(dataSource, insufficientProposalPublicKey, {
      requiredParticipation,
      requiredApprovalBp: "5100",
    });
    await assert.rejects(
      record(
        dataSource,
        reconciler,
        archiveEvent({
          id: "insufficient-participation",
          changeSequence: "5",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          blockHeight: 50,
        }),
        {
          proposalPublicKey: insufficientProposalPublicKey,
          lifecycleId: 2,
          yayWeight: "9007199254740992",
          nayWeight: "0",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
      ),
      /is below requiredParticipation=9007199254740993/,
    );
  });

  it("keeps an authoritative canonical tally when local criteria are unavailable", async () => {
    const proposalPublicKey = "unavailable-local-criteria";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey, {
      requiredParticipation: null,
      requiredApprovalBp: null,
    });

    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "proof-derived-tally",
        changeSequence: "1",
        eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        blockHeight: 20,
      }),
      {
        proposalPublicKey,
        lifecycleId: 2,
        yayWeight: "1",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: "sender",
      },
    );

    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: "proof-derived-tally" });
    assert.equal(tally.sourceStatus, "canonical");
    assert.equal(tally.voteResult, "approved");
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).contractStatus,
      "approved",
    );
  });

  it("retains a later execution until its earlier source tally arrives", async () => {
    const proposalPublicKey = "out-of-order-contract-events";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);

    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "execution-arrives-first",
        changeSequence: "1",
        eventType: PROPOSAL_EXECUTED_EVENT_NAME,
        blockHeight: 50,
      }),
      {
        proposalPublicKey,
        recipient: "recipient",
        amountToPayOut: "550",
        senderPublicKey: "sender",
      },
    );
    await record(
      dataSource,
      reconciler,
      archiveEvent({
        id: "earlier-tally-arrives-later",
        changeSequence: "2",
        eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        blockHeight: 40,
      }),
      {
        proposalPublicKey,
        lifecycleId: 2,
        yayWeight: "200",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: "sender",
      },
    );

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.paidOutAmount, "550");
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      2,
    );
  });

  it("uses contract event order for same-height contract status", async () => {
    const proposalPublicKey = "ordered-status-facts";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);

    for (const [id, eventType, blockEventIndex, payload] of [
      [
        "unordered-tally",
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        99,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "200",
          nayWeight: "0",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
      ],
      [
        "unordered-pause-a",
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        1,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
      ],
      [
        "unordered-pause-b",
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        0,
        { proposalPublicKey, paused: false, senderPublicKey: "sender" },
      ],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence: String(blockEventIndex + 1),
          eventType,
          blockHeight: 40,
          blockEventIndex,
        }),
        payload,
      );
    }

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "canonical");
    assert.equal(proposal.contractStatusSourceEventId, "unordered-tally");
    assert.equal(proposal.contractStatusBlockHeight, 40);
    assert.equal(proposal.isPaused, false);
  });

  it("uses the latest observed contract tally as the current status", async () => {
    const proposalPublicKey = "consecutive-observed-tallies";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);

    for (const [id, blockHeight] of [
      ["first-tally", 40],
      ["second-tally", 41],
    ] as const) {
      await record(
        dataSource,
        reconciler,
        archiveEvent({
          id,
          changeSequence: String(blockHeight),
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          blockHeight,
        }),
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "200",
          nayWeight: "0",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
      );
    }

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "canonical");
    assert.equal(proposal.contractStatusSourceEventId, "second-tally");
  });

  it("keeps replay collecting when a canonical child has no canonical creation", async () => {
    const proposalPublicKey = "replay-child-without-creation";
    const source = archiveEvent({
      id: "701",
      changeSequence: "1",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      blockHeight: 2,
    });
    const payload = {
      proposalPublicKey,
      paused: true,
      senderPublicKey: "sender",
    };
    await dataSource.getRepository(ArchiveEventEntity).insert(source);
    await dataSource.getRepository(ProposalEventFactEntity).insert({
      archiveEventId: source.id,
      changeSequence: source.changeSequence,
      eventType: source.eventType,
      proposalPublicKey,
      status: source.status,
      blockHeight: source.blockHeight,
      blockTimestamp: source.blockTimestamp,
      globalSlotSinceGenesis: null,
      stateHash: null,
      parentHash: null,
      chainStatus: null,
      blockEventIndex: source.blockEventIndex,
      txHash: source.txHash,
      decodedPayload: payload,
      updatedAt: source.updatedAt,
    });
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "1",
      state: "collecting",
      completedAt: null,
    });

    await assert.rejects(
      record(dataSource, new ProposalProjectionReconciler(), source, payload),
      /without a canonical creation/,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalProjectionReplayEntity)
          .findOneByOrFail({ projectionName: "proposal" })
      ).state,
      "collecting",
    );
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      1,
    );
  });
});
