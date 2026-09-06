import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { ProcessorOffsetEntity } from "@repo/processor";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { PrivateKey, PublicKey } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalContentEntity } from "../src/processors/proposals/proposal-content-entity.js";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import {
  ProposalProjectionReplayEntity,
  rewindProposalProjectionReplay,
} from "../src/processors/proposals/proposal-projection-replay-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const HANDLER_PROPOSAL_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const HANDLER_RECIPIENT_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const HANDLER_SENDER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();
const HANDLER_VOTER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();

function event(input: {
  id: string;
  changeSequence: string;
  eventType: string;
  proposalPublicKey: string;
  status?: "pending" | "canonical" | "orphaned";
  blockHeight?: number;
  blockEventIndex?: number;
  stateHash?: string | null;
  parentHash?: string | null;
  payload?: Record<string, unknown>;
}): ArchiveEventEntity {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const result = new ArchiveEventEntity();
  result.id = input.id;
  result.changeSequence = input.changeSequence;
  result.status = input.status ?? "canonical";
  result.pendingSeenAtHeight = null;
  result.blockHeight = input.blockHeight ?? Number(input.changeSequence);
  result.blockTimestamp = now;
  result.globalSlotSinceGenesis = null;
  result.stateHash = input.stateHash ?? null;
  result.parentHash = input.parentHash ?? null;
  result.chainStatus = null;
  result.eventType = input.eventType;
  result.txHash = `tx-${input.id}`;
  result.accountUpdateId = input.id;
  result.accountUpdateIndex = 0;
  result.eventIndex = 0;
  result.blockEventIndex = input.blockEventIndex ?? 0;
  result.rawEventData = {
    proposalPublicKey: input.proposalPublicKey,
    ...input.payload,
  } as never;
  result.indexedAt = now;
  result.updatedAt = now;
  return result;
}

async function insertProposal(
  dataSource: DataSource,
  proposalPublicKey: string,
  isPaused = false,
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
    requiredApprovalBp: "5100",
    requiredParticipation: "200",
    status: "canonical",
    isPaused,
    paidOutAmount: "0",
    contents: null,
    createdAtBlockHeight: 1,
    createdAtBlockTimestamp: new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function recordCanonicalCreation(
  dataSource: DataSource,
  reconciler: ProposalProjectionReconciler,
  proposalPublicKey: string,
  amount = "500",
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await reconciler.recordAndReconcile(
      event({
        id: `creation-${proposalPublicKey}`,
        changeSequence: "1",
        eventType: PROPOSAL_CREATED_EVENT_NAME,
        proposalPublicKey,
        blockHeight: 1,
      }),
      PROPOSAL_CREATED_EVENT_NAME,
      {
        proposalPublicKey,
        lifecycleId: 2,
        amount,
        recipient: "recipient",
        zkAppUriHash: "123",
        stakingEpochDataLedgerHash: "999",
        stakingEpochDataLedgerTotalCurrency: "1000",
        requiredParticipationBp: "2000",
        requiredApprovalBp: "5100",
        requiredParticipation: "200",
        senderPublicKey: "sender",
      },
      manager,
    );
  });
}

