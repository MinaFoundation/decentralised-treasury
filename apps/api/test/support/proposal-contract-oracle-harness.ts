import assert from "node:assert/strict";
import type { ArchiveEventEntity } from "@repo/indexer";
import { PublicKey } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalEntity } from "../../src/processors/proposals/proposal-entity.js";
import { ProposalExecutionEntity } from "../../src/processors/proposals/proposal-execution-entity.js";
import {
  VoteEntity,
  type VoteLabel,
} from "../../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../../src/processors/proposals/vote-tally-entity.js";
import {
  assessReferenceFinalTally,
  referenceAcceptanceCriteria,
  referenceApprovalDecision,
  referenceTotalPayout,
} from "./proposal-contract-bigint-reference.js";

export type OracleArchiveStatus = "pending" | "canonical" | "orphaned";

interface OracleEventBase {
  id: string;
  changeSequence: string;
  blockHeight: number;
  blockEventIndex: number;
  status: OracleArchiveStatus;
  proposalPublicKey: string;
  globalSlotSinceGenesis?: number;
  stateHash?: string;
  parentHash?: string;
  chainStatus?: string;
}

export interface OracleCreatedEvent extends OracleEventBase {
  type: "proposalCreated";
  lifecycleId: number;
  amount: string;
  recipient: string;
  senderPublicKey: string;
  zkAppUriHash: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
  treasuryBalance: string;
}

export interface OracleVoteEvent extends OracleEventBase {
  type: "proposalVoteDispatched";
  voterPublicKey: string;
  vote: VoteLabel;
  senderPublicKey: string;
}

export interface OracleTallyEvent extends OracleEventBase {
  type: "proposalVotesTallied";
  lifecycleId: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  voteResult: "approved" | "rejected";
  senderPublicKey: string;
}

export interface OraclePauseEvent extends OracleEventBase {
  type: "proposalPauseToggled";
  pausedPayload: boolean;
  senderPublicKey: string;
}

export interface OracleExecutionEvent extends OracleEventBase {
  type: "proposalExecuted";
  recipient: string;
  amountToPayOut: string;
  senderPublicKey: string;
}

export type OracleProposalEvent =
  | OracleCreatedEvent
  | OracleVoteEvent
  | OracleTallyEvent
  | OraclePauseEvent
  | OracleExecutionEvent;

interface OracleVoteRow {
  archiveEventId: string;
  voterPublicKey: string;
  vote: VoteLabel;
  voteWeight: string;
  blockHeight: number | null;
  isNullified: boolean;
  status: "pending" | "canonical";
}

interface OracleNullifierRow {
  sourceEventId: string;
  voterPublicKey: string;
  vote: VoteLabel;
  voteWeight: string;
  blockHeight: number;
}

interface OracleTallyRow {
  archiveEventId: string | null;
  blockHeight: number;
  blockEventIndex: number;
  sourceStatus: "pending" | "canonical";
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  totalParticipatingVotes: string;
  approvalBp: string;
  voteResult: "approved" | "rejected";
  createdByEventType: "proposalVoteDispatched" | "proposalVotesTallied";
}

interface OracleExecutionRow {
  archiveEventId: string;
  lifecycleId: number;
  recipient: string;
  amountToPayOut: string;
  proposalAmount: string;
  bondAmount: string;
  senderPublicKey: string;
  paidOutAmount: string;
  remainingAmount: string;
  blockHeight: number;
  status: "pending" | "canonical";
}

export interface OracleProjectionSnapshot {
  proposal: {
    proposalPublicKey: string;
    lifecycleId: number;
    amount: string;
    recipient: string;
    senderPublicKey: string;
    zkAppUriHash: string;
    stakingEpochDataLedgerHash: string;
    stakingEpochDataLedgerTotalCurrency: string;
    requiredParticipationBp: string;
    requiredApprovalBp: string;
    requiredParticipation: string;
    status: OracleArchiveStatus;
    creationObservationStatus: OracleArchiveStatus;
    contractStatus: "unknown" | "approved" | "rejected" | "paused";
    contractStatusFinality: "pending" | "canonical";
    contractStatusSourceEventId: string | null;
    contractStatusBlockHeight: number | null;
    isPaused: boolean;
    paidOutAmount: string;
  } | null;
  votes: OracleVoteRow[];
  nullifiers: OracleNullifierRow[];
  tallies: OracleTallyRow[];
  executions: OracleExecutionRow[];
}

function compareEventIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareTallyRows(left: OracleTallyRow, right: OracleTallyRow): number {
  if (left.blockHeight !== right.blockHeight) {
    return left.blockHeight - right.blockHeight;
  }
  if (left.blockEventIndex !== right.blockEventIndex) {
    return left.blockEventIndex - right.blockEventIndex;
  }
  if (left.archiveEventId === null) return -1;
  if (right.archiveEventId === null) return 1;
  return compareEventIds(left.archiveEventId, right.archiveEventId);
}

function compareSourceOrder(
  left: OracleProposalEvent,
  right: OracleProposalEvent,
): number {
  if (left.blockHeight !== right.blockHeight) {
    return left.blockHeight - right.blockHeight;
  }
  if (left.blockEventIndex !== right.blockEventIndex) {
    return left.blockEventIndex - right.blockEventIndex;
  }
  return compareEventIds(left.id, right.id);
}

function isActiveProjectionEvent(event: OracleProposalEvent): boolean {
  return event.status !== "orphaned";
}

export function isExactContractDummy(event: OracleVoteEvent): boolean {
  return (
    event.vote === "dummy" &&
    event.voterPublicKey === PublicKey.empty().toBase58()
  );
}

function calculateContractApprovalStatus(
  created: OracleCreatedEvent,
  yay: bigint,
  nay: bigint,
  abstain: bigint,
): {
  approvalBp: string;
  totalParticipatingVotes: string;
  voteResult: "approved" | "rejected";
} {
  const criteria = calculateContractAcceptanceCriteria(created);
  const result = referenceApprovalDecision({
    yay,
    nay,
    abstain,
    requiredParticipation: BigInt(criteria.requiredParticipation),
    requiredApprovalBp: BigInt(criteria.requiredApprovalBp),
  });
  return {
    approvalBp: result.approvalBp.toString(),
    totalParticipatingVotes: result.totalParticipatingVotes.toString(),
    voteResult: result.voteResult,
  };
}

function calculateContractAcceptanceCriteria(created: OracleCreatedEvent): {
  requiredParticipationBp: string;
  requiredApprovalBp: string;
  requiredParticipation: string;
} {
  const criteria = referenceAcceptanceCriteria({
    proposalAmount: BigInt(created.amount),
    treasuryBalance: BigInt(created.treasuryBalance),
    stakingTotal: BigInt(created.stakingEpochDataLedgerTotalCurrency),
  });
  return {
    requiredParticipationBp: criteria.requiredParticipationBp.toString(),
    requiredApprovalBp: criteria.requiredApprovalBp.toString(),
    requiredParticipation: criteria.requiredParticipation.toString(),
  };
}

const UINT64_MAX = (1n << 64n) - 1n;

function requireUInt64(value: bigint, label: string): bigint {
  assert.ok(value >= 0n && value <= UINT64_MAX, `${label} must fit UInt64`);
  return value;
}

// These checks cover necessary field and decision conditions only. They do
// not prove lifecycle, action-history, proof, ledger, or witness reachability.
// Archive delivery can also expose an incomplete change-sequence prefix.
function assertCheckedContractConditions(
  events: readonly OracleProposalEvent[],
  created: OracleCreatedEvent,
): void {
  const criteria = calculateContractAcceptanceCriteria(created);
  let paidOut = 0n;
  const proposalAmount = requireUInt64(
    BigInt(created.amount),
    "proposal amount",
  );

  for (const event of events) {
    if (event.status === "orphaned") continue;
    if (event.type === "proposalVotesTallied") {
      const eventYay = requireUInt64(BigInt(event.yayWeight), "tally yay");
      const eventNay = requireUInt64(BigInt(event.nayWeight), "tally nay");
      const eventAbstain = requireUInt64(
        BigInt(event.abstainWeight),
        "tally abstain",
      );
      const assessment = assessReferenceFinalTally({
        lifecycleId: BigInt(event.lifecycleId),
        expectedLifecycleId: BigInt(created.lifecycleId),
        yay: eventYay,
        nay: eventNay,
        abstain: eventAbstain,
        voteResult: event.voteResult,
        requiredParticipation: BigInt(criteria.requiredParticipation),
        requiredApprovalBp: BigInt(criteria.requiredApprovalBp),
      });
      assert.equal(
        assessment.passesNecessaryConditions,
        true,
        `CONTRACT_NECESSARY_CONDITIONS: ${assessment.reasons.join("; ")}`,
      );
      continue;
    }
    if (event.type === "proposalExecuted") {
      const amountToPayOut = requireUInt64(
        BigInt(event.amountToPayOut),
        "execution amount",
      );
      // CONTRACT_EVENT_SCHEMA_LIMIT: ProposalExecutedEvent does not encode the
      // recipient checked by execute(). The processor can only project the
      // recipient from ProposalCreatedEvent.
      const totalPayout = requireUInt64(
        referenceTotalPayout(proposalAmount),
        "proposal amount plus bond",
      );
      paidOut = requireUInt64(paidOut + amountToPayOut, "paid out amount");
      assert.ok(
        paidOut <= totalPayout,
        "active execution total must not exceed the contract payout",
      );
    }
  }
}

