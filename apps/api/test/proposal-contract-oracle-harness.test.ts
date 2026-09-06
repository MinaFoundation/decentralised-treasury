import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { EventProcessorHandler } from "@repo/processor";
import {
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  ProposalPauseToggledEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import {
  Vote,
  VoteAction,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { Bool, Field, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalContentEntity } from "../src/processors/proposals/proposal-content-entity.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import type {
  VotingLedgerService,
  VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";
import {
  asArchiveEvent,
  assertProjectionMatchesOracle,
  isExactContractDummy,
  type OracleCreatedEvent,
  type OracleExecutionEvent,
  type OraclePauseEvent,
  type OracleProposalEvent,
  ProposalContractOracle,
  type OracleTallyEvent,
  type OracleVoteEvent,
} from "./support/proposal-contract-oracle-harness.js";

const proposalPublicKey = PrivateKey.fromBigInt(11n).toPublicKey();
const recipientPublicKey = PrivateKey.fromBigInt(12n).toPublicKey();
const senderPublicKey = PrivateKey.fromBigInt(13n).toPublicKey();
const voterOne = PrivateKey.fromBigInt(21n).toPublicKey();
const voterTwo = PrivateKey.fromBigInt(22n).toPublicKey();
const emptyPublicKey = PublicKey.empty();

const proposalKey = proposalPublicKey.toBase58();
const recipientKey = recipientPublicKey.toBase58();
const senderKey = senderPublicKey.toBase58();
const voterOneKey = voterOne.toBase58();
const voterTwoKey = voterTwo.toBase58();
const emptyKey = emptyPublicKey.toBase58();

const voteWeights = new Map<string, bigint>([
  [voterOneKey, 60n],
  [voterTwoKey, 25n],
  [emptyKey, 7n],
]);

class OracleVotingLedgerService implements VotingLedgerService {
  public async start(): Promise<void> {}

  public async getVoteWeight(publicKey: string): Promise<bigint> {
    return voteWeights.get(publicKey) ?? 0n;
  }

  public async close(): Promise<void> {}
}

class OracleVotingLedgerLookup implements VotingLedgerServiceLookup {
  public async getService(): Promise<VotingLedgerService> {
    return new OracleVotingLedgerService();
  }
}

function voteValue(vote: OracleVoteEvent["vote"]): Vote {
  if (vote === "yay") return Vote.YAY;
  if (vote === "nay") return Vote.NAY;
  if (vote === "abstain") return Vote.ABSTRAIN;
  return Vote.DUMMY;
}

function eventFields(event: OracleProposalEvent): string[] {
  const eventProposalPublicKey = PublicKey.fromBase58(event.proposalPublicKey);
  const eventSenderPublicKey = PublicKey.fromBase58(event.senderPublicKey);
  if (event.type === "proposalCreated") {
    return ProposalCreatedEvent.toFields(
      new ProposalCreatedEvent({
        proposalPublicKey: eventProposalPublicKey,
        lifecycleId: UInt32.from(event.lifecycleId),
        amount: UInt64.from(event.amount),
        recipient: PublicKey.fromBase58(event.recipient),
        zkAppUriHash: Field(event.zkAppUriHash),
        stakingEpochDataLedgerHash: Field(event.stakingEpochDataLedgerHash),
        stakingEpochDataLedgerTotalCurrency: UInt64.from(
          event.stakingEpochDataLedgerTotalCurrency,
        ),
        proposerPublicKey: eventSenderPublicKey,
        senderPublicKey: eventSenderPublicKey,
      }),
    ).map(String);
  }
  if (event.type === "proposalVoteDispatched") {
    const voterPublicKey =
      event.voterPublicKey === emptyKey
        ? emptyPublicKey
        : PublicKey.fromBase58(event.voterPublicKey);
    return ProposalVoteDispatchedEvent.toFields(
      new ProposalVoteDispatchedEvent({
        proposalPublicKey: eventProposalPublicKey,
        voterPublicKey,
        vote: voteValue(event.vote),
        senderPublicKey: eventSenderPublicKey,
      }),
    ).map(String);
  }
  if (event.type === "proposalVotesTallied") {
    return ProposalVotesTalliedEvent.toFields(
      new ProposalVotesTalliedEvent({
        proposalPublicKey: eventProposalPublicKey,
        lifecycleId: UInt32.from(event.lifecycleId),
        yayWeight: UInt64.from(event.yayWeight),
        nayWeight: UInt64.from(event.nayWeight),
        abstainWeight: UInt64.from(event.abstainWeight),
        voteResult: Field(event.voteResult === "approved" ? 1 : 2),
        senderPublicKey: eventSenderPublicKey,
      }),
    ).map(String);
  }
  if (event.type === "proposalPauseToggled") {
    return ProposalPauseToggledEvent.toFields(
      new ProposalPauseToggledEvent({
        proposalPublicKey: eventProposalPublicKey,
        paused: Bool(event.pausedPayload),
        senderPublicKey: eventSenderPublicKey,
      }),
    ).map(String);
  }
  return ProposalExecutedEvent.toFields(
    new ProposalExecutedEvent({
      proposalPublicKey: eventProposalPublicKey,
      amountToPayOut: UInt64.from(event.amountToPayOut),
      senderPublicKey: eventSenderPublicKey,
    }),
  ).map(String);
}

const eventNames = [
  "proposalCreated",
  "proposalExecuted",
  "proposalPauseToggled",
  "proposalVoteDispatched",
  "proposalVotesTallied",
].sort();

function rawEventData(event: OracleProposalEvent): Record<string, unknown> {
  return {
    data: [String(eventNames.indexOf(event.type)), ...eventFields(event)],
  };
}

function createdEvent(): OracleCreatedEvent {
  return {
    id: "1",
    changeSequence: "1",
    blockHeight: 100,
    blockEventIndex: 0,
    status: "canonical",
    type: "proposalCreated",
    proposalPublicKey: proposalKey,
    lifecycleId: 2,
    amount: "1000",
    recipient: recipientKey,
    senderPublicKey: senderKey,
    zkAppUriHash: "12345",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "100",
    treasuryBalance: "1000",
  };
}

function createSeededGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const shuffled = [...values];
  const random = createSeededGenerator(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random() % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

describe("proposal processor contract oracle", () => {
  let dataSource: DataSource;
  let oracle: ProposalContractOracle;
  let handlers: Map<OracleProposalEvent["type"], EventProcessorHandler>;

  async function initializeHarness(): Promise<void> {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalContentEntity,
      ProposalExecutionEntity,
      ProposalEventFactEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    await dataSource.initialize();
    await dataSource.synchronize();
    oracle = new ProposalContractOracle(proposalKey, voteWeights);
    const reconciler = new ProposalProjectionReconciler();
    handlers = new Map<OracleProposalEvent["type"], EventProcessorHandler>([
      [
        "proposalCreated",
        new ProposalCreatedEventHandler(
          { resolveTreasuryBalanceForLifecycle: async () => "1000" },
          reconciler,
        ),
      ],
      [
        "proposalVoteDispatched",
        new ProposalVoteDispatchedEventHandler(
          new OracleVotingLedgerLookup(),
          undefined,
          { resolveTreasuryBalanceForLifecycle: async () => "1000" },
          reconciler,
        ),
      ],
      [
        "proposalVotesTallied",
        new ProposalVotesTalliedEventHandler(reconciler),
      ],
      [
        "proposalPauseToggled",
        new ProposalPauseToggledEventHandler(reconciler),
      ],
      ["proposalExecuted", new ProposalExecutedEventHandler(reconciler)],
    ]);
  }

  beforeEach(initializeHarness);

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  async function deliver(
    event: OracleProposalEvent,
    label: string,
  ): Promise<void> {
    const handler = handlers.get(event.type);
    assert.ok(handler);
    const handled = await dataSource.transaction(
      async (manager) =>
        await handler.tryHandle(
          asArchiveEvent(event, rawEventData(event)),
          manager,
        ),
    );
    assert.equal(handled, true, `${label}: handler acceptance`);
    oracle.observe(event);
    await assertProjectionMatchesOracle(dataSource, oracle, proposalKey, label);
  }

  it("PROCESSOR_POLICY: uses fixed source order across delivery reorder and status changes", async () => {
    await deliver(createdEvent(), "creation");
    const laterVote: OracleVoteEvent = {
      id: "3",
      changeSequence: "2",
      blockHeight: 102,
      blockEventIndex: 1,
      status: "pending",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    const earlierVote: OracleVoteEvent = {
      ...laterVote,
      id: "2",
      changeSequence: "3",
      blockHeight: 101,
      blockEventIndex: 0,
      vote: "yay",
    };
    await deliver(laterVote, "later source vote delivered first");
    await deliver(earlierVote, "earlier source vote delivered second");
    await deliver(
      { ...earlierVote, changeSequence: "4", status: "orphaned" },
      "first vote orphaned",
    );
    await deliver(
      { ...earlierVote, changeSequence: "5", status: "pending" },
      "first vote seen again",
    );
    await deliver(
      { ...earlierVote, changeSequence: "6", status: "canonical" },
      "first vote canonicalized",
    );
    await deliver(
      { ...laterVote, changeSequence: "7", status: "canonical" },
      "later vote canonicalized",
    );
  });

  it("PROCESSOR_POLICY: uses stored block position instead of Archive row identity", async () => {
    await deliver(createdEvent(), "creation");
    const earlierSourceVote: OracleVoteEvent = {
      id: "90",
      changeSequence: "3",
      blockHeight: 101,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    const laterSourceVote: OracleVoteEvent = {
      ...earlierSourceVote,
      id: "10",
      changeSequence: "2",
      blockHeight: 102,
      blockEventIndex: 1,
      vote: "nay",
    };

    await deliver(laterSourceVote, "later source vote delivered first");
    await deliver(earlierSourceVote, "earlier source vote delivered second");

    const nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
      });
    assert.equal(nullifier.sourceEventId, earlierSourceVote.id);
  });

  it("PROCESSOR_POLICY: uses source order for same-block nullifier ownership", async () => {
    await deliver(createdEvent(), "creation");
    const laterTransactionVote: OracleVoteEvent = {
      id: "30",
      changeSequence: "2",
      blockHeight: 101,
      blockEventIndex: 9,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    const earlierTransactionVote: OracleVoteEvent = {
      ...laterTransactionVote,
      id: "31",
      changeSequence: "3",
      blockEventIndex: 2,
      vote: "yay",
    };

    await deliver(
      laterTransactionVote,
      "later blockEventIndex transaction observed first",
    );
    let nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
      });
    assert.equal(nullifier.sourceEventId, laterTransactionVote.id);

    const handler = handlers.get(earlierTransactionVote.type);
    assert.ok(handler);
    assert.equal(
      await dataSource.transaction(
        async (manager) =>
          await handler.tryHandle(
            asArchiveEvent(
              earlierTransactionVote,
              rawEventData(earlierTransactionVote),
            ),
            manager,
          ),
      ),
      true,
    );

    const votes = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
    });
    assert.equal(votes.length, 2, "both actions remain visible");
    assert.equal(
      votes.find((vote) => vote.archiveEventId === earlierTransactionVote.id)
        ?.voteWeight,
      "60",
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === earlierTransactionVote.id)
        ?.isNullified,
      false,
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === laterTransactionVote.id)
        ?.voteWeight,
      "0",
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === laterTransactionVote.id)
        ?.isNullified,
      true,
    );
    nullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
      });
    assert.equal(nullifier.sourceEventId, earlierTransactionVote.id);
    const runningTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey, blockHeight: 101 });
    assert.equal(runningTally.yayWeight, "60");
    assert.equal(runningTally.totalParticipatingVotes, "60");
  });

  it("CONTRACT_PROVED: an earlier-height owner nullifies later same-block actions", async () => {
    await deliver(createdEvent(), "creation");
    const firstVote: OracleVoteEvent = {
      id: "40",
      changeSequence: "2",
      blockHeight: 101,
      blockEventIndex: 7,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterTwoKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    const laterVoteOne: OracleVoteEvent = {
      ...firstVote,
      id: "41",
      changeSequence: "3",
      blockHeight: 102,
      blockEventIndex: 9,
      vote: "nay",
    };
    const laterVoteTwo: OracleVoteEvent = {
      ...laterVoteOne,
      id: "42",
      changeSequence: "4",
      blockEventIndex: 1,
      vote: "abstain",
    };

    await deliver(firstVote, "unique earlier-height vote");
    await deliver(laterVoteOne, "later same-block vote one");
    await deliver(laterVoteTwo, "later same-block vote two");

    const rows = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey: proposalKey,
      voterPublicKey: voterTwoKey,
    });
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((row) => row.voteWeight !== "0").length, 1);
    assert.equal(
      rows.find((row) => row.archiveEventId === firstVote.id)?.voteWeight,
      "25",
    );
    assert.equal(
      rows
        .filter((row) => row.blockHeight === 102)
        .every((row) => row.isNullified && row.voteWeight === "0"),
      true,
    );
  });

  it("CONTRACT_PROVED: the first same-block action owns the nullifier", async () => {
    await deliver(createdEvent(), "creation");
    const yayVote: OracleVoteEvent = {
      id: "35",
      changeSequence: "2",
      blockHeight: 101,
      blockEventIndex: 8,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    const nayVote: OracleVoteEvent = {
      ...yayVote,
      id: "36",
      changeSequence: "3",
      blockEventIndex: 1,
      vote: "nay",
    };

    await deliver(yayVote, "one exact owner");
    await deliver(nayVote, "same-height mixed-label owner tie");

    const runningTally = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey, blockHeight: 101 });
    assert.equal(runningTally.yayWeight, "0");
    assert.equal(runningTally.nayWeight, "60");
    const votes = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
    });
    assert.equal(
      votes.find((vote) => vote.archiveEventId === nayVote.id)?.voteWeight,
      "60",
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === nayVote.id)?.isNullified,
      false,
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === yayVote.id)?.voteWeight,
      "0",
    );
    assert.equal(
      votes.find((vote) => vote.archiveEventId === yayVote.id)?.isNullified,
      true,
    );
  });

  it("PROCESSOR_POLICY: keeps deterministic projections for every delivery permutation", async () => {
    const sourceVotes: OracleVoteEvent[] = [
      {
        id: "2",
        changeSequence: "2",
        blockHeight: 101,
        blockEventIndex: 0,
        status: "canonical",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
        vote: "yay",
        senderPublicKey: senderKey,
      },
      {
        id: "3",
        changeSequence: "3",
        blockHeight: 101,
        blockEventIndex: 1,
        status: "canonical",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterTwoKey,
        vote: "nay",
        senderPublicKey: senderKey,
      },
      {
        id: "4",
        changeSequence: "4",
        blockHeight: 102,
        blockEventIndex: 2,
        status: "canonical",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
        vote: "abstain",
        senderPublicKey: senderKey,
      },
    ];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];

    for (const [permutationIndex, permutation] of permutations.entries()) {
      if (permutationIndex > 0) {
        await dataSource.destroy();
        await initializeHarness();
      }
      await deliver(
        createdEvent(),
        `permutation ${permutationIndex}: creation`,
      );
      for (const voteIndex of permutation) {
        await deliver(
          sourceVotes[voteIndex]!,
          `permutation ${permutationIndex}: vote ${voteIndex}`,
        );
      }
    }
  });

  it("PROCESSOR_POLICY: handles DUMMY actions and exact reducer padding", async () => {
    await deliver(createdEvent(), "creation");
    const nonEmptyDummy: OracleVoteEvent = {
      id: "2",
      changeSequence: "2",
      blockHeight: 101,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterTwoKey,
      vote: "dummy",
      senderPublicKey: senderKey,
    };
    const exactPadding: OracleVoteEvent = {
      ...nonEmptyDummy,
      id: "3",
      changeSequence: "3",
      blockEventIndex: 1,
      voterPublicKey: emptyKey,
    };
    const emptyKeyRealVote: OracleVoteEvent = {
      ...exactPadding,
      id: "4",
      changeSequence: "4",
      blockEventIndex: 2,
      vote: "yay",
    };

    assert.equal(isExactContractDummy(nonEmptyDummy), false);
    assert.equal(isExactContractDummy(exactPadding), true);
    assert.equal(isExactContractDummy(emptyKeyRealVote), false);
    assert.equal(VoteAction.isDummy(VoteAction.dummy()).toBoolean(), true);

    await deliver(nonEmptyDummy, "non-empty DUMMY consumes nullifier");
    await deliver(exactPadding, "injected proof padding stays neutral");
    await deliver(emptyKeyRealVote, "real empty-key vote consumes nullifier");
  });

  it("PROCESSOR_POLICY: tracks tally, pause, and execution transitions", async () => {
    await deliver(createdEvent(), "creation");
    const vote: OracleVoteEvent = {
      id: "2",
      changeSequence: "2",
      blockHeight: 101,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    };
    await deliver(vote, "vote");

    const tally: OracleTallyEvent = {
      id: "3",
      changeSequence: "3",
      blockHeight: 110,
      blockEventIndex: 7,
      status: "pending",
      type: "proposalVotesTallied",
      proposalPublicKey: proposalKey,
      lifecycleId: 2,
      yayWeight: "60",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: senderKey,
    };
    await deliver(tally, "approved tally pending");
    await deliver(
      { ...tally, changeSequence: "4", status: "orphaned" },
      "pending tally orphaned",
    );
    await deliver(
      { ...tally, changeSequence: "5", status: "pending" },
      "tally seen again",
    );
    await deliver(
      { ...tally, changeSequence: "6", status: "canonical" },
      "approved tally canonical",
    );

    const laterExecution: OracleExecutionEvent = {
      id: "7",
      changeSequence: "7",
      blockHeight: 116,
      blockEventIndex: 1,
      status: "pending",
      type: "proposalExecuted",
      proposalPublicKey: proposalKey,
      recipient: recipientKey,
      amountToPayOut: "200",
      senderPublicKey: senderKey,
    };
    const earlierExecution: OracleExecutionEvent = {
      ...laterExecution,
      id: "6",
      changeSequence: "8",
      blockHeight: 115,
      blockEventIndex: 0,
      amountToPayOut: "100",
    };
    await deliver(laterExecution, "later approved execution delivered first");
    await deliver(
      earlierExecution,
      "earlier approved execution delivered second",
    );
    await deliver(
      { ...earlierExecution, changeSequence: "9", status: "orphaned" },
      "earlier pending execution orphaned",
    );
    await deliver(
      { ...earlierExecution, changeSequence: "10", status: "pending" },
      "earlier execution seen again",
    );
    await deliver(
      { ...earlierExecution, changeSequence: "11", status: "canonical" },
      "earlier execution canonicalized",
    );
    await deliver(
      { ...laterExecution, changeSequence: "12", status: "canonical" },
      "later execution canonicalized",
    );

    const firstPause: OraclePauseEvent = {
      id: "4",
      changeSequence: "13",
      blockHeight: 120,
      blockEventIndex: 0,
      status: "pending",
      type: "proposalPauseToggled",
      proposalPublicKey: proposalKey,
      pausedPayload: false,
      senderPublicKey: senderKey,
    };
    const secondPause: OraclePauseEvent = {
      ...firstPause,
      id: "5",
      changeSequence: "17",
      blockHeight: 121,
      pausedPayload: false,
    };
    await deliver(firstPause, "APPROVED to PAUSED despite payload");
    await deliver(
      { ...firstPause, changeSequence: "14", status: "orphaned" },
      "orphaned pending first toggle restores APPROVED",
    );
    await deliver(
      { ...firstPause, changeSequence: "15", status: "pending" },
      "first toggle seen again",
    );
    await deliver(
      { ...firstPause, changeSequence: "16", status: "canonical" },
      "first toggle canonicalized as PAUSED",
    );
    await deliver(secondPause, "PAUSED to UNKNOWN despite payload");
    await deliver(
      { ...secondPause, changeSequence: "18", status: "orphaned" },
      "orphaned pending second toggle restores PAUSED",
    );
    await deliver(
      { ...secondPause, changeSequence: "19", status: "pending" },
      "second toggle seen again",
    );
    await deliver(
      { ...secondPause, changeSequence: "20", status: "canonical" },
      "second toggle canonicalized as UNKNOWN",
    );
  });

  it("PROCESSOR_POLICY: accepts execution before an earlier tally arrives", async () => {
    await deliver(createdEvent(), "creation");
    const execution: OracleExecutionEvent = {
      id: "3",
      changeSequence: "2",
      blockHeight: 112,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalExecuted",
      proposalPublicKey: proposalKey,
      recipient: recipientKey,
      amountToPayOut: "100",
      senderPublicKey: senderKey,
    };
    await deliver(execution, "execution arrives on an incomplete prefix");
    const tally: OracleTallyEvent = {
      id: "2",
      changeSequence: "3",
      blockHeight: 111,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVotesTallied",
      proposalPublicKey: proposalKey,
      lifecycleId: 2,
      yayWeight: "60",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: senderKey,
    };
    await deliver(tally, "earlier approved tally arrives later");

    const stored = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalKey,
      });
    assert.equal(stored.contractStatus, "approved");
    assert.equal(stored.paidOutAmount, "100");
  });

  it("EVENT_SCHEMA_LIMIT: projects the contract-bound creation recipient", async () => {
    await deliver(createdEvent(), "creation");
    const tally: OracleTallyEvent = {
      id: "2",
      changeSequence: "2",
      blockHeight: 111,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVotesTallied",
      proposalPublicKey: proposalKey,
      lifecycleId: 2,
      yayWeight: "60",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: senderKey,
    };
    await deliver(tally, "approved tally");
    const recipientNotEncodedByCurrentEvent = PrivateKey.fromBigInt(99n)
      .toPublicKey()
      .toBase58();
    const execution: OracleExecutionEvent = {
      id: "3",
      changeSequence: "3",
      blockHeight: 112,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalExecuted",
      proposalPublicKey: proposalKey,
      recipient: recipientNotEncodedByCurrentEvent,
      amountToPayOut: "100",
      senderPublicKey: senderKey,
    };

    await deliver(execution, "execution with an unobservable recipient hint");
    const storedExecution = await dataSource
      .getRepository(ProposalExecutionEntity)
      .findOneByOrFail({ archiveEventId: execution.id });
    assert.equal(storedExecution.recipient, recipientKey);
    assert.notEqual(storedExecution.recipient, execution.recipient);
  });

  it("CONTRACT_PROVED: replays valid status transitions in source order", async () => {
    const approvedTally = (
      id: string,
      blockHeight: number,
    ): OracleTallyEvent => ({
      id,
      changeSequence: id,
      blockHeight,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVotesTallied",
      proposalPublicKey: proposalKey,
      lifecycleId: 2,
      yayWeight: "60",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: senderKey,
    });
    const rejectedTally = (
      id: string,
      blockHeight: number,
    ): OracleTallyEvent => ({
      ...approvedTally(id, blockHeight),
      yayWeight: "20",
      nayWeight: "40",
      voteResult: "rejected",
    });
    const pause = (id: string, blockHeight: number): OraclePauseEvent => ({
      id,
      changeSequence: id,
      blockHeight,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalPauseToggled",
      proposalPublicKey: proposalKey,
      pausedPayload: false,
      senderPublicKey: senderKey,
    });
    const execution = (
      id: string,
      blockHeight: number,
    ): OracleExecutionEvent => ({
      id,
      changeSequence: id,
      blockHeight,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalExecuted",
      proposalPublicKey: proposalKey,
      recipient: recipientKey,
      amountToPayOut: "1",
      senderPublicKey: senderKey,
    });
    const vote = (id: string, blockHeight: number): OracleVoteEvent => ({
      id,
      changeSequence: id,
      blockHeight,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVoteDispatched",
      proposalPublicKey: proposalKey,
      voterPublicKey: voterOneKey,
      vote: "yay",
      senderPublicKey: senderKey,
    });
    await deliver(createdEvent(), "creation");
    await deliver(vote("2", 109), "vote keeps UNKNOWN");
    await deliver(approvedTally("3", 110), "tally sets APPROVED");
    await deliver(execution("4", 111), "execution keeps APPROVED");
    let storedProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey });
    assert.equal(storedProposal.contractStatus, "approved");
    assert.equal(storedProposal.contractStatusSourceEventId, "3");

    await deliver(pause("5", 112), "toggle sets PAUSED");
    await deliver(pause("6", 113), "toggle restores UNKNOWN");
    await deliver(rejectedTally("7", 114), "tally sets REJECTED");
    storedProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey });
    assert.equal(storedProposal.contractStatus, "rejected");
    assert.equal(storedProposal.contractStatusSourceEventId, "7");
  });

  it("PROCESSOR_POLICY: follows source order for same-block status transitions", async () => {
    await deliver(createdEvent(), "creation");
    await deliver(
      {
        id: "2",
        changeSequence: "2",
        blockHeight: 101,
        blockEventIndex: 0,
        status: "canonical",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
        vote: "yay",
        senderPublicKey: senderKey,
      },
      "vote",
    );

    const firstTally: OracleTallyEvent = {
      id: "3",
      changeSequence: "3",
      blockHeight: 110,
      blockEventIndex: 0,
      status: "canonical",
      type: "proposalVotesTallied",
      proposalPublicKey: proposalKey,
      lifecycleId: 2,
      yayWeight: "60",
      nayWeight: "0",
      abstainWeight: "0",
      voteResult: "approved",
      senderPublicKey: senderKey,
    };
    await deliver(firstTally, "first tally");
    await deliver(
      {
        id: "4",
        changeSequence: "4",
        blockHeight: 110,
        blockEventIndex: 1,
        status: "canonical",
        type: "proposalPauseToggled",
        proposalPublicKey: proposalKey,
        pausedPayload: true,
        senderPublicKey: senderKey,
      },
      "pause",
    );
    await deliver(
      {
        id: "5",
        changeSequence: "5",
        blockHeight: 110,
        blockEventIndex: 2,
        status: "canonical",
        type: "proposalPauseToggled",
        proposalPublicKey: proposalKey,
        pausedPayload: false,
        senderPublicKey: senderKey,
      },
      "unpause",
    );
    await deliver(
      {
        ...firstTally,
        id: "6",
        changeSequence: "6",
        blockEventIndex: 3,
      },
      "second tally",
    );

    const tallies = await dataSource.getRepository(VoteTallyEntity).find({
      where: { proposalPublicKey: proposalKey, blockHeight: 110 },
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      tallies.map((tally) => tally.archiveEventId),
      ["3", "6"],
    );
    const storedProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey });
    assert.equal(storedProposal.contractStatus, "approved");
    assert.equal(
      storedProposal.contractStatusSourceEventId,
      "6",
      "the last status transition is the second tally",
    );
  });

  it("PROCESSOR_POLICY: matches the contract oracle across seeded delivery and full fork rollback", async () => {
    const sourceEvents: OracleProposalEvent[] = [
      { ...createdEvent(), id: "900" },
      {
        id: "80",
        changeSequence: "1",
        blockHeight: 101,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterTwoKey,
        vote: "dummy",
        senderPublicKey: senderKey,
      },
      {
        id: "70",
        changeSequence: "1",
        blockHeight: 101,
        blockEventIndex: 1,
        status: "pending",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterTwoKey,
        vote: "abstain",
        senderPublicKey: senderKey,
      },
      {
        id: "60",
        changeSequence: "1",
        blockHeight: 101,
        blockEventIndex: 2,
        status: "pending",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
        vote: "yay",
        senderPublicKey: senderKey,
      },
      {
        id: "50",
        changeSequence: "1",
        blockHeight: 101,
        blockEventIndex: 3,
        status: "pending",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: voterOneKey,
        vote: "nay",
        senderPublicKey: senderKey,
      },
      {
        id: "40",
        changeSequence: "1",
        blockHeight: 101,
        blockEventIndex: 4,
        status: "pending",
        type: "proposalVoteDispatched",
        proposalPublicKey: proposalKey,
        voterPublicKey: emptyKey,
        vote: "dummy",
        senderPublicKey: senderKey,
      },
      {
        id: "30",
        changeSequence: "1",
        blockHeight: 110,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalVotesTallied",
        proposalPublicKey: proposalKey,
        lifecycleId: 2,
        yayWeight: "60",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: senderKey,
      },
      {
        id: "20",
        changeSequence: "1",
        blockHeight: 111,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalPauseToggled",
        proposalPublicKey: proposalKey,
        pausedPayload: false,
        senderPublicKey: senderKey,
      },
      {
        id: "10",
        changeSequence: "1",
        blockHeight: 112,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalPauseToggled",
        proposalPublicKey: proposalKey,
        pausedPayload: false,
        senderPublicKey: senderKey,
      },
      {
        id: "19",
        changeSequence: "1",
        blockHeight: 113,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalVotesTallied",
        proposalPublicKey: proposalKey,
        lifecycleId: 2,
        yayWeight: "60",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: senderKey,
      },
      {
        id: "99",
        changeSequence: "1",
        blockHeight: 120,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalExecuted",
        proposalPublicKey: proposalKey,
        recipient: recipientKey,
        amountToPayOut: "500",
        senderPublicKey: senderKey,
      },
      {
        id: "5",
        changeSequence: "1",
        blockHeight: 120,
        blockEventIndex: 1,
        status: "pending",
        type: "proposalExecuted",
        proposalPublicKey: proposalKey,
        recipient: recipientKey,
        amountToPayOut: "600",
        senderPublicKey: senderKey,
      },
    ];

    for (let scenario = 0; scenario < 8; scenario += 1) {
      if (scenario > 0) {
        await dataSource.destroy();
        await initializeHarness();
      }
      let changeSequence = 1n;
      const observe = async (
        event: OracleProposalEvent,
        status: OracleProposalEvent["status"],
        label: string,
        changes: Partial<OracleProposalEvent> = {},
      ): Promise<OracleProposalEvent> => {
        const observation = {
          ...event,
          ...changes,
          status,
          changeSequence: String(changeSequence++),
        } as OracleProposalEvent;
        await deliver(observation, `seed=${scenario} ${label}`);
        return observation;
      };

      const pending = new Map<string, OracleProposalEvent>();
      for (const event of seededShuffle(sourceEvents, 0x51_000 + scenario)) {
        pending.set(
          event.id,
          await observe(event, "pending", `pending id=${event.id}`),
        );
      }
      for (const event of seededShuffle(
        [...pending.values()],
        0xc4_000 + scenario,
      )) {
        pending.set(
          event.id,
          await observe(event, "canonical", `canonical id=${event.id}`),
        );
      }

      const firstExecution = pending.get("99") as OracleExecutionEvent;
      const secondExecution = pending.get("5") as OracleExecutionEvent;
      const executionRows = await dataSource
        .getRepository(ProposalExecutionEntity)
        .findBy({ proposalPublicKey: proposalKey });
      assert.equal(
        executionRows.find(
          (execution) => execution.archiveEventId === firstExecution.id,
        )?.paidOutAmount,
        "500",
      );
      assert.equal(
        executionRows.find(
          (execution) => execution.archiveEventId === secondExecution.id,
        )?.paidOutAmount,
        "1100",
      );

      const creation = pending.get("900") as OracleCreatedEvent;
      const orphanedCreation = await observe(
        creation,
        "orphaned",
        "creation rollback",
      );
      const reactivatedCreation = await observe(
        orphanedCreation,
        "pending",
        "creation reactivation",
      );
      pending.set(
        creation.id,
        await observe(reactivatedCreation, "canonical", "creation finality"),
      );

      const rollbackOrder = ["5", "99", "19", "10", "20", "30"];
      for (const id of rollbackOrder) {
        const event = pending.get(id)!;
        pending.set(id, await observe(event, "orphaned", `rollback id=${id}`));
      }
      for (const id of ["80", "70", "60", "50", "40"]) {
        const event = pending.get(id)!;
        pending.set(id, await observe(event, "orphaned", `rollback id=${id}`));
      }

      const reorderedPositions = new Map<string, number>([
        ["70", 0],
        ["80", 1],
        ["50", 2],
        ["60", 3],
        ["40", 4],
      ]);
      for (const id of seededShuffle(
        ["80", "70", "60", "50", "40"],
        0xf0_000 + scenario,
      )) {
        const event = pending.get(id)!;
        pending.set(
          id,
          await observe(event, "pending", `reinclude id=${id}`, {
            blockEventIndex: reorderedPositions.get(id)!,
            stateHash: "replacement-state-101",
          }),
        );
      }
      for (const id of seededShuffle(
        ["80", "70", "60", "50", "40"],
        0xfa_000 + scenario,
      )) {
        const event = pending.get(id)!;
        pending.set(id, await observe(event, "canonical", `finalize id=${id}`));
      }

      const replacementTally: OracleTallyEvent = {
        id: `100${scenario}`,
        changeSequence: "1",
        blockHeight: 110,
        blockEventIndex: 0,
        status: "pending",
        type: "proposalVotesTallied",
        proposalPublicKey: proposalKey,
        lifecycleId: 2,
        yayWeight: "0",
        nayWeight: "60",
        abstainWeight: "25",
        voteResult: "rejected",
        senderPublicKey: senderKey,
        stateHash: "replacement-state-110",
      };
      const pendingReplacementTally = await observe(
        replacementTally,
        "pending",
        "replacement rejected tally",
      );
      await observe(
        pendingReplacementTally,
        "canonical",
        "replacement tally finality",
      );

      const rows = await dataSource.getRepository(VoteEntity).findBy({
        proposalPublicKey: proposalKey,
      });
      assert.equal(
        rows.find((vote) => vote.archiveEventId === "70")?.voteWeight,
        "25",
      );
      assert.equal(
        rows.find((vote) => vote.archiveEventId === "50")?.voteWeight,
        "60",
      );
      assert.equal(
        (
          await dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey: proposalKey })
        ).contractStatus,
        "rejected",
      );
    }
  });
});