describe("proposal projection contract fidelity", () => {
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

  it("preserves legacy projections while replay collects, then removes rows without creation facts", async () => {
    await insertProposal(dataSource, "legacy-proposal", true);
    await dataSource.getRepository(VoteTallyEntity).insert({
      archiveEventId: null,
      proposalPublicKey: "legacy-proposal",
      blockHeight: 9,
      yayWeight: "7",
      nayWeight: "0",
      abstainWeight: "0",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "200",
      totalParticipatingVotes: "7",
      approvalBp: "10000",
      voteResult: "rejected",
      createdByEventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    });
    await dataSource.getRepository(VoteEntity).insert({
      archiveEventId: "legacy-vote",
      proposalPublicKey: "legacy-proposal",
      voterPublicKey: "legacy-voter",
      vote: "yay",
      voteWeight: "7",
      blockHeight: 9,
      isNullified: false,
      status: "canonical",
    });
    const replayCreationEvent = event({
      id: "create-new",
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
      payload: {
        lifecycleId: 2,
        amount: "500",
        recipient: HANDLER_RECIPIENT_PUBLIC_KEY,
        zkAppUriHash: "123",
        stakingEpochDataLedgerHash: "999",
        stakingEpochDataLedgerTotalCurrency: "1000",
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
    });
    const replayPauseEvent = event({
      id: "pause-new",
      changeSequence: "2",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
      payload: {
        paused: false,
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
    });
    await dataSource
      .getRepository(ArchiveEventEntity)
      .insert([replayCreationEvent, replayPauseEvent]);
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "2",
      state: "collecting",
      completedAt: null,
    });

    const reconciler = new ProposalProjectionReconciler();
    const createHandler = new ProposalCreatedEventHandler(
      {
        resolveTreasuryBalanceForLifecycle: async () => "1000",
        deriveAcceptanceCriteria: async () => ({
          requiredParticipationBp: "2000",
          requiredApprovalBp: "5100",
          requiredParticipation: "200",
        }),
      },
      reconciler,
    );
    await dataSource.transaction(async (manager) => {
      await createHandler.tryHandle(replayCreationEvent, manager);
    });

    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(VoteEntity)
        .countBy({ proposalPublicKey: "legacy-proposal" }),
      1,
    );
    assert.equal(
      (
        await dataSource.getRepository(ProposalEntity).findOneByOrFail({
          proposalPublicKey: "legacy-proposal",
        })
      ).isPaused,
      true,
    );

    const pauseHandler = new ProposalPauseToggledEventHandler(reconciler);
    await dataSource.transaction(async (manager) => {
      await pauseHandler.tryHandle(replayPauseEvent, manager);
    });

    assert.equal(
      (
        await dataSource.getRepository(ProposalEntity).findOneByOrFail({
          proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
        })
      ).isPaused,
      true,
    );
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: "legacy-proposal" }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(VoteEntity)
        .countBy({ proposalPublicKey: "legacy-proposal" }),
      0,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalProjectionReplayEntity)
          .findOneByOrFail({ projectionName: "proposal" })
      ).state,
      "complete",
    );
  });

  it("does not complete replay when an archive event fact is missing", async () => {
    const proposalPublicKey = HANDLER_PROPOSAL_PUBLIC_KEY;
    const createEvent = event({
      id: "101",
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey,
      payload: {
        lifecycleId: 2,
        amount: "500",
        recipient: HANDLER_RECIPIENT_PUBLIC_KEY,
        zkAppUriHash: "123",
        stakingEpochDataLedgerHash: "999",
        stakingEpochDataLedgerTotalCurrency: "1000",
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
    });
    const missingEvent = event({
      id: "102",
      changeSequence: "2",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      payload: { paused: true, senderPublicKey: HANDLER_SENDER_PUBLIC_KEY },
    });
    const targetEvent = event({
      id: "103",
      changeSequence: "3",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      payload: { paused: false, senderPublicKey: HANDLER_SENDER_PUBLIC_KEY },
    });
    await dataSource
      .getRepository(ArchiveEventEntity)
      .insert([createEvent, missingEvent, targetEvent]);
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "3",
      state: "collecting",
      completedAt: null,
    });

    const reconciler = new ProposalProjectionReconciler();
    const createHandler = new ProposalCreatedEventHandler(
      {
        resolveTreasuryBalanceForLifecycle: async () => "1000",
        deriveAcceptanceCriteria: async () => ({
          requiredParticipationBp: "2000",
          requiredApprovalBp: "5100",
          requiredParticipation: "200",
        }),
      },
      reconciler,
    );
    const pauseHandler = new ProposalPauseToggledEventHandler(reconciler);
    await dataSource.transaction(async (manager) => {
      assert.equal(await createHandler.tryHandle(createEvent, manager), true);
    });
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await pauseHandler.tryHandle(targetEvent, manager);
      }),
      /projection replay is missing 1 archive event fact/,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalProjectionReplayEntity)
          .findOneByOrFail({ projectionName: "proposal" })
      ).state,
      "collecting",
    );

    await dataSource.transaction(async (manager) => {
      await pauseHandler.tryHandle(missingEvent, manager);
    });
    await dataSource.transaction(async (manager) => {
      await pauseHandler.tryHandle(targetEvent, manager);
    });
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalProjectionReplayEntity)
          .findOneByOrFail({ projectionName: "proposal" })
      ).state,
      "complete",
    );
  });

  it("keeps replay incomplete when a creation event changes to a canonical child", async () => {
    const proposalPublicKey = HANDLER_PROPOSAL_PUBLIC_KEY;
    await insertProposal(dataSource, proposalPublicKey);
    const changedEvent = event({
      id: "201",
      changeSequence: "2",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      payload: { paused: true, senderPublicKey: HANDLER_SENDER_PUBLIC_KEY },
    });
    await dataSource.getRepository(ArchiveEventEntity).insert(changedEvent);
    await dataSource.getRepository(ProposalEventFactEntity).insert({
      archiveEventId: changedEvent.id,
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey,
      status: "canonical",
      blockHeight: 1,
      blockTimestamp: changedEvent.blockTimestamp,
      globalSlotSinceGenesis: null,
      stateHash: null,
      parentHash: null,
      chainStatus: null,
      blockEventIndex: 0,
      txHash: changedEvent.txHash,
      decodedPayload: {
        proposalPublicKey,
        lifecycleId: 2,
        amount: "500",
        recipient: HANDLER_RECIPIENT_PUBLIC_KEY,
        zkAppUriHash: "123",
        stakingEpochDataLedgerHash: "999",
        stakingEpochDataLedgerTotalCurrency: "1000",
        requiredParticipationBp: "2000",
        requiredApprovalBp: "5100",
        requiredParticipation: "200",
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
      updatedAt: changedEvent.updatedAt,
    });
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "2",
      state: "collecting",
      completedAt: null,
    });

    const handler = new ProposalPauseToggledEventHandler(
      new ProposalProjectionReconciler(),
    );
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await handler.tryHandle(changedEvent, manager);
      }),
      /without a canonical creation/,
    );

    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey }),
      1,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalProjectionReplayEntity)
          .findOneByOrFail({ projectionName: "proposal" })
      ).state,
      "collecting",
    );
  });

  it("rewinds only the active runtime processor while proposal replay collects", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "10",
      state: "collecting",
      completedAt: null,
    });
    await dataSource.getRepository(ProcessorOffsetEntity).insert([
      {
        processorName: "migration-name-a",
        lastSeenUpdatedAt: timestamp,
        lastSeenEventId: "10",
        lastSeenChangeSequence: "10",
      },
      {
        processorName: "runtime-name-b",
        lastSeenUpdatedAt: timestamp,
        lastSeenEventId: "10",
        lastSeenChangeSequence: "10",
      },
      {
        processorName: "unrelated-processor",
        lastSeenUpdatedAt: timestamp,
        lastSeenEventId: "10",
        lastSeenChangeSequence: "10",
      },
    ]);

    await dataSource.transaction(async (manager) => {
      await rewindProposalProjectionReplay(manager, "runtime-name-b");
    });

    const offsets = await dataSource.getRepository(ProcessorOffsetEntity).find({
      order: { processorName: "ASC" },
    });
    assert.deepEqual(
      offsets.map(({ processorName, lastSeenChangeSequence }) => ({
        processorName,
        lastSeenChangeSequence,
      })),
      [
        {
          processorName: "migration-name-a",
          lastSeenChangeSequence: "10",
        },
        {
          processorName: "runtime-name-b",
          lastSeenChangeSequence: "0",
        },
        {
          processorName: "unrelated-processor",
          lastSeenChangeSequence: "10",
        },
      ],
    );
  });

  it("derives pause state from surviving toggle parity and ignores payload values", async () => {
    await insertProposal(dataSource, HANDLER_PROPOSAL_PUBLIC_KEY);
    const handler = new ProposalPauseToggledEventHandler(
      new ProposalProjectionReconciler(),
    );
    for (const [id, sequence] of [
      ["toggle-one", "1"],
      ["toggle-two", "2"],
    ] as const) {
      await dataSource.transaction(async (manager) => {
        await handler.tryHandle(
          event({
            id,
            changeSequence: sequence,
            eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
            proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
            payload: {
              paused: false,
              senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
            },
          }),
          manager,
        );
      });
    }
    assert.equal(
      (
        await dataSource.getRepository(ProposalEntity).findOneByOrFail({
          proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
        })
      ).isPaused,
      false,
    );
  });

  it("preserves content across an orphaned creation and restores only the matching contract hash", async () => {
    const proposalPublicKey = "content-reorg-proposal";
    const contents = "# Content that is bound to the contract hash";
    const reconciler = new ProposalProjectionReconciler();
    const createdPayload = {
      proposalPublicKey,
      lifecycleId: 2,
      amount: "500",
      recipient: "recipient",
      zkAppUriHash: "123",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "1000",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "200",
      senderPublicKey: "sender",
    };
    await dataSource.getRepository(ProposalContentEntity).insert({
      proposalPublicKey,
      zkAppUriHash: createdPayload.zkAppUriHash,
      contents,
    });

    const creationEvent = event({
      id: "content-create",
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey,
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        creationEvent,
        PROPOSAL_CREATED_EVENT_NAME,
        createdPayload,
        manager,
      );
    });
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).contents,
      contents,
    );

    creationEvent.status = "orphaned";
    creationEvent.changeSequence = "2";
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        creationEvent,
        PROPOSAL_CREATED_EVENT_NAME,
        createdPayload,
        manager,
      );
    });
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey }),
      0,
    );
    assert.equal(
      (
        await dataSource.getRepository(ProposalContentEntity).findOneByOrFail({
          proposalPublicKey,
          zkAppUriHash: createdPayload.zkAppUriHash,
        })
      ).contents,
      contents,
    );

    creationEvent.status = "canonical";
    creationEvent.changeSequence = "3";
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        creationEvent,
        PROPOSAL_CREATED_EVENT_NAME,
        createdPayload,
        manager,
      );
    });
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).contents,
      contents,
    );

    creationEvent.changeSequence = "4";
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        creationEvent,
        PROPOSAL_CREATED_EVENT_NAME,
        { ...createdPayload, zkAppUriHash: "different-contract-hash" },
        manager,
      );
    });
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).contents,
      null,
    );
  });

  it("does not load a ledger or create a tally for an orphan-only vote", async () => {
    await insertProposal(dataSource, "orphan-vote-proposal");
    let ledgerLookups = 0;
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => {
        ledgerLookups += 1;
        return 9n;
      },
      calculateVoteResult: async () => "rejected",
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "orphan-vote",
          changeSequence: "1",
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          proposalPublicKey: "orphan-vote-proposal",
          status: "orphaned",
          blockHeight: 8,
        }),
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        {
          proposalPublicKey: "orphan-vote-proposal",
          voterPublicKey: "voter",
          vote: "yay",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    assert.equal(ledgerLookups, 0);
    assert.equal(await dataSource.getRepository(VoteTallyEntity).count(), 0);
    assert.equal(
      await dataSource
        .getRepository(VoteEntity)
        .countBy({ archiveEventId: "orphan-vote" }),
      0,
    );
  });

  it("uses contract event order for same-block duplicate votes", async () => {
    const proposalPublicKey = "same-block-first-vote-tie";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 5n,
      calculateVoteResult: async () => "rejected",
    });

    const recordVote = async (
      id: string,
      changeSequence: string,
      voterPublicKey: string,
      blockEventIndex: number,
    ): Promise<void> => {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id,
            changeSequence,
            eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
            proposalPublicKey,
            blockHeight: 10,
            blockEventIndex,
          }),
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey,
            vote: "yay",
            senderPublicKey: "sender",
          },
          manager,
        );
      });
    };

    await recordVote("same-block-voter-a", "1", "voter-a", 0);
    await recordVote("same-block-voter-b", "2", "voter-b", 1);
    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey }),
      2,
    );

    await recordVote("same-block-voter-a-repeat", "3", "voter-a", 2);
    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey, voterPublicKey: "voter-a" }),
      1,
    );
    const voterANullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "voter-a" });
    assert.equal(voterANullifier.sourceEventId, "same-block-voter-a");
    const voterAVotes = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey,
      voterPublicKey: "voter-a",
    });
    assert.deepEqual(
      new Map(
        voterAVotes.map((vote) => [
          vote.archiveEventId,
          { isNullified: vote.isNullified, voteWeight: vote.voteWeight },
        ]),
      ),
      new Map([
        ["same-block-voter-a", { isNullified: false, voteWeight: "5" }],
        ["same-block-voter-a-repeat", { isNullified: true, voteWeight: "0" }],
      ]),
    );
    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 10 });
    assert.equal(tally.yayWeight, "10");
    assert.equal(tally.totalParticipatingVotes, "10");
  });

  it("uses contract event order for pending and canonical same-block votes", async () => {
    const proposalPublicKey = "active-same-block-owner";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 5n,
      calculateVoteResult: async () => "rejected",
    });

    const recordVote = async (
      id: string,
      changeSequence: string,
      status: "pending" | "canonical",
      blockEventIndex: number,
    ): Promise<void> => {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id,
            changeSequence,
            eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
            proposalPublicKey,
            status,
            blockHeight: 10,
            blockEventIndex,
          }),
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey: "shared-voter",
            vote: "yay",
            senderPublicKey: "sender",
          },
          manager,
        );
      });
    };

    await recordVote("higher-index", "1", "pending", 9);
    await recordVote("lower-index", "2", "pending", 2);
    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey, voterPublicKey: "shared-voter" }),
      1,
    );
    let nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "shared-voter" });
    assert.equal(nullifier.sourceEventId, "lower-index");

    await recordVote("higher-index", "3", "canonical", 9);
    nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "shared-voter" });
    assert.equal(nullifier.sourceEventId, "lower-index");

    await recordVote("lower-index", "4", "canonical", 2);
    assert.equal(
      await dataSource
        .getRepository(VoteNullifierEntity)
        .countBy({ proposalPublicKey, voterPublicKey: "shared-voter" }),
      1,
    );
    const votes = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey,
      voterPublicKey: "shared-voter",
    });
    assert.deepEqual(
      new Map(
        votes.map((vote) => [
          vote.archiveEventId,
          { isNullified: vote.isNullified, voteWeight: vote.voteWeight },
        ]),
      ),
      new Map([
        ["lower-index", { isNullified: false, voteWeight: "5" }],
        ["higher-index", { isNullified: true, voteWeight: "0" }],
      ]),
    );
    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 10 });
    assert.equal(tally.yayWeight, "5");
    assert.equal(tally.totalParticipatingVotes, "5");
  });

  it("allows same-block duplicates after an earlier-height vote owns the nullifier", async () => {
    const proposalPublicKey = "later-same-block-duplicates";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 7n,
      calculateVoteResult: async () => "rejected",
    });

    for (const [id, blockHeight, blockEventIndex] of [
      ["earlier-owner", 10, 0],
      ["later-duplicate-a", 11, 0],
      ["later-duplicate-b", 11, 1],
    ] as const) {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id,
            changeSequence: String(blockHeight * 10 + blockEventIndex),
            eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
            proposalPublicKey,
            blockHeight,
            blockEventIndex,
          }),
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey: "shared-voter",
            vote: "yay",
            senderPublicKey: "sender",
          },
          manager,
        );
      });
    }

    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey: "shared-voter" });
    assert.equal(nullifier.sourceEventId, "earlier-owner");
    const votes = await dataSource.getRepository(VoteEntity).find({
      where: { proposalPublicKey },
      order: { blockHeight: "ASC", archiveEventId: "ASC" },
    });
    assert.deepEqual(
      votes.map((vote) => [vote.archiveEventId, vote.isNullified]),
      [
        ["earlier-owner", false],
        ["later-duplicate-a", true],
        ["later-duplicate-b", true],
      ],
    );
  });

  it("does not overwrite a fact with stale pending or orphaned observations", async () => {
    const proposalPublicKey = "stale-observation";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    const canonical = event({
      id: "stable-toggle",
      changeSequence: "10",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      status: "canonical",
      blockHeight: 10,
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        canonical,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
    });

    for (const [changeSequence, status] of [
      ["9", "pending"],
      ["8", "orphaned"],
    ] as const) {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: canonical.id,
            changeSequence,
            eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
            proposalPublicKey,
            status,
            blockHeight: Number(changeSequence),
          }),
          PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          { proposalPublicKey, paused: false, senderPublicKey: "stale-sender" },
          manager,
        );
      });
    }

    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: canonical.id });
    assert.equal(String(fact.changeSequence), "10");
    assert.equal(fact.status, "canonical");
    assert.equal(fact.blockHeight, 10);
    assert.deepEqual(fact.decodedPayload, {
      proposalPublicKey,
      paused: true,
      senderPublicKey: "sender",
    });
    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "paused");
    assert.equal(proposal.isPaused, true);
  });

  it("reconciles both proposal keys when an existing fact moves", async () => {
    await insertProposal(dataSource, "old-proposal");
    await insertProposal(dataSource, "new-proposal");
    const reconciler = new ProposalProjectionReconciler();
    const sourceEvent = event({
      id: "moving-toggle",
      changeSequence: "1",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey: "old-proposal",
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        {
          proposalPublicKey: "old-proposal",
          paused: true,
          senderPublicKey: "sender",
        },
        manager,
      );
    });
    sourceEvent.changeSequence = "2";
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        {
          proposalPublicKey: "new-proposal",
          paused: true,
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    assert.equal(
      (
        await dataSource.getRepository(ProposalEntity).findOneByOrFail({
          proposalPublicKey: "old-proposal",
        })
      ).isPaused,
      false,
    );
    assert.equal(
      (
        await dataSource.getRepository(ProposalEntity).findOneByOrFail({
          proposalPublicKey: "new-proposal",
        })
      ).isPaused,
      true,
    );
  });

  it("applies pending same-height toggles to the current-view pause state", async () => {
    const proposalPublicKey = "same-height-fork";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "same-height-fork-a",
          changeSequence: "1",
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          proposalPublicKey,
          status: "pending",
          blockHeight: 40,
          stateHash: "state-a",
          parentHash: "parent-39",
        }),
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
    });

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "same-height-fork-b",
          changeSequence: "2",
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          proposalPublicKey,
          status: "pending",
          blockHeight: 40,
          stateHash: "state-b",
          parentHash: "parent-39",
        }),
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: false, senderPublicKey: "sender" },
        manager,
      );
    });
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      2,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).isPaused,
      false,
    );
  });

  it("applies pending disconnected toggles to the current-view pause state", async () => {
    const proposalPublicKey = "disconnected-branch";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "branch-height-50",
          changeSequence: "1",
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          proposalPublicKey,
          status: "pending",
          blockHeight: 50,
          stateHash: "state-50",
          parentHash: "state-49",
        }),
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
    });

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "branch-height-51",
          changeSequence: "2",
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          proposalPublicKey,
          status: "pending",
          blockHeight: 51,
          stateHash: "state-51",
          parentHash: "different-state-50",
        }),
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: false, senderPublicKey: "sender" },
        manager,
      );
    });
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      2,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).isPaused,
      false,
    );
  });

  it("applies incomplete pending branch facts to the current-view pause state", async () => {
    const scenarios = [
      {
        name: "missing-state-hash",
        facts: [
          { blockHeight: 70, stateHash: "state-70-a", parentHash: "state-69" },
          { blockHeight: 70, stateHash: null, parentHash: "state-69" },
        ],
        conflicting: {
          blockHeight: 70,
          stateHash: "state-70-b",
          parentHash: "state-69",
        },
      },
      {
        name: "missing-parent-hash",
        facts: [
          { blockHeight: 80, stateHash: "state-80", parentHash: "parent-a" },
          { blockHeight: 80, stateHash: "state-80", parentHash: null },
        ],
        conflicting: {
          blockHeight: 80,
          stateHash: "state-80",
          parentHash: "parent-b",
        },
      },
      {
        name: "non-adjacent-heights",
        facts: [
          { blockHeight: 90, stateHash: "state-90", parentHash: "state-89" },
          {
            blockHeight: 92,
            stateHash: "state-92-a",
            parentHash: "unknown-state-91",
          },
        ],
        conflicting: {
          blockHeight: 92,
          stateHash: "state-92-b",
          parentHash: "unknown-state-91",
        },
      },
    ] as const;

    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const proposalPublicKey = `known-fork-${scenario.name}`;
      const reconciler = new ProposalProjectionReconciler();
      await insertProposal(dataSource, proposalPublicKey);

      for (const [factIndex, fact] of scenario.facts.entries()) {
        await dataSource.transaction(async (manager) => {
          await reconciler.recordAndReconcile(
            event({
              id: String(1_000 + scenarioIndex * 10 + factIndex),
              changeSequence: String(1_000 + scenarioIndex * 10 + factIndex),
              eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
              proposalPublicKey,
              status: "pending",
              ...fact,
            }),
            PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
            { proposalPublicKey, paused: false, senderPublicKey: "sender" },
            manager,
          );
        });
      }

      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: String(1_009 + scenarioIndex * 10),
            changeSequence: String(1_009 + scenarioIndex * 10),
            eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
            proposalPublicKey,
            status: "pending",
            ...scenario.conflicting,
          }),
          PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          { proposalPublicKey, paused: false, senderPublicKey: "sender" },
          manager,
        );
      });
      assert.equal(
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ proposalPublicKey }),
        3,
        scenario.name,
      );
      assert.equal(
        (
          await dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey })
        ).isPaused,
        true,
        scenario.name,
      );
    }
  });

  it("keeps incomplete branch provenance without inferring a fork", async () => {
    const scenarios = [
      {
        name: "missing-state-hash",
        first: {
          blockHeight: 110,
          stateHash: "state-110",
          parentHash: "state-109",
        },
        second: {
          blockHeight: 110,
          stateHash: null,
          parentHash: "possibly-different-parent",
        },
      },
      {
        name: "missing-parent-hash",
        first: {
          blockHeight: 120,
          stateHash: "state-120",
          parentHash: "state-119",
        },
        second: {
          blockHeight: 121,
          stateHash: "state-121",
          parentHash: null,
        },
      },
      {
        name: "non-adjacent-heights",
        first: {
          blockHeight: 130,
          stateHash: "state-130",
          parentHash: "state-129",
        },
        second: {
          blockHeight: 132,
          stateHash: "state-132",
          parentHash: "not-state-130",
        },
      },
    ] as const;

    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const proposalPublicKey = `incomplete-branch-${scenario.name}`;
      const reconciler = new ProposalProjectionReconciler();
      await insertProposal(dataSource, proposalPublicKey);

      for (const [factIndex, fact] of [
        scenario.first,
        scenario.second,
      ].entries()) {
        await dataSource.transaction(async (manager) => {
          await reconciler.recordAndReconcile(
            event({
              id: String(2_000 + scenarioIndex * 10 + factIndex),
              changeSequence: String(2_000 + scenarioIndex * 10 + factIndex),
              eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
              proposalPublicKey,
              status: "pending",
              ...fact,
            }),
            PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
            { proposalPublicKey, paused: false, senderPublicKey: "sender" },
            manager,
          );
        });
      }

      assert.equal(
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ proposalPublicKey }),
        2,
        scenario.name,
      );
    }
  });

  it("rejects multiple surviving pending creation facts", async () => {
    const proposalPublicKey = "ambiguous-pending-creation";
    const reconciler = new ProposalProjectionReconciler();
    const payload = {
      proposalPublicKey,
      lifecycleId: 2,
      amount: "500",
      recipient: "recipient",
      zkAppUriHash: "123",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "1000",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "200",
      senderPublicKey: "sender",
    };

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "pending-creation-a",
          changeSequence: "1",
          eventType: PROPOSAL_CREATED_EVENT_NAME,
          proposalPublicKey,
          status: "pending",
          blockHeight: 60,
        }),
        PROPOSAL_CREATED_EVENT_NAME,
        payload,
        manager,
      );
    });
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: "pending-creation-b",
            changeSequence: "2",
            eventType: PROPOSAL_CREATED_EVENT_NAME,
            proposalPublicKey,
            status: "pending",
            blockHeight: 61,
          }),
          PROPOSAL_CREATED_EVENT_NAME,
          payload,
          manager,
        );
      }),
      /ambiguous pending creation facts/,
    );
  });

  it("removes a proposal when its creation fact changes type at the same key", async () => {
    const proposalPublicKey = "same-key-type-change";
    const reconciler = new ProposalProjectionReconciler();
    const sourceEvent = event({
      id: "same-key-source",
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey,
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_CREATED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          amount: "500",
          recipient: "recipient",
          zkAppUriHash: "123",
          stakingEpochDataLedgerHash: "999",
          stakingEpochDataLedgerTotalCurrency: "1000",
          requiredParticipationBp: "2000",
          requiredApprovalBp: "5100",
          requiredParticipation: "200",
          senderPublicKey: "sender",
        },
        manager,
      );
    });
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey }),
      1,
    );

    sourceEvent.changeSequence = "2";
    sourceEvent.eventType = PROPOSAL_PAUSE_TOGGLED_EVENT_NAME;
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
    });

    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey }),
      0,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .findOneByOrFail({ archiveEventId: sourceEvent.id })
      ).eventType,
      PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
    );
  });

  it("retains exact reducer padding only as a source fact", async () => {
    const proposalPublicKey = "padding-proposal";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "padding-vote",
          changeSequence: "1",
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          proposalPublicKey,
        }),
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        {
          proposalPublicKey,
          voterPublicKey: PublicKey.empty().toBase58(),
          vote: "dummy",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      1,
    );
    assert.equal(await dataSource.getRepository(VoteEntity).count(), 0);
    assert.equal(
      await dataSource.getRepository(VoteNullifierEntity).count(),
      0,
    );
    assert.equal(await dataSource.getRepository(VoteTallyEntity).count(), 0);
  });

  it("lets a non-empty DUMMY vote own the nullifier without tally weight", async () => {
    const proposalPublicKey = "dummy-owner-proposal";
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 9n,
      calculateVoteResult: async () => "rejected",
    });

    for (const [id, vote, blockHeight] of [
      ["dummy-owner", "dummy", 10],
      ["later-yay", "yay", 11],
    ] as const) {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id,
            changeSequence: String(blockHeight),
            eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
            proposalPublicKey,
            blockHeight,
          }),
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey,
            vote,
            senderPublicKey: "sender",
          },
          manager,
        );
      });
    }

    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({ proposalPublicKey, voterPublicKey });
    assert.equal(nullifier.sourceEventId, "dummy-owner");
    assert.equal(nullifier.vote, "dummy");
    assert.equal(nullifier.voteWeight, "0");
    const votes = await dataSource.getRepository(VoteEntity).find({
      where: { proposalPublicKey },
      order: { blockHeight: "ASC" },
    });
    assert.deepEqual(
      votes.map(({ vote, voteWeight, isNullified }) => ({
        vote,
        voteWeight,
        isNullified,
      })),
      [
        { vote: "dummy", voteWeight: "0", isNullified: false },
        { vote: "yay", voteWeight: "0", isNullified: true },
      ],
    );
    assert.equal(
      (
        await dataSource.getRepository(VoteTallyEntity).findOneByOrFail({
          proposalPublicKey,
          blockHeight: 11,
        })
      ).totalParticipatingVotes,
      "0",
    );
  });

  it("rejects a final tally for a different lifecycle", async () => {
    const proposalPublicKey = "wrong-lifecycle-tally";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: "wrong-lifecycle",
            changeSequence: "1",
            eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
            proposalPublicKey,
          }),
          PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          {
            proposalPublicKey,
            lifecycleId: 3,
            yayWeight: "1",
            nayWeight: "0",
            abstainWeight: "0",
            voteResult: "approved",
            senderPublicKey: "sender",
          },
          manager,
        );
      }),
      /tally lifecycleId=3 does not match proposal lifecycleId=2/,
    );
    assert.equal(await dataSource.getRepository(VoteTallyEntity).count(), 0);
  });

  it("uses UInt128 for total participation across UInt64 tally components", async () => {
    const proposalPublicKey = "uint128-total-tally";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "uint128-total-tally-event",
          changeSequence: "1",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "18446744073709551615",
          nayWeight: "1",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(tally.totalParticipatingVotes, "18446744073709551616");
    assert.equal(tally.approvalBp, "9999");
    assert.equal(tally.sourceStatus, "canonical");
  });

  it("sums three maximum UInt64 tally components in the contract UInt128 domain", async () => {
    const proposalPublicKey = "uint128-three-component-total";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "uint128-three-component-event",
          changeSequence: "1",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "18446744073709551615",
          nayWeight: "18446744073709551615",
          abstainWeight: "18446744073709551615",
          voteResult: "rejected",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(tally.totalParticipatingVotes, "55340232221128654845");
    assert.equal(tally.approvalBp, "5000");
  });

  it("applies a pending final tally and preserves its business fields on promotion", async () => {
    const proposalPublicKey = "final-tally-current-view";
    const reconciler = new ProposalProjectionReconciler();
    await insertProposal(dataSource, proposalPublicKey);
    const source = event({
      id: "final-tally-observation",
      changeSequence: "1",
      eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      proposalPublicKey,
      status: "pending",
      blockHeight: 30,
    });
    const payload = {
      proposalPublicKey,
      lifecycleId: 2,
      yayWeight: "180",
      nayWeight: "20",
      abstainWeight: "0",
      voteResult: "approved" as const,
      senderPublicKey: "sender",
    };
    const recordTally = async (): Promise<void> => {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          source,
          PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          payload,
          manager,
        );
      });
    };

    await recordTally();
    const pendingTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: source.id });
    assert.equal(pendingTally.sourceStatus, "pending");
    assert.equal(pendingTally.yayWeight, "180");
    assert.equal(pendingTally.voteResult, "approved");
    let proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "pending");
    assert.equal(proposal.contractStatusSourceEventId, source.id);

    source.status = "canonical";
    source.changeSequence = "2";
    await recordTally();
    const canonicalTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: source.id });
    assert.equal(canonicalTally.sourceStatus, "canonical");
    assert.equal(canonicalTally.yayWeight, pendingTally.yayWeight);
    assert.equal(canonicalTally.nayWeight, pendingTally.nayWeight);
    assert.equal(canonicalTally.abstainWeight, pendingTally.abstainWeight);
    assert.equal(canonicalTally.voteResult, pendingTally.voteResult);
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "canonical");
    assert.equal(proposal.contractStatusSourceEventId, source.id);

    source.status = "orphaned";
    source.changeSequence = "3";
    await recordTally();
    assert.equal(
      await dataSource
        .getRepository(VoteTallyEntity)
        .countBy({ proposalPublicKey }),
      0,
    );
    proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "unknown");
    assert.equal(proposal.contractStatusSourceEventId, null);
  });

  it("keeps a contract tally when a vote follows it at the same height", async () => {
    const proposalPublicKey = "same-height-final-tally";
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 2n,
      calculateVoteResult: async () => "rejected",
    });

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "final-first",
          changeSequence: "1",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 20,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "180",
          nayWeight: "20",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
      const laterVote = event({
        id: "vote-after-final",
        changeSequence: "2",
        eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        proposalPublicKey,
        blockHeight: 20,
      });
      laterVote.blockEventIndex = 1;
      await reconciler.recordAndReconcile(
        laterVote,
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        {
          proposalPublicKey,
          voterPublicKey,
          vote: "yay",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const tally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 20 });
    assert.equal(tally.archiveEventId, "final-first");
    assert.equal(tally.yayWeight, "180");
    assert.equal(tally.createdByEventType, PROPOSAL_VOTES_TALLIED_EVENT_NAME);
  });

  it("replaces legacy same-block order when transaction sequence metadata arrives", async () => {
    const proposalPublicKey = "sequence-enrichment-order";
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 9n,
      calculateVoteResult: async () => "rejected",
    });
    await recordCanonicalCreation(dataSource, reconciler, proposalPublicKey);

    const first = event({
      id: "legacy-first",
      changeSequence: "2",
      eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      proposalPublicKey,
      status: "pending",
      blockHeight: 20,
      blockEventIndex: 0,
      stateHash: "same-block",
    });
    const second = event({
      id: "legacy-second",
      changeSequence: "3",
      eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      proposalPublicKey,
      status: "pending",
      blockHeight: 20,
      blockEventIndex: 1,
      stateHash: "same-block",
    });
    const recordVote = async (
      source: ArchiveEventEntity,
      vote: "yay" | "nay",
    ) => {
      await dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          source,
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey,
            vote,
            senderPublicKey: "sender",
          },
          manager,
        );
      });
    };

    await recordVote(first, "yay");
    await recordVote(second, "nay");
    assert.equal(
      (
        await dataSource
          .getRepository(VoteNullifierEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).sourceEventId,
      first.id,
    );

    first.changeSequence = "5";
    first.blockEventIndex = 1;
    first.rawEventData.transactionInfo = {
      hash: first.txHash,
      sequenceNumber: 7,
      zkappAccountUpdateIds: [Number(first.accountUpdateId)],
    };
    second.changeSequence = "4";
    second.blockEventIndex = 0;
    second.rawEventData.transactionInfo = {
      hash: second.txHash,
      sequenceNumber: 3,
      zkappAccountUpdateIds: [Number(second.accountUpdateId)],
    };
    await recordVote(second, "nay");
    await recordVote(first, "yay");

    const facts = await dataSource.getRepository(ProposalEventFactEntity).find({
      where: { proposalPublicKey },
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      facts
        .filter(
          (fact) => fact.eventType === PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        )
        .map((fact) => [fact.archiveEventId, fact.blockEventIndex]),
      [
        [second.id, 0],
        [first.id, 1],
      ],
    );
    assert.equal(
      (
        await dataSource
          .getRepository(VoteNullifierEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).sourceEventId,
      second.id,
    );
  });

  it("preserves both same-block tallies across pause and unpause", async () => {
    const proposalPublicKey = "reachable-contract-status-sequence";
    const reconciler = new ProposalProjectionReconciler();
    await recordCanonicalCreation(dataSource, reconciler, proposalPublicKey);
    const tally = event({
      id: "reachable-tally-first",
      changeSequence: "2",
      eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 70,
    });
    tally.blockEventIndex = 0;
    const pause = event({
      id: "reachable-pause",
      changeSequence: "3",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 70,
    });
    pause.blockEventIndex = 1;
    const unpause = event({
      id: "reachable-unpause",
      changeSequence: "4",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 70,
    });
    unpause.blockEventIndex = 2;
    const secondTally = event({
      id: "reachable-tally-second",
      changeSequence: "5",
      eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 70,
    });
    secondTally.blockEventIndex = 3;

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        tally,
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "180",
          nayWeight: "20",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
      await reconciler.recordAndReconcile(
        pause,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
      await reconciler.recordAndReconcile(
        unpause,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: false, senderPublicKey: "sender" },
        manager,
      );
      await reconciler.recordAndReconcile(
        secondTally,
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "180",
          nayWeight: "20",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const tallies = await dataSource.getRepository(VoteTallyEntity).find({
      where: { proposalPublicKey, blockHeight: 70 },
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      tallies.map((row) => row.archiveEventId),
      [tally.id, secondTally.id],
    );
    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.contractStatusFinality, "canonical");
    assert.equal(proposal.contractStatusSourceEventId, secondTally.id);
    assert.equal(proposal.contractStatusBlockHeight, 70);
    assert.equal(proposal.isPaused, false);
  });

  it("keeps running vote tallies independent from final tally payloads", async () => {
    const proposalPublicKey = "independent-running-and-final-tallies";
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 2n,
      calculateVoteResult: async () => "rejected",
    });

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "independent-final",
          changeSequence: "1",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 20,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "180",
          nayWeight: "20",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
      await reconciler.recordAndReconcile(
        event({
          id: "independent-later-vote",
          changeSequence: "2",
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 21,
        }),
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        {
          proposalPublicKey,
          voterPublicKey,
          vote: "yay",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const finalTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ archiveEventId: "independent-final" });
    const runningTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey, blockHeight: 21 });
    assert.equal(finalTally.yayWeight, "180");
    assert.equal(finalTally.nayWeight, "20");
    assert.equal(runningTally.yayWeight, "2");
    assert.equal(runningTally.nayWeight, "0");
  });

  it("retains canonical child events until earlier source facts arrive", async () => {
    const proposalPublicKey = "out-of-order-canonical-events";
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 5n,
      calculateVoteResult: async () => "rejected",
    });
    await recordCanonicalCreation(dataSource, reconciler, proposalPublicKey);

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "execution-arrives-before-tally",
          changeSequence: "80",
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 80,
        }),
        PROPOSAL_EXECUTED_EVENT_NAME,
        {
          proposalPublicKey,
          amountToPayOut: "10",
          senderPublicKey: "sender",
        },
        manager,
      );
    });
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "earlier-tally-arrives-later",
          changeSequence: "81",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 70,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "200",
          nayWeight: "0",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "approved");
    assert.equal(proposal.paidOutAmount, "10");
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      3,
    );
  });

  it("checks proposal amount plus bond only when an execution exists", async () => {
    const proposalPublicKey = "lazy-payout-boundary";
    const reconciler = new ProposalProjectionReconciler();
    await recordCanonicalCreation(
      dataSource,
      reconciler,
      proposalPublicKey,
      "16769767339735956015",
    );

    const createdProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(createdProposal.amount, "16769767339735956015");
    assert.equal(createdProposal.paidOutAmount, "0");

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "lazy-payout-approval",
          changeSequence: "2",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 2,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "200",
          nayWeight: "0",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
    });

    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: "lazy-payout-execution",
            changeSequence: "3",
            eventType: PROPOSAL_EXECUTED_EVENT_NAME,
            proposalPublicKey,
            blockHeight: 3,
          }),
          PROPOSAL_EXECUTED_EVENT_NAME,
          {
            proposalPublicKey,
            amountToPayOut: "0",
            senderPublicKey: "sender",
          },
          manager,
        );
      }),
      /total payout amount.*must be in the UInt64 range/,
    );
  });

  it("clears the paid amount when the last execution changes event type", async () => {
    const proposalPublicKey = "execution-type-change";
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    const sourceEvent = event({
      id: "execution-source",
      changeSequence: "2",
      eventType: PROPOSAL_EXECUTED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 2,
    });

    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        event({
          id: "execution-approval",
          changeSequence: "1",
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          proposalPublicKey,
          blockHeight: 1,
        }),
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        {
          proposalPublicKey,
          lifecycleId: 2,
          yayWeight: "180",
          nayWeight: "20",
          abstainWeight: "0",
          voteResult: "approved",
          senderPublicKey: "sender",
        },
        manager,
      );
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_EXECUTED_EVENT_NAME,
        { proposalPublicKey, amountToPayOut: "10", senderPublicKey: "sender" },
        manager,
      );
    });
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).paidOutAmount,
      "10",
    );

    sourceEvent.changeSequence = "3";
    sourceEvent.eventType = PROPOSAL_PAUSE_TOGGLED_EVENT_NAME;
    await dataSource.transaction(async (manager) => {
      await reconciler.recordAndReconcile(
        sourceEvent,
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        { proposalPublicKey, paused: true, senderPublicKey: "sender" },
        manager,
      );
    });

    assert.equal(
      await dataSource.getRepository(ProposalExecutionEntity).count(),
      0,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).paidOutAmount,
      "0",
    );
  });

  it("rejects a vote weight that is outside the contract UInt64 domain", async () => {
    const proposalPublicKey = "overflow-vote-weight";
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await insertProposal(dataSource, proposalPublicKey);
    const reconciler = new ProposalProjectionReconciler();
    reconciler.configureVoteProjection({
      getVoteWeight: async () => 18_446_744_073_709_551_616n,
      calculateVoteResult: async () => "approved",
    });

    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await reconciler.recordAndReconcile(
          event({
            id: "overflow-vote-weight-event",
            changeSequence: "1",
            eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
            proposalPublicKey,
          }),
          PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          {
            proposalPublicKey,
            voterPublicKey,
            vote: "yay",
            senderPublicKey: "sender",
          },
          manager,
        );
      }),
      /vote weight.*must be in the UInt64 range/,
    );
    assert.equal(await dataSource.getRepository(VoteEntity).count(), 0);
  });

  it("rejects vote weights from a lifecycle file with the wrong staking root", async () => {
    await insertProposal(dataSource, HANDLER_PROPOSAL_PUBLIC_KEY);
    let votingLedgerLookups = 0;
    const handler = new ProposalVoteDispatchedEventHandler(
      {
        getService: async () => ({
          start: async () => undefined,
          getVoteWeight: async () => {
            votingLedgerLookups += 1;
            return 9n;
          },
          close: async () => undefined,
        }),
      },
      {
        calculateAcceptanceCriteria: async () => ({
          requiredParticipation: 1n,
          requiredApprovalBp: 5000n,
        }),
        calculateVoteResult: async () => "approved",
      },
      {
        stakingLedgerServices: {
          getService: async () =>
            ({
              getRootHash: async () => ({ toString: () => "wrong-root" }),
            }) as never,
        },
      },
      new ProposalProjectionReconciler(),
    );

    await assert.rejects(
      dataSource.transaction(
        async (manager) =>
          await handler.tryHandle(
            event({
              id: "root-bound-vote",
              changeSequence: "1",
              eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
              proposalPublicKey: HANDLER_PROPOSAL_PUBLIC_KEY,
              payload: {
                voterPublicKey: HANDLER_VOTER_PUBLIC_KEY,
                vote: "yay",
                senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
              },
            }),
            manager,
          ),
      ),
      /staking ledger root mismatch.*expected=999 actual=wrong-root/,
    );
    assert.equal(votingLedgerLookups, 0);
  });

  it("extends replay to the latest locked Archive snapshot before completion", async () => {
    const proposalPublicKey = HANDLER_PROPOSAL_PUBLIC_KEY;
    const creation = event({
      id: "replay-moving-create",
      changeSequence: "1",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 10,
      payload: {
        lifecycleId: 2,
        amount: "500",
        recipient: HANDLER_RECIPIENT_PUBLIC_KEY,
        zkAppUriHash: "123",
        stakingEpochDataLedgerHash: "999",
        stakingEpochDataLedgerTotalCurrency: "1000",
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
    });
    const pause = event({
      id: "replay-target-pause",
      changeSequence: "2",
      eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      proposalPublicKey,
      blockHeight: 11,
      payload: {
        paused: false,
        senderPublicKey: HANDLER_SENDER_PUBLIC_KEY,
      },
    });
    await dataSource
      .getRepository(ArchiveEventEntity)
      .insert([creation, pause]);
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "2",
      state: "collecting",
      completedAt: null,
    });

    const reconciler = new ProposalProjectionReconciler();
    const createHandler = new ProposalCreatedEventHandler(
      {
        resolveTreasuryBalanceForLifecycle: async () => "1000",
        deriveAcceptanceCriteria: async () => ({
          requiredParticipationBp: "2000",
          requiredApprovalBp: "5100",
          requiredParticipation: "200",
        }),
      },
      reconciler,
    );
    const pauseHandler = new ProposalPauseToggledEventHandler(reconciler);
    await dataSource.transaction(async (manager) => {
      assert.equal(await createHandler.tryHandle(creation, manager), true);
    });

    await dataSource.getRepository(ArchiveEventEntity).update(
      { id: creation.id },
      {
        changeSequence: "3",
        updatedAt: new Date("2026-01-01T00:00:01.000Z"),
      },
    );
    await dataSource.transaction(async (manager) => {
      assert.equal(await pauseHandler.tryHandle(pause, manager), true);
    });
    const collecting = await dataSource
      .getRepository(ProposalProjectionReplayEntity)
      .findOneByOrFail({ projectionName: "proposal" });
    assert.equal(collecting.state, "collecting");
    assert.equal(String(collecting.targetChangeSequence), "3");
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey }),
      0,
    );

    const movedCreation = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({ id: creation.id });
    await dataSource.transaction(async (manager) => {
      assert.equal(await createHandler.tryHandle(movedCreation, manager), true);
    });

    const complete = await dataSource
      .getRepository(ProposalProjectionReplayEntity)
      .findOneByOrFail({ projectionName: "proposal" });
    assert.equal(complete.state, "complete");
    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey });
    assert.equal(proposal.contractStatus, "paused");
    assert.equal(proposal.contractStatusFinality, "canonical");
    assert.equal(proposal.contractStatusSourceEventId, pause.id);
  });
});