export class ProposalContractOracle {
  private readonly observations = new Map<string, OracleProposalEvent>();

  public constructor(
    private readonly proposalPublicKey: string,
    private readonly voteWeightByPublicKey: ReadonlyMap<string, bigint>,
  ) {}

  public observe(event: OracleProposalEvent): void {
    assert.equal(event.proposalPublicKey, this.proposalPublicKey);
    this.observations.set(event.id, { ...event });
  }

  public snapshot(): OracleProjectionSnapshot {
    const events = [...this.observations.values()].sort(compareSourceOrder);
    const creationEvents = events.filter(
      (event): event is OracleCreatedEvent => event.type === "proposalCreated",
    );
    const created =
      creationEvents.find((event) => event.status === "canonical") ??
      creationEvents.find((event) => event.status === "pending") ??
      creationEvents.find((event) => event.status !== "orphaned");
    if (!created) {
      return {
        proposal: null,
        votes: [],
        nullifiers: [],
        tallies: [],
        executions: [],
      };
    }

    const voteEvents = events.filter(
      (event): event is OracleVoteEvent =>
        event.type === "proposalVoteDispatched",
    );
    const nullifierOwnerByPublicKey = new Map<string, string>();
    const activeVotesByVoter = new Map<string, OracleVoteEvent[]>();
    for (const voteEvent of voteEvents) {
      if (
        !isActiveProjectionEvent(voteEvent) ||
        isExactContractDummy(voteEvent)
      ) {
        continue;
      }
      const voterVotes = activeVotesByVoter.get(voteEvent.voterPublicKey) ?? [];
      voterVotes.push(voteEvent);
      activeVotesByVoter.set(voteEvent.voterPublicKey, voterVotes);
    }
    for (const [voterPublicKey, voterVotes] of activeVotesByVoter) {
      nullifierOwnerByPublicKey.set(voterPublicKey, voterVotes[0]!.id);
    }
    assertCheckedContractConditions(
      events.filter(isActiveProjectionEvent),
      created,
    );

    const votes: OracleVoteRow[] = voteEvents
      .filter(
        (voteEvent) =>
          isActiveProjectionEvent(voteEvent) &&
          !isExactContractDummy(voteEvent),
      )
      .map((voteEvent) => {
        const ownsNullifier =
          nullifierOwnerByPublicKey.get(voteEvent.voterPublicKey) ===
          voteEvent.id;
        return {
          archiveEventId: voteEvent.id,
          voterPublicKey: voteEvent.voterPublicKey,
          vote: voteEvent.vote,
          voteWeight:
            ownsNullifier && voteEvent.vote !== "dummy"
              ? String(
                  this.voteWeightByPublicKey.get(voteEvent.voterPublicKey) ??
                    0n,
                )
              : "0",
          blockHeight: voteEvent.blockHeight,
          isNullified: !ownsNullifier,
          status: voteEvent.status as "pending" | "canonical",
        };
      })
      .sort((left, right) =>
        compareEventIds(left.archiveEventId, right.archiveEventId),
      );
    const voteById = new Map(votes.map((vote) => [vote.archiveEventId, vote]));
    const nullifiers: OracleNullifierRow[] = voteEvents
      .filter(
        (voteEvent) =>
          nullifierOwnerByPublicKey.get(voteEvent.voterPublicKey) ===
          voteEvent.id,
      )
      .map((voteEvent) => ({
        sourceEventId: voteEvent.id,
        voterPublicKey: voteEvent.voterPublicKey,
        vote: voteEvent.vote,
        voteWeight: voteById.get(voteEvent.id)?.voteWeight ?? "0",
        blockHeight: voteEvent.blockHeight,
      }))
      .sort((left, right) =>
        left.blockHeight !== right.blockHeight
          ? left.blockHeight - right.blockHeight
          : compareEventIds(left.sourceEventId, right.sourceEventId),
      );

    let yay = 0n;
    let nay = 0n;
    let abstain = 0n;
    let projectionSourceStatus: "pending" | "canonical" = "canonical";
    const runningTalliesByHeight = new Map<number, OracleTallyRow>();
    const finalTalliesByEventId = new Map<string, OracleTallyRow>();
    const finalTallyHeights = new Set<number>();
    for (const event of events) {
      if (event.status === "orphaned") continue;
      if (event.type === "proposalVoteDispatched") {
        if (!isActiveProjectionEvent(event)) continue;
        if (isExactContractDummy(event)) continue;
        if (event.status !== "canonical") projectionSourceStatus = "pending";
        const ownsNullifier =
          nullifierOwnerByPublicKey.get(event.voterPublicKey) === event.id;
        if (ownsNullifier && !isExactContractDummy(event)) {
          const weight =
            this.voteWeightByPublicKey.get(event.voterPublicKey) ?? 0n;
          if (event.vote === "yay") yay += weight;
          if (event.vote === "nay") nay += weight;
          if (event.vote === "abstain") abstain += weight;
        }
        if (!finalTallyHeights.has(event.blockHeight)) {
          const approvalStatus = calculateContractApprovalStatus(
            created,
            yay,
            nay,
            abstain,
          );
          runningTalliesByHeight.set(event.blockHeight, {
            archiveEventId: null,
            blockHeight: event.blockHeight,
            blockEventIndex: event.blockEventIndex,
            sourceStatus: projectionSourceStatus,
            yayWeight: yay.toString(),
            nayWeight: nay.toString(),
            abstainWeight: abstain.toString(),
            totalParticipatingVotes: approvalStatus.totalParticipatingVotes,
            approvalBp: approvalStatus.approvalBp,
            voteResult: approvalStatus.voteResult,
            createdByEventType: "proposalVoteDispatched",
          });
        }
      }
      if (event.type === "proposalVotesTallied") {
        const approvalStatus = calculateContractApprovalStatus(
          created,
          BigInt(event.yayWeight),
          BigInt(event.nayWeight),
          BigInt(event.abstainWeight),
        );
        if (!isActiveProjectionEvent(event)) continue;
        runningTalliesByHeight.delete(event.blockHeight);
        finalTallyHeights.add(event.blockHeight);
        finalTalliesByEventId.set(event.id, {
          archiveEventId: event.id,
          blockHeight: event.blockHeight,
          blockEventIndex: event.blockEventIndex,
          sourceStatus: event.status as "pending" | "canonical",
          yayWeight: event.yayWeight,
          nayWeight: event.nayWeight,
          abstainWeight: event.abstainWeight,
          totalParticipatingVotes: approvalStatus.totalParticipatingVotes,
          approvalBp: approvalStatus.approvalBp,
          voteResult: event.voteResult,
          createdByEventType: "proposalVotesTallied",
        });
      }
    }

    const executions = events.filter(
      (event): event is OracleExecutionEvent =>
        event.type === "proposalExecuted" && isActiveProjectionEvent(event),
    );
    const totalPayout = referenceTotalPayout(BigInt(created.amount));
    const bondAmount = totalPayout - BigInt(created.amount);
    let paidOut = 0n;
    const executionRows = executions.map((execution) => {
      paidOut += BigInt(execution.amountToPayOut);
      assert.ok(paidOut <= totalPayout);
      return {
        archiveEventId: execution.id,
        lifecycleId: created.lifecycleId,
        recipient: created.recipient,
        amountToPayOut: execution.amountToPayOut,
        proposalAmount: created.amount,
        bondAmount: bondAmount.toString(),
        senderPublicKey: execution.senderPublicKey,
        paidOutAmount: paidOut.toString(),
        remainingAmount: (totalPayout - paidOut).toString(),
        blockHeight: execution.blockHeight,
        status: execution.status as "pending" | "canonical",
      };
    });
    executionRows.sort((left, right) =>
      left.blockHeight !== right.blockHeight
        ? left.blockHeight - right.blockHeight
        : compareEventIds(left.archiveEventId, right.archiveEventId),
    );

    const criteria = calculateContractAcceptanceCriteria(created);
    let contractStatus: "unknown" | "approved" | "rejected" | "paused" =
      "unknown";
    let statusSource: OracleProposalEvent = created;
    for (const event of events) {
      if (!isActiveProjectionEvent(event)) continue;
      if (event.type === "proposalVotesTallied") {
        contractStatus = event.voteResult;
        statusSource = event;
      } else if (event.type === "proposalPauseToggled") {
        contractStatus = contractStatus === "paused" ? "unknown" : "paused";
        statusSource = event;
      }
    }
    const pauseCount = events.filter(
      (event) =>
        event.type === "proposalPauseToggled" && isActiveProjectionEvent(event),
    ).length;
    return {
      proposal: {
        proposalPublicKey: this.proposalPublicKey,
        lifecycleId: created.lifecycleId,
        amount: created.amount,
        recipient: created.recipient,
        senderPublicKey: created.senderPublicKey,
        zkAppUriHash: created.zkAppUriHash,
        stakingEpochDataLedgerHash: created.stakingEpochDataLedgerHash,
        stakingEpochDataLedgerTotalCurrency:
          created.stakingEpochDataLedgerTotalCurrency,
        ...criteria,
        status: created.status,
        creationObservationStatus: created.status,
        contractStatus,
        contractStatusFinality:
          statusSource.status === "pending" ? "pending" : "canonical",
        contractStatusSourceEventId: statusSource.id,
        contractStatusBlockHeight: statusSource.blockHeight,
        isPaused: pauseCount % 2 === 1,
        paidOutAmount: paidOut.toString(),
      },
      votes,
      nullifiers,
      tallies: [
        ...runningTalliesByHeight.values(),
        ...finalTalliesByEventId.values(),
      ].sort(compareTallyRows),
      executions: executionRows,
    };
  }
}

