import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { ProposalStatus } from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  Vote,
  VoteAction,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  ProposalPauseToggledEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { Bool, Field, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import type {
  VotingLedgerService,
  VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import {
  VoteEntity,
  type VoteLabel,
} from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import {
  VoteTallyEntity,
  type VoteTallyVoteResult,
} from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";
import {
  assessReferenceFinalTally,
  referenceAcceptanceCriteria,
  referenceApprovalDecision,
  referenceTotalPayout,
} from "./support/proposal-contract-bigint-reference.js";

type ArchiveStatus = "pending" | "canonical" | "orphaned";
type ProposalEventName =
  | typeof PROPOSAL_CREATED_EVENT_NAME
  | typeof PROPOSAL_EXECUTED_EVENT_NAME
  | typeof PROPOSAL_PAUSE_TOGGLED_EVENT_NAME
  | typeof PROPOSAL_VOTE_DISPATCHED_EVENT_NAME
  | typeof PROPOSAL_VOTES_TALLIED_EVENT_NAME;

const EVENT_NAMES: ProposalEventName[] = [
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
].sort();

const sender = PrivateKey.fromBigInt(101n).toPublicKey();
const recipient = PrivateKey.fromBigInt(102n).toPublicKey();
const senderKey = sender.toBase58();
const recipientKey = recipient.toBase58();
const emptyKey = PublicKey.empty().toBase58();
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

function publicKey(seed: number): PublicKey {
  return PrivateKey.fromBigInt(BigInt(seed)).toPublicKey();
}

function voteField(vote: VoteLabel): Vote {
  if (vote === "yay") return Vote.YAY;
  if (vote === "nay") return Vote.NAY;
  if (vote === "abstain") return Vote.ABSTRAIN;
  return Vote.DUMMY;
}

interface EventInput {
  id?: string;
  changeSequence?: string;
  eventType: ProposalEventName;
  blockHeight: number;
  blockEventIndex?: number;
  status?: ArchiveStatus;
  stateHash?: string;
  parentHash?: string;
  chainStatus?: string;
  rawEventData: Record<string, unknown>;
}

class EventClock {
  private nextId = 1n;
  private nextChangeSequence = 1n;

  public event(input: EventInput): ArchiveEventEntity {
    const id = input.id ?? String(this.nextId++);
    const changeSequence =
      input.changeSequence ?? String(this.nextChangeSequence++);
    const status = input.status ?? "canonical";
    const blockEventIndex = input.blockEventIndex ?? 0;
    const timestamp = new Date(
      Date.UTC(2026, 0, 1, 0, 0, input.blockHeight % 60),
    );
    return {
      id,
      changeSequence,
      status,
      pendingSeenAtHeight: null,
      blockHeight: input.blockHeight,
      blockTimestamp: timestamp,
      globalSlotSinceGenesis: input.blockHeight,
      stateHash: input.stateHash ?? `state-${input.blockHeight}`,
      parentHash: input.parentHash ?? `state-${input.blockHeight - 1}`,
      chainStatus:
        input.chainStatus ?? (status === "canonical" ? "canonical" : "pending"),
      eventType: input.eventType,
      txHash: `tx-${id}`,
      accountUpdateId: id,
      accountUpdateIndex: 0,
      eventIndex: blockEventIndex,
      blockEventIndex,
      rawEventData: input.rawEventData,
      indexedAt: timestamp,
      updatedAt: new Date(timestamp.getTime() + Number(changeSequence)),
    } as unknown as ArchiveEventEntity;
  }

  public contractEvent(
    input: Omit<EventInput, "rawEventData">,
    fields: string[],
  ): ArchiveEventEntity {
    return this.event({
      ...input,
      rawEventData: {
        data: [String(EVENT_NAMES.indexOf(input.eventType)), ...fields],
      },
    });
  }

  public replay(
    event: ArchiveEventEntity,
    status: ArchiveStatus,
  ): ArchiveEventEntity {
    return this.event({
      id: String(event.id),
      eventType: event.eventType as ProposalEventName,
      blockHeight: event.blockHeight!,
      blockEventIndex: event.blockEventIndex,
      status,
      stateHash: event.stateHash ?? undefined,
      parentHash: event.parentHash ?? undefined,
      chainStatus: event.chainStatus ?? undefined,
      rawEventData: event.rawEventData as unknown as Record<string, unknown>,
    });
  }
}

function creationFields(input: {
  proposal: PublicKey;
  lifecycleId: number;
  amount: bigint;
  stakingTotal: bigint;
}): string[] {
  return ProposalCreatedEvent.toFields(
    new ProposalCreatedEvent({
      proposalPublicKey: input.proposal,
      lifecycleId: UInt32.from(input.lifecycleId),
      amount: UInt64.from(input.amount),
      recipient,
      zkAppUriHash: Field(input.lifecycleId + 1_000),
      stakingEpochDataLedgerHash: Field(input.lifecycleId + 2_000),
      stakingEpochDataLedgerTotalCurrency: UInt64.from(input.stakingTotal),
      proposerPublicKey: sender,
      senderPublicKey: sender,
    }),
  ).map(String);
}

function voteFields(
  proposal: PublicKey,
  voter: PublicKey,
  vote: VoteLabel,
): string[] {
  return ProposalVoteDispatchedEvent.toFields(
    new ProposalVoteDispatchedEvent({
      proposalPublicKey: proposal,
      voterPublicKey: voter,
      vote: voteField(vote),
      senderPublicKey: sender,
    }),
  ).map(String);
}

function tallyFields(input: {
  proposal: PublicKey;
  lifecycleId: number;
  yay: bigint;
  nay: bigint;
  abstain: bigint;
  result: VoteTallyVoteResult;
}): string[] {
  return ProposalVotesTalliedEvent.toFields(
    new ProposalVotesTalliedEvent({
      proposalPublicKey: input.proposal,
      lifecycleId: UInt32.from(input.lifecycleId),
      yayWeight: UInt64.from(input.yay),
      nayWeight: UInt64.from(input.nay),
      abstainWeight: UInt64.from(input.abstain),
      voteResult:
        input.result === "approved"
          ? ProposalStatus.APPROVED
          : ProposalStatus.REJECTED,
      senderPublicKey: sender,
    }),
  ).map(String);
}

function pauseFields(proposal: PublicKey, paused: boolean): string[] {
  return ProposalPauseToggledEvent.toFields(
    new ProposalPauseToggledEvent({
      proposalPublicKey: proposal,
      paused: Bool(paused),
      senderPublicKey: sender,
    }),
  ).map(String);
}

function executionFields(proposal: PublicKey, amount: bigint): string[] {
  return ProposalExecutedEvent.toFields(
    new ProposalExecutedEvent({
      proposalPublicKey: proposal,
      amountToPayOut: UInt64.from(amount),
      senderPublicKey: sender,
    }),
  ).map(String);
}

interface ContractCriteria {
  requiredParticipationBp: bigint;
  requiredApprovalBp: bigint;
  requiredParticipation: bigint;
}

function contractCriteria(
  amount: bigint,
  treasuryBalance: bigint,
  stakingTotal: bigint,
): ContractCriteria {
  const criteria = referenceAcceptanceCriteria({
    proposalAmount: amount,
    treasuryBalance,
    stakingTotal,
  });
  return {
    requiredParticipationBp: criteria.requiredParticipationBp,
    requiredApprovalBp: criteria.requiredApprovalBp,
    requiredParticipation: criteria.requiredParticipation,
  };
}

function contractDecision(
  yay: bigint,
  nay: bigint,
  abstain: bigint,
  criteria: ContractCriteria,
): {
  approvalBp: bigint;
  totalParticipatingVotes: bigint;
  participationMet: boolean;
  hasApprovalVotes: boolean;
  result: VoteTallyVoteResult;
} {
  const decision = referenceApprovalDecision({
    yay,
    nay,
    abstain,
    requiredParticipation: criteria.requiredParticipation,
    requiredApprovalBp: criteria.requiredApprovalBp,
  });
  return {
    approvalBp: decision.approvalBp,
    totalParticipatingVotes: decision.totalParticipatingVotes,
    participationMet: decision.participationMet,
    hasApprovalVotes: decision.hasApprovalVotes,
    result: decision.voteResult,
  };
}

class GeneratedVotingLedger implements VotingLedgerService {
  public constructor(private readonly weights: ReadonlyMap<string, bigint>) {}

  public async start(): Promise<void> {}

  public async getVoteWeight(voterPublicKey: string): Promise<bigint> {
    return this.weights.get(voterPublicKey) ?? 0n;
  }

  public async close(): Promise<void> {}
}

class GeneratedVotingLedgerLookup implements VotingLedgerServiceLookup {
  public constructor(private readonly weights: ReadonlyMap<string, bigint>) {}

  public async getService(): Promise<VotingLedgerService> {
    return new GeneratedVotingLedger(this.weights);
  }
}

class ProcessorHandlerHarness {
  public readonly clock = new EventClock();
  public readonly balances = new Map<number, bigint>();
  public readonly weights = new Map<string, bigint>();
  public readonly dataSource: DataSource;
  private readonly reconciler: ProposalProjectionReconciler;
  private readonly handlers: Map<ProposalEventName, EventProcessorHandler>;

  public constructor() {
    this.dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      ProposalEventFactEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    const reconciler = new ProposalProjectionReconciler();
    this.reconciler = reconciler;
    this.handlers = new Map<ProposalEventName, EventProcessorHandler>([
      [
        PROPOSAL_CREATED_EVENT_NAME,
        new ProposalCreatedEventHandler(
          {
            resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
              this.balances.get(lifecycleId)?.toString() ?? null,
          },
          reconciler,
        ),
      ],
      [
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        new ProposalVoteDispatchedEventHandler(
          new GeneratedVotingLedgerLookup(this.weights),
          undefined,
          {
            resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
              this.balances.get(lifecycleId)?.toString() ?? null,
          },
          reconciler,
        ),
      ],
      [
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        new ProposalVotesTalliedEventHandler(reconciler),
      ],
      [
        PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
        new ProposalPauseToggledEventHandler(reconciler),
      ],
      [
        PROPOSAL_EXECUTED_EVENT_NAME,
        new ProposalExecutedEventHandler(reconciler),
      ],
    ]);
  }

  public async initialize(): Promise<void> {
    await this.dataSource.initialize();
    await this.dataSource.synchronize();
  }

  public async close(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }

  public async deliver(event: ArchiveEventEntity): Promise<boolean> {
    const handler = this.handlers.get(event.eventType as ProposalEventName);
    assert.ok(handler, `missing handler for ${event.eventType}`);
    return await this.dataSource.transaction(
      async (manager) => await handler.tryHandle(event, manager),
    );
  }

  public async discardRejectedEvent(
    event: ArchiveEventEntity,
    proposalPublicKey: string,
  ): Promise<void> {
    // pg-mem does not restore all writes after a rejected TypeORM transaction.
    // Remove the failed observation and rebuild from the surviving facts.
    const archiveEventId = String(event.id);
    await this.dataSource
      .getRepository(ProposalEventFactEntity)
      .delete({ archiveEventId });
    await this.dataSource.getRepository(VoteEntity).delete({ archiveEventId });
    await this.dataSource
      .getRepository(VoteNullifierEntity)
      .delete({ sourceEventId: archiveEventId });
    await this.dataSource
      .getRepository(VoteTallyEntity)
      .delete({ archiveEventId });
    await this.dataSource
      .getRepository(ProposalExecutionEntity)
      .delete({ archiveEventId });
    await this.dataSource.transaction(
      async (manager) =>
        await this.reconciler.reconcileProposal(proposalPublicKey, manager),
    );
  }

  public async createProposal(input: {
    seed: number;
    lifecycleId: number;
    amount: bigint;
    treasuryBalance: bigint;
    stakingTotal: bigint;
    blockHeight: number;
  }): Promise<{ proposal: PublicKey; criteria: ContractCriteria }> {
    const proposal = publicKey(input.seed);
    const proposalKey = proposal.toBase58();
    this.balances.set(input.lifecycleId, input.treasuryBalance);
    const criteria = contractCriteria(
      input.amount,
      input.treasuryBalance,
      input.stakingTotal,
    );
    const event = this.clock.contractEvent(
      {
        eventType: PROPOSAL_CREATED_EVENT_NAME,
        blockHeight: input.blockHeight,
      },
      creationFields({
        proposal,
        lifecycleId: input.lifecycleId,
        amount: input.amount,
        stakingTotal: input.stakingTotal,
      }),
    );
    assert.equal(await this.deliver(event), true);
    const stored = await this.dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: proposalKey });
    assert.deepEqual(
      {
        requiredParticipationBp: stored.requiredParticipationBp,
        requiredApprovalBp: stored.requiredApprovalBp,
        requiredParticipation: stored.requiredParticipation,
      },
      {
        requiredParticipationBp: criteria.requiredParticipationBp.toString(),
        requiredApprovalBp: criteria.requiredApprovalBp.toString(),
        requiredParticipation: criteria.requiredParticipation.toString(),
      },
    );
    return { proposal, criteria };
  }

  public async vote(input: {
    proposal: PublicKey;
    voter: PublicKey;
    vote: VoteLabel;
    weight: bigint;
    blockHeight: number;
    blockEventIndex?: number;
    status?: ArchiveStatus;
  }): Promise<ArchiveEventEntity> {
    this.weights.set(input.voter.toBase58(), input.weight);
    const event = this.clock.contractEvent(
      {
        eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        blockHeight: input.blockHeight,
        blockEventIndex: input.blockEventIndex,
        status: input.status,
      },
      voteFields(input.proposal, input.voter, input.vote),
    );
    assert.equal(await this.deliver(event), true);
    return event;
  }

  public async tally(input: {
    proposal: PublicKey;
    lifecycleId: number;
    yay: bigint;
    nay: bigint;
    abstain: bigint;
    result: VoteTallyVoteResult;
    blockHeight: number;
    status?: ArchiveStatus;
  }): Promise<ArchiveEventEntity> {
    const event = this.clock.contractEvent(
      {
        eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        blockHeight: input.blockHeight,
        status: input.status,
      },
      tallyFields(input),
    );
    assert.equal(await this.deliver(event), true);
    return event;
  }
}

function createGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe("generated proposal handler harness", () => {
  let harness: ProcessorHandlerHarness;

  beforeEach(async () => {
    harness = new ProcessorHandlerHarness();
    await harness.initialize();
  });

  afterEach(async () => {
    await harness.close();
  });

  describe("classified executable claims", () => {
    it("CONTRACT_NECESSARY_CONDITIONS: projects exact threshold boundaries", async () => {
      const amount = 1_000n;
      const balance = 1_000n;
      const stakingTotal = 10_000n;
      const cases = [
        "approval-exact",
        "approval-below",
        "participation-exact",
        "participation-below",
        "all-abstain",
      ] as const;

      for (const [index, name] of cases.entries()) {
        const lifecycleId = 1_000 + index;
        const baseHeight = 100 + index * 10;
        const { proposal, criteria } = await harness.createProposal({
          seed: 1_000 + index,
          lifecycleId,
          amount,
          treasuryBalance: balance,
          stakingTotal,
          blockHeight: baseHeight,
        });
        const approvalTotal = 10_000n;
        let yay = 0n;
        let nay = 0n;
        let abstain = 0n;
        if (name === "approval-exact" || name === "approval-below") {
          yay =
            criteria.requiredApprovalBp - (name === "approval-below" ? 1n : 0n);
          nay = approvalTotal - yay;
        } else if (name === "participation-exact") {
          yay = criteria.requiredParticipation;
        } else if (name === "participation-below") {
          yay = criteria.requiredParticipation - 1n;
        } else {
          abstain = criteria.requiredParticipation;
        }

        let voteIndex = 0;
        for (const [vote, weight] of [
          ["yay", yay],
          ["nay", nay],
          ["abstain", abstain],
        ] as const) {
          if (weight === 0n) continue;
          await harness.vote({
            proposal,
            voter: publicKey(2_000 + index * 10 + voteIndex),
            vote,
            weight,
            blockHeight: baseHeight + 1,
            blockEventIndex: voteIndex,
          });
          voteIndex += 1;
        }

        const decision = contractDecision(yay, nay, abstain, criteria);
        const proposalKey = proposal.toBase58();
        const runningTally = await harness.dataSource
          .getRepository(VoteTallyEntity)
          .findOneByOrFail({
            proposalPublicKey: proposalKey,
            blockHeight: baseHeight + 1,
          });
        assert.deepEqual(
          {
            total: runningTally.totalParticipatingVotes,
            approvalBp: runningTally.approvalBp,
            result: runningTally.voteResult,
          },
          {
            total: decision.totalParticipatingVotes.toString(),
            approvalBp: decision.approvalBp.toString(),
            result: decision.result,
          },
          name,
        );

        const tallyIsContractReachable =
          decision.participationMet && decision.hasApprovalVotes;
        if (tallyIsContractReachable) {
          const tally = await harness.tally({
            proposal,
            lifecycleId,
            yay,
            nay,
            abstain,
            result: decision.result,
            blockHeight: baseHeight + 2,
          });
          const stored = await harness.dataSource
            .getRepository(VoteTallyEntity)
            .findOneByOrFail({ archiveEventId: String(tally.id) });
          assert.equal(stored.voteResult, decision.result, name);
          assert.equal(
            (
              await harness.dataSource
                .getRepository(ProposalEntity)
                .findOneByOrFail({ proposalPublicKey: proposalKey })
            ).contractStatus,
            decision.result,
            name,
          );
        } else {
          assert.equal(
            await harness.dataSource.getRepository(VoteTallyEntity).countBy({
              proposalPublicKey: proposalKey,
              createdByEventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
            }),
            0,
            `${name}: the contract cannot emit a tally event`,
          );
        }
      }
    });

    it("CONTRACT_NECESSARY_CONDITIONS: projects seeded histories through literal BigInt decisions", async () => {
      const generatorSeed = 0x5eed_c0de;
      const random = createGenerator(generatorSeed);
      const scenarioCount = 12;

      for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
        const lifecycleId = 2_000 + scenario;
        const baseHeight = 1_000 + scenario * 20;
        const amount = BigInt(100 + (random() % 901));
        const balance = 1_000n;
        const stakingTotal = 10_000n;
        const replayActions = [`create(amount=${amount})`];
        const { proposal, criteria } = await harness.createProposal({
          seed: 3_000 + scenario,
          lifecycleId,
          amount,
          treasuryBalance: balance,
          stakingTotal,
          blockHeight: baseHeight,
        });
        const voterCount = 4 + (random() % 5);
        let yay = 0n;
        let nay = 0n;
        let abstain = 0n;
        const voters: PublicKey[] = [];

        for (let voteIndex = 0; voteIndex < voterCount; voteIndex += 1) {
          const voter = publicKey(4_000 + scenario * 20 + voteIndex);
          const vote =
            voteIndex === 0
              ? "yay"
              : (["yay", "nay", "abstain"] as const)[random() % 3]!;
          const weight = BigInt(400 + (random() % 1_601));
          voters.push(voter);
          if (vote === "yay") yay += weight;
          if (vote === "nay") nay += weight;
          if (vote === "abstain") abstain += weight;
          replayActions.push(`vote(${vote},${weight})`);
          await harness.vote({
            proposal,
            voter,
            vote,
            weight,
            blockHeight: baseHeight + 1 + Math.floor(voteIndex / 3),
            blockEventIndex: voteIndex % 3,
          });
        }

        const participating = yay + nay + abstain;
        if (participating < criteria.requiredParticipation) {
          const topUp = criteria.requiredParticipation - participating;
          const voter = publicKey(4_000 + scenario * 20 + voterCount);
          voters.push(voter);
          yay += topUp;
          replayActions.push(`vote(yay,${topUp})`);
          await harness.vote({
            proposal,
            voter,
            vote: "yay",
            weight: topUp,
            blockHeight: baseHeight + 5,
          });
        }

        const firstVoter = voters[0]!;
        const repeatedVote = await harness.vote({
          proposal,
          voter: firstVoter,
          vote: "nay",
          weight: harness.weights.get(firstVoter.toBase58())!,
          blockHeight: baseHeight + 6,
        });
        replayActions.push("duplicate(nay)");
        if (scenario % 3 === 0) {
          const pause = harness.clock.contractEvent(
            {
              eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
              blockHeight: baseHeight + 7,
            },
            pauseFields(proposal, false),
          );
          const unpause = harness.clock.contractEvent(
            {
              eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
              blockHeight: baseHeight + 8,
            },
            pauseFields(proposal, true),
          );
          assert.equal(await harness.deliver(pause), true);
          assert.equal(await harness.deliver(unpause), true);
          replayActions.push("pause", "unpause");
        }

        const decision = contractDecision(yay, nay, abstain, criteria);
        replayActions.push(
          `tally(${yay},${nay},${abstain},${decision.result})`,
        );
        const failureContext = `seed=${generatorSeed} scenario=${scenario} minimizedActions=${JSON.stringify(replayActions)}`;
        assert.equal(decision.participationMet, true, failureContext);
        assert.equal(decision.hasApprovalVotes, true, failureContext);
        const tally = await harness.tally({
          proposal,
          lifecycleId,
          yay,
          nay,
          abstain,
          result: decision.result,
          blockHeight: baseHeight + 10,
        });
        const proposalKey = proposal.toBase58();
        const [storedTally, storedProposal, repeatedVoteRow, nullifiers] =
          await Promise.all([
            harness.dataSource
              .getRepository(VoteTallyEntity)
              .findOneByOrFail({ archiveEventId: String(tally.id) }),
            harness.dataSource
              .getRepository(ProposalEntity)
              .findOneByOrFail({ proposalPublicKey: proposalKey }),
            harness.dataSource
              .getRepository(VoteEntity)
              .findOneByOrFail({ archiveEventId: String(repeatedVote.id) }),
            harness.dataSource
              .getRepository(VoteNullifierEntity)
              .findBy({ proposalPublicKey: proposalKey }),
          ]);
        assert.deepEqual(
          {
            yay: storedTally.yayWeight,
            nay: storedTally.nayWeight,
            abstain: storedTally.abstainWeight,
            total: storedTally.totalParticipatingVotes,
            approvalBp: storedTally.approvalBp,
            result: storedTally.voteResult,
          },
          {
            yay: yay.toString(),
            nay: nay.toString(),
            abstain: abstain.toString(),
            total: decision.totalParticipatingVotes.toString(),
            approvalBp: decision.approvalBp.toString(),
            result: decision.result,
          },
          failureContext,
        );
        assert.equal(
          storedProposal.contractStatus,
          decision.result,
          failureContext,
        );
        assert.equal(repeatedVoteRow.isNullified, true, failureContext);
        assert.equal(repeatedVoteRow.voteWeight, "0", failureContext);
        assert.equal(nullifiers.length, voters.length, failureContext);
      }
    });

    it("PROCESSOR_POLICY: handles non-empty DUMMY and exact padding", async () => {
      const { proposal } = await harness.createProposal({
        seed: 7_000,
        lifecycleId: 3_000,
        amount: 100n,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 3_000,
      });
      const voter = publicKey(7_001);
      const nonEmptyDummy = await harness.vote({
        proposal,
        voter,
        vote: "dummy",
        weight: 777n,
        blockHeight: 3_001,
        blockEventIndex: 0,
      });
      const repeatedRealVote = await harness.vote({
        proposal,
        voter,
        vote: "yay",
        weight: 777n,
        blockHeight: 3_002,
        blockEventIndex: 1,
      });
      const exactPadding = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 3_001,
          blockEventIndex: 2,
        },
        voteFields(proposal, PublicKey.empty(), "dummy"),
      );
      assert.equal(
        VoteAction.isDummy(
          new VoteAction({ vote: Vote.DUMMY, publicKey: voter }),
        ).toBoolean(),
        false,
      );
      assert.equal(VoteAction.isDummy(VoteAction.dummy()).toBoolean(), true);
      assert.equal(await harness.deliver(exactPadding), true);

      const proposalKey = proposal.toBase58();
      const [nullifiers, votes, tally] = await Promise.all([
        harness.dataSource
          .getRepository(VoteNullifierEntity)
          .findBy({ proposalPublicKey: proposalKey }),
        harness.dataSource.getRepository(VoteEntity).find({
          where: { proposalPublicKey: proposalKey },
          order: { archiveEventId: "ASC" },
        }),
        harness.dataSource.getRepository(VoteTallyEntity).findOneByOrFail({
          proposalPublicKey: proposalKey,
          blockHeight: 3_001,
        }),
      ]);
      assert.deepEqual(
        nullifiers.map((row) => ({
          sourceEventId: row.sourceEventId,
          voterPublicKey: row.voterPublicKey,
          vote: row.vote,
          voteWeight: row.voteWeight,
        })),
        [
          {
            sourceEventId: String(nonEmptyDummy.id),
            voterPublicKey: voter.toBase58(),
            vote: "dummy",
            voteWeight: "0",
          },
        ],
      );
      assert.equal(votes.length, 2, "exact padding has no projected vote row");
      assert.equal(
        votes.find((row) => row.archiveEventId === String(repeatedRealVote.id))
          ?.isNullified,
        true,
      );
      assert.deepEqual(
        [tally.yayWeight, tally.nayWeight, tally.abstainWeight],
        ["0", "0", "0"],
      );
      assert.equal(
        await harness.dataSource
          .getRepository(VoteEntity)
          .countBy({ voterPublicKey: emptyKey }),
        0,
      );
    });

    it("PROCESSOR_POLICY: accepts an authoritative tally that differs from incomplete local rows", async () => {
      const lifecycleId = 3_100;
      const { proposal } = await harness.createProposal({
        seed: 7_100,
        lifecycleId,
        amount: 100n,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 3_100,
      });
      await harness.vote({
        proposal,
        voter: publicKey(7_101),
        vote: "yay",
        weight: 500n,
        blockHeight: 3_101,
      });
      const criteria = contractCriteria(100n, 1_000n, 1_000n);
      const assessment = assessReferenceFinalTally({
        lifecycleId: BigInt(lifecycleId),
        expectedLifecycleId: BigInt(lifecycleId),
        yay: 247n,
        nay: 159n,
        abstain: 0n,
        voteResult: "rejected",
        requiredParticipation: criteria.requiredParticipation,
        requiredApprovalBp: criteria.requiredApprovalBp,
      });
      assert.equal(assessment.claimClass, "CONTRACT_NECESSARY_CONDITIONS");
      assert.equal(
        assessment.passesNecessaryConditions,
        true,
        assessment.reasons.join("; "),
      );
      assert.equal(assessment.fullReachabilityProved, false);
      const finalTally = await harness.tally({
        proposal,
        lifecycleId,
        yay: 247n,
        nay: 159n,
        abstain: 0n,
        result: "rejected",
        blockHeight: 3_102,
      });

      const proposalKey = proposal.toBase58();
      const [running, final, storedProposal] = await Promise.all([
        harness.dataSource.getRepository(VoteTallyEntity).findOneByOrFail({
          proposalPublicKey: proposalKey,
          blockHeight: 3_101,
        }),
        harness.dataSource.getRepository(VoteTallyEntity).findOneByOrFail({
          archiveEventId: String(finalTally.id),
        }),
        harness.dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey: proposalKey }),
      ]);

      assert.equal(running.archiveEventId, null);
      assert.equal(
        running.createdByEventType,
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      );
      assert.deepEqual(
        [running.yayWeight, running.nayWeight, running.abstainWeight],
        ["500", "0", "0"],
      );
      assert.equal(final.sourceStatus, "canonical");
      assert.equal(final.createdByEventType, PROPOSAL_VOTES_TALLIED_EVENT_NAME);
      assert.deepEqual(
        [final.yayWeight, final.nayWeight, final.abstainWeight],
        ["247", "159", "0"],
      );
      assert.equal(final.totalParticipatingVotes, "406");
      assert.equal(final.voteResult, "rejected");
      assert.equal(storedProposal.contractStatus, "rejected");
      assert.equal(
        storedProposal.contractStatusSourceEventId,
        String(finalTally.id),
      );
    });

    it("PROCESSOR_POLICY: trusts a proof-derived tally when local criteria are missing", async () => {
      const proposal = publicKey(7_200);
      const proposalKey = proposal.toBase58();
      const lifecycleId = 3_200;
      const creation = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_CREATED_EVENT_NAME,
          blockHeight: 3_200,
        },
        creationFields({
          proposal,
          lifecycleId,
          amount: 100n,
          stakingTotal: 1_000n,
        }),
      );
      assert.equal(await harness.deliver(creation), true);
      let storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.requiredParticipation, null);
      assert.equal(storedProposal.requiredApprovalBp, null);

      const tally = await harness.tally({
        proposal,
        lifecycleId,
        yay: 1n,
        nay: 0n,
        abstain: 0n,
        result: "approved",
        blockHeight: 3_201,
      });
      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, "approved");
      assert.deepEqual(
        (
          await harness.dataSource
            .getRepository(VoteTallyEntity)
            .findOneByOrFail({ archiveEventId: String(tally.id) })
        ).requiredParticipation,
        null,
      );
    });

    it("PROCESSOR_POLICY: applies pause, tally, and execution projections", async () => {
      const lifecycleId = 4_000;
      const amount = 1_000n;
      const { proposal, criteria } = await harness.createProposal({
        seed: 8_000,
        lifecycleId,
        amount,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 4_000,
      });
      const proposalKey = proposal.toBase58();
      const firstPause = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          blockHeight: 4_001,
        },
        pauseFields(proposal, false),
      );
      assert.equal(await harness.deliver(firstPause), true);
      let storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, "paused");
      assert.equal(storedProposal.isPaused, true);

      const secondPause = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          blockHeight: 4_002,
        },
        pauseFields(proposal, true),
      );
      assert.equal(await harness.deliver(secondPause), true);
      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, "unknown");
      assert.equal(storedProposal.isPaused, false);

      const yay = criteria.requiredParticipation;
      await harness.vote({
        proposal,
        voter: publicKey(8_001),
        vote: "yay",
        weight: yay,
        blockHeight: 4_003,
      });
      const decision = contractDecision(yay, 0n, 0n, criteria);
      assert.equal(decision.result, "approved");
      await harness.tally({
        proposal,
        lifecycleId,
        yay,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 4_004,
      });

      const totalPayout = referenceTotalPayout(amount);
      const firstPayout = 400n;
      const firstExecution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 4_005,
        },
        executionFields(proposal, firstPayout),
      );
      assert.equal(await harness.deliver(firstExecution), true);

      for (const [height, payload] of [
        [4_006, true],
        [4_007, false],
      ] as const) {
        assert.equal(
          await harness.deliver(
            harness.clock.contractEvent(
              {
                eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
                blockHeight: height,
              },
              pauseFields(proposal, payload),
            ),
          ),
          true,
        );
      }
      assert.equal(
        (
          await harness.dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey: proposalKey })
        ).contractStatus,
        "unknown",
      );
      await harness.tally({
        proposal,
        lifecycleId,
        yay,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 4_008,
      });
      const finalExecution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 4_009,
        },
        executionFields(proposal, totalPayout - firstPayout),
      );
      assert.equal(await harness.deliver(finalExecution), true);

      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, "approved");
      assert.equal(storedProposal.paidOutAmount, totalPayout.toString());
      assert.deepEqual(
        (
          await harness.dataSource.getRepository(ProposalExecutionEntity).find({
            where: { proposalPublicKey: proposalKey },
            order: { blockHeight: "ASC" },
          })
        ).map((row) => [row.paidOutAmount, row.remainingAmount]),
        [
          [firstPayout.toString(), (totalPayout - firstPayout).toString()],
          [totalPayout.toString(), "0"],
        ],
      );
    });

    it("PROCESSOR_POLICY: reconciles replay and archive status transitions", async () => {
      const lifecycleId = 5_000;
      const { proposal, criteria } = await harness.createProposal({
        seed: 9_000,
        lifecycleId,
        amount: 1_000n,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 5_000,
      });
      const voter = publicKey(9_001);
      const yayWeight = criteria.requiredParticipation;
      const firstVote = await harness.vote({
        proposal,
        voter,
        vote: "yay",
        weight: yayWeight,
        blockHeight: 5_001,
        blockEventIndex: 0,
        status: "pending",
      });
      const repeatVote = await harness.vote({
        proposal,
        voter,
        vote: "nay",
        weight: yayWeight,
        blockHeight: 5_002,
        blockEventIndex: 1,
        status: "pending",
      });
      const proposalKey = proposal.toBase58();

      await harness.deliver(harness.clock.replay(firstVote, "orphaned"));
      let nullifier = await harness.dataSource
        .getRepository(VoteNullifierEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(nullifier.sourceEventId, String(repeatVote.id));
      assert.equal(nullifier.vote, "nay");

      await harness.deliver(harness.clock.replay(firstVote, "pending"));
      await harness.deliver(harness.clock.replay(firstVote, "canonical"));
      await harness.deliver(harness.clock.replay(repeatVote, "canonical"));
      nullifier = await harness.dataSource
        .getRepository(VoteNullifierEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(nullifier.sourceEventId, String(firstVote.id));
      assert.equal(nullifier.vote, "yay");
      assert.equal(
        (
          await harness.dataSource.getRepository(VoteEntity).findOneByOrFail({
            archiveEventId: String(repeatVote.id),
          })
        ).isNullified,
        true,
      );

      const decision = contractDecision(yayWeight, 0n, 0n, criteria);
      const pendingTally = await harness.tally({
        proposal,
        lifecycleId,
        yay: yayWeight,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 5_003,
        status: "pending",
      });
      let storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, decision.result);
      assert.equal(storedProposal.contractStatusFinality, "pending");
      assert.equal(
        (
          await harness.dataSource
            .getRepository(VoteTallyEntity)
            .findOneByOrFail({ archiveEventId: String(pendingTally.id) })
        ).sourceStatus,
        "pending",
      );

      await harness.deliver(harness.clock.replay(pendingTally, "orphaned"));
      assert.equal(
        await harness.dataSource
          .getRepository(VoteTallyEntity)
          .countBy({ archiveEventId: String(pendingTally.id) }),
        0,
      );
      const canonicalTally = harness.clock.replay(pendingTally, "canonical");
      await harness.deliver(canonicalTally);
      await harness.deliver(canonicalTally);
      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, decision.result);
      assert.equal(
        storedProposal.contractStatusSourceEventId,
        String(pendingTally.id),
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ archiveEventId: String(pendingTally.id) }),
        1,
      );
    });

    it("PROCESSOR_POLICY: overlays pending effects and removes them on rollback", async () => {
      const pauseProposal = (
        await harness.createProposal({
          seed: 9_300,
          lifecycleId: 5_300,
          amount: 100n,
          treasuryBalance: 1_000n,
          stakingTotal: 1_000n,
          blockHeight: 5_300,
        })
      ).proposal;
      const pendingPause = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
          blockHeight: 5_301,
          status: "pending",
          stateHash: "fork-pause-5301",
        },
        pauseFields(pauseProposal, true),
      );
      const mainVoter = publicKey(9_301);
      harness.weights.set(mainVoter.toBase58(), 1n);
      const canonicalVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_301,
          blockEventIndex: 1,
          status: "canonical",
          stateHash: "main-5301",
        },
        voteFields(pauseProposal, mainVoter, "yay"),
      );
      assert.equal(await harness.deliver(pendingPause), true);
      assert.equal(await harness.deliver(canonicalVote), true);
      assert.equal(
        (
          await harness.dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey: pauseProposal.toBase58() })
        ).isPaused,
        true,
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ archiveEventId: String(pendingPause.id) }),
        1,
        "the pending pause fact remains as provenance",
      );

      const voteProposal = (
        await harness.createProposal({
          seed: 9_320,
          lifecycleId: 5_320,
          amount: 100n,
          treasuryBalance: 1_000n,
          stakingTotal: 1_000n,
          blockHeight: 5_320,
        })
      ).proposal;
      const forkVoter = publicKey(9_321);
      const canonicalVoter = publicKey(9_322);
      harness.weights.set(forkVoter.toBase58(), 50n);
      harness.weights.set(canonicalVoter.toBase58(), 60n);
      const pendingVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_321,
          status: "pending",
          stateHash: "fork-vote-5321",
        },
        voteFields(voteProposal, forkVoter, "yay"),
      );
      const mainVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_321,
          blockEventIndex: 1,
          status: "canonical",
          stateHash: "main-5321",
        },
        voteFields(voteProposal, canonicalVoter, "nay"),
      );
      assert.equal(await harness.deliver(pendingVote), true);
      assert.equal(await harness.deliver(mainVote), true);
      const forkVoteRow = await harness.dataSource
        .getRepository(VoteEntity)
        .findOneByOrFail({ archiveEventId: String(pendingVote.id) });
      assert.equal(forkVoteRow.status, "pending");
      assert.equal(forkVoteRow.voteWeight, "50");
      assert.equal(forkVoteRow.isNullified, false);
      assert.deepEqual(
        (
          await harness.dataSource.getRepository(VoteNullifierEntity).findBy({
            proposalPublicKey: voteProposal.toBase58(),
          })
        )
          .map((row) => row.voterPublicKey)
          .sort(),
        [forkVoter.toBase58(), canonicalVoter.toBase58()].sort(),
      );

      const lifecycleId = 5_340;
      const { proposal: executionProposal, criteria } =
        await harness.createProposal({
          seed: 9_340,
          lifecycleId,
          amount: 100n,
          treasuryBalance: 1_000n,
          stakingTotal: 1_000n,
          blockHeight: 5_340,
        });
      await harness.tally({
        proposal: executionProposal,
        lifecycleId,
        yay: criteria.requiredParticipation,
        nay: 0n,
        abstain: 0n,
        result: "approved",
        blockHeight: 5_341,
      });
      const pendingExecution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 5_342,
          status: "pending",
          stateHash: "fork-execution-5342",
        },
        executionFields(executionProposal, 20n),
      );
      const canonicalExecution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 5_342,
          blockEventIndex: 1,
          status: "canonical",
          stateHash: "main-5342",
        },
        executionFields(executionProposal, 10n),
      );
      assert.equal(await harness.deliver(pendingExecution), true);
      assert.equal(await harness.deliver(canonicalExecution), true);
      const executionProposalKey = executionProposal.toBase58();
      assert.equal(
        (
          await harness.dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey: executionProposalKey })
        ).paidOutAmount,
        "30",
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalExecutionEntity)
          .countBy({ proposalPublicKey: executionProposalKey }),
        2,
        "the pending fork row remains as provenance",
      );

      assert.equal(
        await harness.deliver(
          harness.clock.replay(pendingExecution, "orphaned"),
        ),
        true,
      );
      assert.equal(
        (
          await harness.dataSource
            .getRepository(ProposalEntity)
            .findOneByOrFail({ proposalPublicKey: executionProposalKey })
        ).paidOutAmount,
        "10",
      );
      const survivingExecution = await harness.dataSource
        .getRepository(ProposalExecutionEntity)
        .findOneByOrFail({ archiveEventId: String(canonicalExecution.id) });
      assert.equal(survivingExecution.paidOutAmount, "10");
      assert.equal(survivingExecution.remainingAmount, "100");
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalExecutionEntity)
          .countBy({ archiveEventId: String(pendingExecution.id) }),
        0,
      );
    });

    it("PROCESSOR_POLICY: removes and rebuilds the projection with its creation fact", async () => {
      const lifecycleId = 5_360;
      const amount = 100n;
      const proposal = publicKey(9_360);
      const proposalKey = proposal.toBase58();
      const treasuryBalance = 1_000n;
      const stakingTotal = 1_000n;
      const criteria = contractCriteria(amount, treasuryBalance, stakingTotal);
      harness.balances.set(lifecycleId, treasuryBalance);

      const creation = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_CREATED_EVENT_NAME,
          blockHeight: 5_360,
          status: "pending",
        },
        creationFields({ proposal, lifecycleId, amount, stakingTotal }),
      );
      assert.equal(await harness.deliver(creation), true);

      const vote = await harness.vote({
        proposal,
        voter: publicKey(9_361),
        vote: "yay",
        weight: criteria.requiredParticipation,
        blockHeight: 5_361,
        status: "pending",
      });
      const tally = await harness.tally({
        proposal,
        lifecycleId,
        yay: criteria.requiredParticipation,
        nay: 0n,
        abstain: 0n,
        result: "approved",
        blockHeight: 5_362,
        status: "pending",
      });
      const execution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 5_363,
          status: "pending",
        },
        executionFields(proposal, 10n),
      );
      assert.equal(await harness.deliver(execution), true);

      let storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.creationObservationStatus, "pending");
      assert.equal(storedProposal.contractStatus, "approved");
      assert.equal(storedProposal.contractStatusFinality, "pending");
      assert.equal(storedProposal.paidOutAmount, "10");

      for (const event of [creation, vote, tally, execution]) {
        assert.equal(
          await harness.deliver(harness.clock.replay(event, "canonical")),
          true,
        );
      }
      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.creationObservationStatus, "canonical");
      assert.equal(storedProposal.contractStatus, "approved");
      assert.equal(storedProposal.contractStatusFinality, "canonical");
      assert.equal(storedProposal.paidOutAmount, "10");
      assert.equal(
        (
          await harness.dataSource
            .getRepository(VoteEntity)
            .findOneByOrFail({ archiveEventId: String(vote.id) })
        ).status,
        "canonical",
      );
      assert.equal(
        (
          await harness.dataSource
            .getRepository(VoteTallyEntity)
            .findOneByOrFail({ archiveEventId: String(tally.id) })
        ).sourceStatus,
        "canonical",
      );
      assert.equal(
        (
          await harness.dataSource
            .getRepository(ProposalExecutionEntity)
            .findOneByOrFail({ archiveEventId: String(execution.id) })
        ).status,
        "canonical",
      );

      assert.equal(
        await harness.deliver(harness.clock.replay(creation, "orphaned")),
        true,
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalEntity)
          .countBy({ proposalPublicKey: proposalKey }),
        0,
      );
      assert.deepEqual(
        await Promise.all([
          harness.dataSource
            .getRepository(VoteEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(VoteNullifierEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(VoteTallyEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(ProposalExecutionEntity)
            .countBy({ proposalPublicKey: proposalKey }),
        ]),
        [0, 0, 0, 0],
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ proposalPublicKey: proposalKey }),
        4,
        "rollback keeps facts so a later status update can rebuild the projection",
      );

      assert.equal(
        await harness.deliver(harness.clock.replay(creation, "canonical")),
        true,
      );
      storedProposal = await harness.dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(storedProposal.contractStatus, "approved");
      assert.equal(storedProposal.paidOutAmount, "10");
      assert.deepEqual(
        await Promise.all([
          harness.dataSource
            .getRepository(VoteEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(VoteNullifierEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(VoteTallyEntity)
            .countBy({ proposalPublicKey: proposalKey }),
          harness.dataSource
            .getRepository(ProposalExecutionEntity)
            .countBy({ proposalPublicKey: proposalKey }),
        ]),
        [1, 1, 2, 1],
      );
    });

    it("PROCESSOR_POLICY: updates source order when orphaned votes reappear in a reordered block", async () => {
      const { proposal } = await harness.createProposal({
        seed: 9_380,
        lifecycleId: 5_380,
        amount: 100n,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 5_380,
      });
      const proposalKey = proposal.toBase58();
      const voter = publicKey(9_381);
      harness.weights.set(voter.toBase58(), 50n);
      const firstVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_381,
          blockEventIndex: 0,
          status: "pending",
          stateHash: "old-5381",
        },
        voteFields(proposal, voter, "yay"),
      );
      const secondVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_381,
          blockEventIndex: 1,
          status: "pending",
          stateHash: "old-5381",
        },
        voteFields(proposal, voter, "nay"),
      );
      assert.equal(await harness.deliver(firstVote), true);
      assert.equal(await harness.deliver(secondVote), true);
      assert.equal(
        (
          await harness.dataSource
            .getRepository(VoteNullifierEntity)
            .findOneByOrFail({ proposalPublicKey: proposalKey })
        ).sourceEventId,
        String(firstVote.id),
      );

      assert.equal(
        await harness.deliver(harness.clock.replay(firstVote, "orphaned")),
        true,
      );
      assert.equal(
        await harness.deliver(harness.clock.replay(secondVote, "orphaned")),
        true,
      );

      const reorderedSecondVote = harness.clock.contractEvent(
        {
          id: String(secondVote.id),
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_381,
          blockEventIndex: 0,
          status: "pending",
          stateHash: "new-5381",
        },
        voteFields(proposal, voter, "nay"),
      );
      const reorderedFirstVote = harness.clock.contractEvent(
        {
          id: String(firstVote.id),
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 5_381,
          blockEventIndex: 1,
          status: "pending",
          stateHash: "new-5381",
        },
        voteFields(proposal, voter, "yay"),
      );
      assert.equal(await harness.deliver(reorderedSecondVote), true);
      assert.equal(await harness.deliver(reorderedFirstVote), true);

      const nullifier = await harness.dataSource
        .getRepository(VoteNullifierEntity)
        .findOneByOrFail({ proposalPublicKey: proposalKey });
      assert.equal(nullifier.sourceEventId, String(secondVote.id));
      assert.equal(nullifier.vote, "nay");
    });

    it("PROCESSOR_POLICY: preserves UInt maxima in event fields and storage", async () => {
      const lifecycleId = Number(UINT32_MAX);
      const { proposal, criteria } = await harness.createProposal({
        seed: 10_000,
        lifecycleId,
        amount: UINT64_MAX,
        treasuryBalance: UINT64_MAX,
        stakingTotal: UINT64_MAX,
        blockHeight: 6_000,
      });
      const voter = publicKey(10_001);
      await harness.vote({
        proposal,
        voter,
        vote: "yay",
        weight: UINT64_MAX,
        blockHeight: 6_001,
      });
      const decision = contractDecision(UINT64_MAX, 0n, 0n, criteria);
      const tally = await harness.tally({
        proposal,
        lifecycleId,
        yay: UINT64_MAX,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 6_002,
      });
      const stored = await harness.dataSource
        .getRepository(VoteTallyEntity)
        .findOneByOrFail({ archiveEventId: String(tally.id) });
      assert.equal(stored.yayWeight, UINT64_MAX.toString());
      assert.equal(stored.totalParticipatingVotes, UINT64_MAX.toString());
      assert.equal(stored.voteResult, "approved");
    });

    it("PROCESSOR_POLICY: reconciles execution delivered before its earlier tally", async () => {
      const lifecycleId = 8_100;
      const amount = 100n;
      const { proposal, criteria } = await harness.createProposal({
        seed: 13_100,
        lifecycleId,
        amount,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 8_100,
      });
      const proposalKey = proposal.toBase58();
      const execution = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 8_102,
        },
        executionFields(proposal, 10n),
      );

      assert.equal(
        await harness.deliver(execution),
        true,
        "an incomplete observation must not block the processor stream",
      );
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({
            archiveEventId: String(execution.id),
          }),
        1,
      );

      const decision = contractDecision(
        criteria.requiredParticipation,
        0n,
        0n,
        criteria,
      );
      const assessment = assessReferenceFinalTally({
        lifecycleId: BigInt(lifecycleId),
        expectedLifecycleId: BigInt(lifecycleId),
        yay: criteria.requiredParticipation,
        nay: 0n,
        abstain: 0n,
        voteResult: decision.result,
        requiredParticipation: criteria.requiredParticipation,
        requiredApprovalBp: criteria.requiredApprovalBp,
      });
      assert.equal(
        assessment.passesNecessaryConditions,
        true,
        assessment.reasons.join("; "),
      );
      await harness.tally({
        proposal,
        lifecycleId,
        yay: criteria.requiredParticipation,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 8_101,
      });

      const [storedProposal, storedExecution] = await Promise.all([
        harness.dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey: proposalKey }),
        harness.dataSource
          .getRepository(ProposalExecutionEntity)
          .findOneByOrFail({ archiveEventId: String(execution.id) }),
      ]);
      assert.equal(storedProposal.contractStatus, "approved");
      assert.equal(storedProposal.paidOutAmount, "10");
      assert.equal(storedExecution.paidOutAmount, "10");
      assert.equal(storedExecution.remainingAmount, "100");
    });
  });

  describe("processor rejection claims", () => {
    it("PROCESSOR_POLICY: rejects archive values outside UInt domains", async () => {
      const validProposal = publicKey(11_000).toBase58();
      const cases: Array<{
        eventType: ProposalEventName;
        payload: Record<string, unknown>;
      }> = [
        {
          eventType: PROPOSAL_CREATED_EVENT_NAME,
          payload: {
            proposalPublicKey: validProposal,
            lifecycleId: (UINT32_MAX + 1n).toString(),
            amount: "1",
            recipient: recipientKey,
            zkAppUriHash: "1",
            stakingEpochDataLedgerHash: "2",
            stakingEpochDataLedgerTotalCurrency: "1",
            proposerPublicKey: senderKey,
            senderPublicKey: senderKey,
          },
        },
        {
          eventType: PROPOSAL_CREATED_EVENT_NAME,
          payload: {
            proposalPublicKey: validProposal,
            lifecycleId: "1",
            amount: (UINT64_MAX + 1n).toString(),
            recipient: recipientKey,
            zkAppUriHash: "1",
            stakingEpochDataLedgerHash: "2",
            stakingEpochDataLedgerTotalCurrency: "1",
            proposerPublicKey: senderKey,
            senderPublicKey: senderKey,
          },
        },
        {
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          payload: {
            proposalPublicKey: validProposal,
            lifecycleId: "1",
            yayWeight: (UINT64_MAX + 1n).toString(),
            nayWeight: "0",
            abstainWeight: "0",
            voteResult: "approved",
            senderPublicKey: senderKey,
          },
        },
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          payload: {
            proposalPublicKey: validProposal,
            amountToPayOut: (UINT64_MAX + 1n).toString(),
            senderPublicKey: senderKey,
          },
        },
      ];

      for (const [index, testCase] of cases.entries()) {
        const event = harness.clock.event({
          eventType: testCase.eventType,
          blockHeight: 7_000 + index,
          rawEventData: testCase.payload,
        });
        assert.equal(await harness.deliver(event), false);
      }
      assert.equal(
        await harness.dataSource.getRepository(ProposalEventFactEntity).count(),
        0,
      );
    });

    it("PROCESSOR_POLICY: enforces local constraints without inventing lifecycle reachability", async () => {
      const lifecycleId = 7_100;
      const amount = 1_000n;
      const { proposal, criteria } = await harness.createProposal({
        seed: 12_000,
        lifecycleId,
        amount,
        treasuryBalance: 1_000n,
        stakingTotal: 1_000n,
        blockHeight: 7_100,
      });
      const proposalKey = proposal.toBase58();
      const yay = criteria.requiredParticipation;
      await harness.vote({
        proposal,
        voter: publicKey(12_002),
        vote: "yay",
        weight: yay,
        blockHeight: 7_101,
      });
      const decision = contractDecision(yay, 0n, 0n, criteria);

      const wrongLifecycle = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          blockHeight: 7_102,
        },
        tallyFields({
          proposal,
          lifecycleId: lifecycleId + 1,
          yay,
          nay: 0n,
          abstain: 0n,
          result: decision.result,
        }),
      );
      await assert.rejects(
        harness.deliver(wrongLifecycle),
        /tally lifecycleId=.*does not match/,
      );
      await harness.discardRejectedEvent(wrongLifecycle, proposalKey);

      await harness.tally({
        proposal,
        lifecycleId,
        yay,
        nay: 0n,
        abstain: 0n,
        result: decision.result,
        blockHeight: 7_103,
      });
      const postTallyVoter = publicKey(12_003);
      harness.weights.set(postTallyVoter.toBase58(), 1n);
      const voteAfterTally = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 7_104,
        },
        voteFields(proposal, postTallyVoter, "yay"),
      );
      assert.equal(
        await harness.deliver(voteAfterTally),
        true,
        "the processor retains an authenticated vote event without inferring its lifecycle schedule",
      );
      assert.equal(
        (
          await harness.dataSource.getRepository(VoteEntity).findOneByOrFail({
            archiveEventId: String(voteAfterTally.id),
          })
        ).voteWeight,
        "1",
      );
      assert.deepEqual(
        (
          await harness.dataSource
            .getRepository(VoteTallyEntity)
            .findOneByOrFail({
              proposalPublicKey: proposalKey,
              createdByEventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
            })
        ).yayWeight,
        yay.toString(),
        "a later vote does not change the authoritative emitted tally",
      );

      const overpay = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_EXECUTED_EVENT_NAME,
          blockHeight: 7_105,
        },
        executionFields(proposal, referenceTotalPayout(amount) + 1n),
      );
      await assert.rejects(
        harness.deliver(overpay),
        /paid out amount exceeds the contract payout limit/,
      );
      await harness.discardRejectedEvent(overpay, proposalKey);
      assert.equal(
        await harness.dataSource
          .getRepository(ProposalExecutionEntity)
          .countBy({ proposalPublicKey: proposalKey }),
        0,
      );
    });

    it("CONTRACT_PROVED: rejects impossible final tally vectors", async () => {
      const cases = [
        "below-participation",
        "no-approval-votes",
        "wrong-result",
      ] as const;

      for (const [index, name] of cases.entries()) {
        const lifecycleId = 7_200 + index;
        const { proposal, criteria } = await harness.createProposal({
          seed: 12_100 + index,
          lifecycleId,
          amount: 100n,
          treasuryBalance: 1_000n,
          stakingTotal: 1_000n,
          blockHeight: 7_200 + index * 10,
        });
        const yay =
          name === "below-participation"
            ? criteria.requiredParticipation - 1n
            : name === "wrong-result"
              ? criteria.requiredParticipation
              : 0n;
        const abstain =
          name === "no-approval-votes" ? criteria.requiredParticipation : 0n;
        const result = name === "wrong-result" ? "rejected" : "approved";
        const assessment = assessReferenceFinalTally({
          lifecycleId: BigInt(lifecycleId),
          expectedLifecycleId: BigInt(lifecycleId),
          yay,
          nay: 0n,
          abstain,
          voteResult: result,
          requiredParticipation: criteria.requiredParticipation,
          requiredApprovalBp: criteria.requiredApprovalBp,
        });
        assert.equal(assessment.claimClass, "CONTRACT_PROVED");
        assert.equal(assessment.passesNecessaryConditions, false, name);

        const impossibleTally = harness.clock.contractEvent(
          {
            eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
            blockHeight: 7_201 + index * 10,
          },
          tallyFields({
            proposal,
            lifecycleId,
            yay,
            nay: 0n,
            abstain,
            result,
          }),
        );
        let rejected = false;
        try {
          rejected = !(await harness.deliver(impossibleTally));
        } catch {
          rejected = true;
        }
        assert.equal(rejected, true, `${name}: impossible tally accepted`);
        await harness.discardRejectedEvent(
          impossibleTally,
          proposal.toBase58(),
        );
      }
    });

    it("PROCESSOR_POLICY: rejects a generated UInt64 running-tally overflow", async () => {
      const { proposal } = await harness.createProposal({
        seed: 13_000,
        lifecycleId: 8_000,
        amount: 1n,
        treasuryBalance: 1n,
        stakingTotal: 1n,
        blockHeight: 8_000,
      });
      await harness.vote({
        proposal,
        voter: publicKey(13_001),
        vote: "yay",
        weight: UINT64_MAX,
        blockHeight: 8_001,
      });
      const overflowVoter = publicKey(13_002);
      harness.weights.set(overflowVoter.toBase58(), 1n);
      const overflowVote = harness.clock.contractEvent(
        {
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 8_002,
        },
        voteFields(proposal, overflowVoter, "yay"),
      );
      await assert.rejects(
        harness.deliver(overflowVote),
        /running yay tally must be in the UInt64 range/,
      );
      await harness.discardRejectedEvent(overflowVote, proposal.toBase58());
      assert.equal(
        await harness.dataSource
          .getRepository(VoteEntity)
          .countBy({ proposalPublicKey: proposal.toBase58() }),
        1,
      );
    });
  });
});