export async function readPersistedProjection(
  dataSource: DataSource,
  proposalPublicKey: string,
): Promise<OracleProjectionSnapshot> {
  const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
    proposalPublicKey,
  });
  const votes = await dataSource.getRepository(VoteEntity).find({
    where: { proposalPublicKey },
    order: { archiveEventId: "ASC" },
  });
  const nullifiers = await dataSource.getRepository(VoteNullifierEntity).find({
    where: { proposalPublicKey },
    order: { blockHeight: "ASC", sourceEventId: "ASC" },
  });
  const tallies = await dataSource.getRepository(VoteTallyEntity).find({
    where: { proposalPublicKey },
    order: { blockHeight: "ASC", blockEventIndex: "ASC", id: "ASC" },
  });
  const executions = await dataSource
    .getRepository(ProposalExecutionEntity)
    .find({
      where: { proposalPublicKey },
      order: { blockHeight: "ASC", archiveEventId: "ASC" },
    });
  votes.sort((left, right) =>
    compareEventIds(left.archiveEventId, right.archiveEventId),
  );
  nullifiers.sort((left, right) =>
    left.blockHeight !== right.blockHeight
      ? left.blockHeight - right.blockHeight
      : compareEventIds(left.sourceEventId, right.sourceEventId),
  );
  executions.sort((left, right) => {
    const leftHeight = left.blockHeight ?? Number.MAX_SAFE_INTEGER;
    const rightHeight = right.blockHeight ?? Number.MAX_SAFE_INTEGER;
    return leftHeight !== rightHeight
      ? leftHeight - rightHeight
      : compareEventIds(left.archiveEventId, right.archiveEventId);
  });

  return {
    proposal: proposal
      ? {
          proposalPublicKey: proposal.proposalPublicKey,
          lifecycleId: proposal.lifecycleId,
          amount: proposal.amount,
          recipient: proposal.recipient,
          senderPublicKey: proposal.senderPublicKey!,
          zkAppUriHash: proposal.zkAppUriHash,
          stakingEpochDataLedgerHash: proposal.stakingEpochDataLedgerHash!,
          stakingEpochDataLedgerTotalCurrency:
            proposal.stakingEpochDataLedgerTotalCurrency!,
          requiredParticipationBp: proposal.requiredParticipationBp!,
          requiredApprovalBp: proposal.requiredApprovalBp!,
          requiredParticipation: proposal.requiredParticipation!,
          status: proposal.status as OracleArchiveStatus,
          creationObservationStatus:
            proposal.creationObservationStatus as OracleArchiveStatus,
          contractStatus: proposal.contractStatus,
          contractStatusFinality: proposal.contractStatusFinality,
          contractStatusSourceEventId: proposal.contractStatusSourceEventId,
          contractStatusBlockHeight: proposal.contractStatusBlockHeight,
          isPaused: proposal.isPaused,
          paidOutAmount: proposal.paidOutAmount,
        }
      : null,
    votes: votes.map((vote) => ({
      archiveEventId: vote.archiveEventId,
      voterPublicKey: vote.voterPublicKey,
      vote: vote.vote,
      voteWeight: vote.voteWeight,
      blockHeight: vote.blockHeight,
      isNullified: vote.isNullified,
      status: vote.status as "pending" | "canonical",
    })),
    nullifiers: nullifiers.map((nullifier) => ({
      sourceEventId: nullifier.sourceEventId,
      voterPublicKey: nullifier.voterPublicKey,
      vote: nullifier.vote,
      voteWeight: nullifier.voteWeight,
      blockHeight: nullifier.blockHeight,
    })),
    tallies: tallies.map((tally) => ({
      archiveEventId: tally.archiveEventId,
      blockHeight: tally.blockHeight,
      blockEventIndex: tally.blockEventIndex,
      sourceStatus: tally.sourceStatus as "pending" | "canonical",
      yayWeight: tally.yayWeight,
      nayWeight: tally.nayWeight,
      abstainWeight: tally.abstainWeight,
      totalParticipatingVotes: tally.totalParticipatingVotes ?? "0",
      approvalBp: tally.approvalBp ?? "0",
      voteResult: tally.voteResult ?? "rejected",
      createdByEventType: tally.createdByEventType!,
    })),
    executions: executions.map((execution) => ({
      archiveEventId: execution.archiveEventId,
      lifecycleId: execution.lifecycleId,
      recipient: execution.recipient,
      amountToPayOut: execution.amountToPayOut,
      proposalAmount: execution.proposalAmount,
      bondAmount: execution.bondAmount,
      senderPublicKey: execution.senderPublicKey,
      paidOutAmount: execution.paidOutAmount,
      remainingAmount: execution.remainingAmount,
      blockHeight: execution.blockHeight!,
      status: execution.status as "pending" | "canonical",
    })),
  };
}

export async function assertProjectionMatchesOracle(
  dataSource: DataSource,
  oracle: ProposalContractOracle,
  proposalPublicKey: string,
  step: string,
): Promise<void> {
  assert.deepEqual(
    await readPersistedProjection(dataSource, proposalPublicKey),
    oracle.snapshot(),
    step,
  );
}

export function asArchiveEvent(
  event: OracleProposalEvent,
  rawEventData: Record<string, unknown>,
): ArchiveEventEntity {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, event.blockHeight));
  return {
    id: event.id,
    changeSequence: event.changeSequence,
    status: event.status,
    pendingSeenAtHeight: null,
    blockHeight: event.blockHeight,
    blockTimestamp: timestamp,
    globalSlotSinceGenesis: event.globalSlotSinceGenesis ?? event.blockHeight,
    stateHash: event.stateHash ?? `state-${event.blockHeight}`,
    parentHash: event.parentHash ?? `state-${event.blockHeight - 1}`,
    chainStatus:
      event.chainStatus ??
      (event.status === "canonical" ? "canonical" : "pending"),
    eventType: event.type,
    txHash: `tx-${event.id}`,
    accountUpdateId: event.id,
    accountUpdateIndex: 0,
    eventIndex: event.blockEventIndex,
    blockEventIndex: event.blockEventIndex,
    rawEventData,
    indexedAt: timestamp,
    updatedAt: new Date(timestamp.getTime() + Number(event.changeSequence)),
  } as unknown as ArchiveEventEntity;
}
