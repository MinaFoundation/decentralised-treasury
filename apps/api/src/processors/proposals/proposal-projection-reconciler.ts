import { ArchiveEventEntity } from "@repo/indexer";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import {
  BASIS_POINTS,
  BOND_AMOUNT_DIVISOR,
} from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import { isDeepStrictEqual } from "node:util";
import type { EntityManager } from "typeorm";
import { ProposalContentEntity } from "./proposal-content-entity.js";
import {
  isExactVoteReducerPadding,
  requireContractUInt128,
  requireContractUInt64,
} from "./proposal-contract-domain.js";
import {
  ProposalEntity,
  type ProposalContractStatus,
  type ProposalContractStatusFinality,
} from "./proposal-entity.js";
import { ProposalEventFactEntity } from "./proposal-event-fact-entity.js";
import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { ProposalProjectionReplayEntity } from "./proposal-projection-replay-entity.js";
import { VoteEntity, type VoteLabel } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";
import {
  VoteTallyEntity,
  type VoteTallyVoteResult,
} from "./vote-tally-entity.js";

type DecodedPayload = Record<string, unknown> & {
  proposalPublicKey: string;
};

const PROPOSAL_EVENT_TYPES = [
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
] as const;

// These keys match the Archive ingestion locks. Replay completion takes both
// locks so the two-way Archive/fact check and projection rebuild use one stable
// Archive snapshot.
const ARCHIVE_CHANGE_SEQUENCE_LOCK_NAMESPACE = 1_788_447_600;
const ARCHIVE_CHANGE_SEQUENCE_LOCK_KEY = 1;
const ARCHIVE_INGEST_LOCK_KEY = 2;

interface VoteProjectionDependencies {
  getVoteWeight(
    proposal: ProposalEntity,
    voterPublicKey: string,
  ): Promise<bigint>;
  calculateVoteResult(
    proposal: ProposalEntity,
    yayWeight: bigint,
    nayWeight: bigint,
    abstainWeight: bigint,
  ): Promise<VoteTallyVoteResult>;
}

interface ProposalCreatedPayload extends DecodedPayload {
  lifecycleId: number;
  amount: string;
  recipient: string;
  zkAppUriHash: string;
  stakingEpochDataLedgerHash: string | null;
  stakingEpochDataLedgerTotalCurrency: string | null;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  senderPublicKey: string | null;
}

interface ProposalVotePayload extends DecodedPayload {
  voterPublicKey: string;
  vote: VoteLabel;
  senderPublicKey: string | null;
}

interface ProposalTallyPayload extends DecodedPayload {
  lifecycleId: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  voteResult: VoteTallyVoteResult;
  senderPublicKey: string | null;
}

interface ProposalExecutionPayload extends DecodedPayload {
  recipient?: string;
  amountToPayOut: string;
  senderPublicKey: string;
}

interface TallyProjection {
  archiveEventId: string | null;
  blockHeight: number;
  blockEventIndex: number;
  sourceStatus: string;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  totalParticipatingVotes: string;
  approvalBp: string;
  voteResult: VoteTallyVoteResult;
  createdByEventType:
    | typeof PROPOSAL_VOTE_DISPATCHED_EVENT_NAME
    | typeof PROPOSAL_VOTES_TALLIED_EVENT_NAME;
}

interface FinalTallyCalculation {
  yayWeight: bigint;
  nayWeight: bigint;
  abstainWeight: bigint;
  totalParticipatingVotes: bigint;
  approvalBp: string;
  voteResult: VoteTallyVoteResult;
}

interface ContractProjectionState {
  status: ProposalContractStatus;
  sourceEventId: string | null;
  sourceBlockHeight: number | null;
}

function compareTallyProjections(
  left: TallyProjection,
  right: TallyProjection,
): number {
  if (left.blockHeight !== right.blockHeight) {
    return left.blockHeight - right.blockHeight;
  }
  if (left.blockEventIndex !== right.blockEventIndex) {
    return left.blockEventIndex - right.blockEventIndex;
  }
  if (left.archiveEventId === null) return -1;
  if (right.archiveEventId === null) return 1;
  return compareArchiveEventIds(left.archiveEventId, right.archiveEventId);
}

function isSurviving(fact: ProposalEventFactEntity): boolean {
  return fact.status === "pending" || fact.status === "canonical";
}

function compareArchiveEventIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left.localeCompare(right);
}

function compareFacts(
  left: ProposalEventFactEntity,
  right: ProposalEventFactEntity,
): number {
  const leftHeight = left.blockHeight ?? Number.MAX_SAFE_INTEGER;
  const rightHeight = right.blockHeight ?? Number.MAX_SAFE_INTEGER;
  if (leftHeight !== rightHeight) {
    return leftHeight - rightHeight;
  }
  const leftIndex = left.blockEventIndex;
  const rightIndex = right.blockEventIndex;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  return compareArchiveEventIds(left.archiveEventId, right.archiveEventId);
}

function calculateApprovalBp(yay: bigint, nay: bigint): string {
  const approvalVotes = yay + nay;
  const basisPoints = BASIS_POINTS.toBigInt();
  return approvalVotes > 0n
    ? ((yay * basisPoints) / approvalVotes).toString()
    : "0";
}

function calculateParticipatingVotes(
  yay: bigint,
  nay: bigint,
  abstain: bigint,
  label: string,
): bigint {
  const approvalVotes = requireContractUInt128(yay + nay, `${label} approval`);
  return requireContractUInt128(
    approvalVotes + abstain,
    `${label} participation`,
  );
}

function calculatePayloadLocalFinalTally(
  proposal: ProposalEntity,
  payload: ProposalTallyPayload,
  archiveEventId: string,
): FinalTallyCalculation {
  const yayWeight = requireContractUInt64(
    BigInt(payload.yayWeight),
    `final yay tally for archiveEventId=${archiveEventId}`,
  );
  const nayWeight = requireContractUInt64(
    BigInt(payload.nayWeight),
    `final nay tally for archiveEventId=${archiveEventId}`,
  );
  const abstainWeight = requireContractUInt64(
    BigInt(payload.abstainWeight),
    `final abstain tally for archiveEventId=${archiveEventId}`,
  );
  const totalParticipatingVotes = calculateParticipatingVotes(
    yayWeight,
    nayWeight,
    abstainWeight,
    `final tally for archiveEventId=${archiveEventId}`,
  );
  const decisiveVotes = requireContractUInt128(
    yayWeight + nayWeight,
    `final decisive tally for archiveEventId=${archiveEventId}`,
  );
  if (decisiveVotes === 0n) {
    throw new Error(
      `[proposal-processor] final tally has no decisive votes for archiveEventId=${archiveEventId}`,
    );
  }
  const approvalBp = calculateApprovalBp(yayWeight, nayWeight);
  if (
    proposal.requiredParticipation === null ||
    proposal.requiredApprovalBp === null
  ) {
    return {
      yayWeight,
      nayWeight,
      abstainWeight,
      totalParticipatingVotes,
      approvalBp,
      voteResult: payload.voteResult,
    };
  }

  const requiredParticipation = requireContractUInt128(
    BigInt(proposal.requiredParticipation),
    `required participation for proposalPublicKey=${proposal.proposalPublicKey}`,
  );
  const requiredApprovalBp = requireContractUInt128(
    BigInt(proposal.requiredApprovalBp),
    `required approval basis points for proposalPublicKey=${proposal.proposalPublicKey}`,
  );
  if (totalParticipatingVotes < requiredParticipation) {
    throw new Error(
      `[proposal-processor] final tally participation=${totalParticipatingVotes} is below requiredParticipation=${requiredParticipation} for archiveEventId=${archiveEventId}`,
    );
  }
  const voteResult: VoteTallyVoteResult =
    BigInt(approvalBp) >= requiredApprovalBp ? "approved" : "rejected";

  if (payload.voteResult !== voteResult) {
    throw new Error(
      `[proposal-processor] final tally voteResult=${payload.voteResult} does not match contract result=${voteResult} for archiveEventId=${archiveEventId}`,
    );
  }

  return {
    yayWeight,
    nayWeight,
    abstainWeight,
    totalParticipatingVotes,
    approvalBp,
    voteResult,
  };
}

function isSameFactObservation(
  persisted: ProposalEventFactEntity,
  incoming: Omit<ProposalEventFactEntity, never>,
): boolean {
  return (
    String(persisted.archiveEventId) === String(incoming.archiveEventId) &&
    String(persisted.changeSequence) === String(incoming.changeSequence) &&
    persisted.eventType === incoming.eventType &&
    persisted.proposalPublicKey === incoming.proposalPublicKey &&
    persisted.status === incoming.status &&
    persisted.blockHeight === incoming.blockHeight &&
    isDeepStrictEqual(persisted.blockTimestamp, incoming.blockTimestamp) &&
    persisted.globalSlotSinceGenesis === incoming.globalSlotSinceGenesis &&
    persisted.stateHash === incoming.stateHash &&
    persisted.parentHash === incoming.parentHash &&
    persisted.chainStatus === incoming.chainStatus &&
    persisted.blockEventIndex === incoming.blockEventIndex &&
    persisted.txHash === incoming.txHash &&
    isDeepStrictEqual(persisted.updatedAt, incoming.updatedAt) &&
    isDeepStrictEqual(persisted.decodedPayload, incoming.decodedPayload)
  );
}

function asPayload<T extends DecodedPayload>(fact: ProposalEventFactEntity): T {
  return fact.decodedPayload as T;
}

function isCreationObservationStatus(
  value: string,
): value is "pending" | "canonical" | "orphaned" {
  return value === "pending" || value === "canonical" || value === "orphaned";
}

function isProposalContractStatus(
  value: string,
): value is ProposalContractStatus {
  return (
    value === "unknown" ||
    value === "approved" ||
    value === "rejected" ||
    value === "paused"
  );
}

function assertCoherentProposalBranch(
  proposalPublicKey: string,
  facts: ProposalEventFactEntity[],
): void {
  const blocks = new Map<
    number,
    { stateHashes: Set<string>; parentHashes: Set<string> }
  >();
  for (const fact of facts) {
    if (
      fact.status !== "canonical" ||
      fact.blockHeight === null ||
      !fact.stateHash
    ) {
      continue;
    }
    const block = blocks.get(fact.blockHeight) ?? {
      stateHashes: new Set<string>(),
      parentHashes: new Set<string>(),
    };
    block.stateHashes.add(fact.stateHash);
    if (fact.parentHash) {
      block.parentHashes.add(fact.parentHash);
    }
    blocks.set(fact.blockHeight, block);
  }

  for (const [blockHeight, block] of blocks) {
    if (block.stateHashes.size > 1 || block.parentHashes.size > 1) {
      throw new Error(
        `[proposal-processor] ambiguous proposal branch for proposalPublicKey=${proposalPublicKey} at blockHeight=${blockHeight}`,
      );
    }
  }

  const orderedBlocks = Array.from(blocks.entries()).sort(
    ([leftHeight], [rightHeight]) => leftHeight - rightHeight,
  );
  for (let index = 1; index < orderedBlocks.length; index += 1) {
    const [previousHeight, previousBlock] = orderedBlocks[index - 1]!;
    const [blockHeight, block] = orderedBlocks[index]!;
    if (blockHeight !== previousHeight + 1 || block.parentHashes.size === 0) {
      continue;
    }
    const previousStateHash = Array.from(previousBlock.stateHashes)[0]!;
    const parentHash = Array.from(block.parentHashes)[0]!;
    if (parentHash !== previousStateHash) {
      throw new Error(
        `[proposal-processor] disconnected proposal branch for proposalPublicKey=${proposalPublicKey} between blockHeight=${previousHeight} and blockHeight=${blockHeight}`,
      );
    }
  }
}

function selectCreationFact(
  proposalPublicKey: string,
  facts: ProposalEventFactEntity[],
): ProposalEventFactEntity | null {
  const survivingCreationFacts = facts.filter(
    (fact) =>
      fact.eventType === PROPOSAL_CREATED_EVENT_NAME && isSurviving(fact),
  );
  const canonicalCreationFacts = survivingCreationFacts.filter(
    (fact) => fact.status === "canonical",
  );
  if (canonicalCreationFacts.length > 1) {
    throw new Error(
      `[proposal-processor] multiple canonical creation facts for proposalPublicKey=${proposalPublicKey}`,
    );
  }
  if (canonicalCreationFacts.length === 1) {
    return canonicalCreationFacts[0]!;
  }
  if (survivingCreationFacts.length > 1) {
    throw new Error(
      `[proposal-processor] ambiguous pending creation facts for proposalPublicKey=${proposalPublicKey}`,
    );
  }
  return survivingCreationFacts[0] ?? null;
}

export class ProposalProjectionReconciler {
  private voteDependencies: VoteProjectionDependencies | null = null;

  public configureVoteProjection(
    dependencies: VoteProjectionDependencies,
  ): void {
    this.voteDependencies = dependencies;
  }

  public async recordAndReconcile(
    event: ArchiveEventEntity,
    eventType: string,
    decodedPayload: DecodedPayload,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(ProposalEventFactEntity);
    const previousFact = await repository.findOneBy({
      archiveEventId: event.id,
    });
    const eventBlockHeight = event.blockHeight ?? null;
    const eventStateHash = event.stateHash ?? null;
    const sameBlockObservation =
      previousFact !== null &&
      previousFact.blockHeight === eventBlockHeight &&
      (previousFact.stateHash !== null || eventStateHash !== null
        ? previousFact.stateHash === eventStateHash
        : previousFact.globalSlotSinceGenesis ===
            (event.globalSlotSinceGenesis ?? null) &&
          previousFact.parentHash === (event.parentHash ?? null) &&
          isDeepStrictEqual(
            previousFact.blockTimestamp,
            event.blockTimestamp ?? null,
          ));
    const transactionSequenceNumber =
      event.rawEventData.transactionInfo?.sequenceNumber;
    const hasAuthoritativeSourcePosition =
      Number.isSafeInteger(transactionSequenceNumber) &&
      (transactionSequenceNumber as number) >= 0;
    const keepExistingSourcePosition =
      previousFact !== null &&
      previousFact.status !== "orphaned" &&
      event.status !== "orphaned" &&
      BigInt(event.changeSequence) > BigInt(previousFact.changeSequence) &&
      sameBlockObservation &&
      !hasAuthoritativeSourcePosition;
    const fact = {
      archiveEventId: event.id,
      changeSequence: event.changeSequence,
      eventType,
      proposalPublicKey: decodedPayload.proposalPublicKey,
      status: event.status,
      blockHeight: eventBlockHeight,
      blockTimestamp: event.blockTimestamp ?? null,
      globalSlotSinceGenesis: event.globalSlotSinceGenesis ?? null,
      stateHash: eventStateHash,
      parentHash: event.parentHash ?? null,
      chainStatus: event.chainStatus ?? null,
      // Legacy Archive response order can change when a pending event is
      // promoted. Keep that first fallback position for the same block. When
      // transaction sequence metadata is present, the indexer position is
      // authoritative and can safely enrich or correct the stored position.
      blockEventIndex: keepExistingSourcePosition
        ? previousFact.blockEventIndex
        : event.blockEventIndex,
      txHash: event.txHash,
      decodedPayload: decodedPayload as never,
      updatedAt: event.updatedAt,
    };
    const overwriteColumns = repository.metadata.columns
      .filter((column) => !column.isPrimary)
      .map((column) => column.databaseName);
    await repository
      .createQueryBuilder(repository.metadata.tableName)
      .insert()
      .values(fact)
      .orUpdate(overwriteColumns, ["archive_event_id"], {
        overwriteCondition: {
          where: `"processor_proposal_event_facts"."change_sequence" < EXCLUDED."change_sequence"`,
        },
      })
      .execute();

    // The conditional upsert is the concurrency boundary. This read selects
    // the fact that won that boundary, not the observation read before it.
    const persistedFact = await repository.findOneByOrFail({
      archiveEventId: event.id,
    });
    if (BigInt(persistedFact.changeSequence) > BigInt(event.changeSequence)) {
      return;
    }
    if (!isSameFactObservation(persistedFact, fact)) {
      const conflictingFields = [
        persistedFact.eventType !== fact.eventType ? "eventType" : null,
        persistedFact.proposalPublicKey !== fact.proposalPublicKey
          ? "proposalPublicKey"
          : null,
        persistedFact.status !== fact.status ? "status" : null,
        persistedFact.blockHeight !== fact.blockHeight ? "blockHeight" : null,
        !isDeepStrictEqual(persistedFact.blockTimestamp, fact.blockTimestamp)
          ? "blockTimestamp"
          : null,
        persistedFact.globalSlotSinceGenesis !== fact.globalSlotSinceGenesis
          ? "globalSlotSinceGenesis"
          : null,
        persistedFact.stateHash !== fact.stateHash ? "stateHash" : null,
        persistedFact.parentHash !== fact.parentHash ? "parentHash" : null,
        persistedFact.chainStatus !== fact.chainStatus ? "chainStatus" : null,
        persistedFact.blockEventIndex !== fact.blockEventIndex
          ? "blockEventIndex"
          : null,
        persistedFact.txHash !== fact.txHash ? "txHash" : null,
        !isDeepStrictEqual(persistedFact.updatedAt, fact.updatedAt)
          ? "updatedAt"
          : null,
        !isDeepStrictEqual(persistedFact.decodedPayload, fact.decodedPayload)
          ? "decodedPayload"
          : null,
      ].filter((field): field is string => field !== null);
      throw new Error(
        `[proposal-processor] conflicting fact observation for archiveEventId=${event.id} at changeSequence=${event.changeSequence} fields=${conflictingFields.join(",")}`,
      );
    }

    const replay = await this.getReplayState(manager);
    if (replay?.state === "collecting") {
      if (BigInt(event.changeSequence) < BigInt(replay.targetChangeSequence)) {
        return;
      }

      await this.lockArchiveReplaySnapshot(manager);
      const latestReplayTarget =
        await this.getLatestProposalChangeSequence(manager);
      if (BigInt(latestReplayTarget) > BigInt(replay.targetChangeSequence)) {
        replay.targetChangeSequence = latestReplayTarget;
        await manager.getRepository(ProposalProjectionReplayEntity).update(
          { projectionName: replay.projectionName },
          {
            targetChangeSequence: latestReplayTarget,
            state: "collecting",
            completedAt: null,
          },
        );
      }
      if (BigInt(event.changeSequence) < BigInt(replay.targetChangeSequence)) {
        return;
      }

      const missingFactCount = await this.countMissingReplayFacts(
        replay.targetChangeSequence,
        manager,
      );
      if (missingFactCount > 0) {
        throw new Error(
          `[proposal-processor] projection replay is missing ${missingFactCount} archive event fact(s) at or before change sequence ${replay.targetChangeSequence}`,
        );
      }

      const staleFactCount = await this.countStaleReplayFacts(
        replay.targetChangeSequence,
        manager,
      );
      if (staleFactCount > 0) {
        throw new Error(
          `[proposal-processor] projection replay has ${staleFactCount} stale fact(s) without a matching current Archive event at or before change sequence ${replay.targetChangeSequence}`,
        );
      }

      await this.rebuildAllCompleteProposalHistories(manager);
      await manager
        .getRepository(ProposalProjectionReplayEntity)
        .update(
          { projectionName: replay.projectionName },
          { state: "complete", completedAt: new Date() },
        );
      return;
    }

    if (
      previousFact &&
      (previousFact.proposalPublicKey !== decodedPayload.proposalPublicKey ||
        previousFact.eventType !== eventType)
    ) {
      await this.removeEventProjection(previousFact.archiveEventId, manager);
    }

    const previousCreationSemanticsChanged =
      previousFact?.eventType === PROPOSAL_CREATED_EVENT_NAME &&
      previousFact.eventType !== eventType;
    if (
      previousFact &&
      (previousFact.proposalPublicKey !== decodedPayload.proposalPublicKey ||
        previousCreationSemanticsChanged)
    ) {
      await this.reconcileProposal(
        previousFact.proposalPublicKey,
        manager,
        previousCreationSemanticsChanged ||
          previousFact.eventType === PROPOSAL_CREATED_EVENT_NAME,
      );
    }
    await this.reconcileProposal(decodedPayload.proposalPublicKey, manager);
  }

  private async lockArchiveReplaySnapshot(
    manager: EntityManager,
  ): Promise<void> {
    await manager.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ARCHIVE_CHANGE_SEQUENCE_LOCK_NAMESPACE,
      ARCHIVE_INGEST_LOCK_KEY,
    ]);
    await manager.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ARCHIVE_CHANGE_SEQUENCE_LOCK_NAMESPACE,
      ARCHIVE_CHANGE_SEQUENCE_LOCK_KEY,
    ]);
  }

  private async getLatestProposalChangeSequence(
    manager: EntityManager,
  ): Promise<string> {
    const row = await manager
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder("archive_event")
      .select(
        'COALESCE(MAX("archive_event"."change_sequence"), 0)',
        "change_sequence",
      )
      .where("archive_event.event_type IN (:...eventTypes)", {
        eventTypes: PROPOSAL_EVENT_TYPES,
      })
      .getRawOne<{ change_sequence: string | number }>();
    return String(row?.change_sequence ?? "0");
  }

  private async countMissingReplayFacts(
    targetChangeSequence: string,
    manager: EntityManager,
  ): Promise<number> {
    return await manager
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder("archive_event")
      .leftJoin(
        ProposalEventFactEntity,
        "proposal_fact",
        `proposal_fact.archive_event_id = CAST(archive_event.id AS text)
         AND proposal_fact.change_sequence = archive_event.change_sequence
         AND proposal_fact.event_type = archive_event.event_type`,
      )
      .where("archive_event.event_type IN (:...eventTypes)", {
        eventTypes: PROPOSAL_EVENT_TYPES,
      })
      .andWhere("archive_event.change_sequence <= :targetChangeSequence", {
        targetChangeSequence,
      })
      .andWhere("proposal_fact.archive_event_id IS NULL")
      .getCount();
  }

  private async countStaleReplayFacts(
    targetChangeSequence: string,
    manager: EntityManager,
  ): Promise<number> {
    return await manager
      .getRepository(ProposalEventFactEntity)
      .createQueryBuilder("proposal_fact")
      .leftJoin(
        ArchiveEventEntity,
        "archive_event",
        `proposal_fact.archive_event_id = CAST(archive_event.id AS text)`,
      )
      .where("proposal_fact.change_sequence <= :targetChangeSequence", {
        targetChangeSequence,
      })
      .andWhere(
        `(archive_event.id IS NULL
          OR proposal_fact.change_sequence <> archive_event.change_sequence
          OR proposal_fact.event_type <> archive_event.event_type)`,
      )
      .getCount();
  }

  private async removeEventProjection(
    archiveEventId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(VoteNullifierEntity)
      .delete({ sourceEventId: archiveEventId });
    await manager.getRepository(VoteEntity).delete({ archiveEventId });
    await manager
      .getRepository(ProposalExecutionEntity)
      .delete({ archiveEventId });
    await manager.getRepository(VoteTallyEntity).delete({ archiveEventId });
  }

  private async getReplayState(
    manager: EntityManager,
  ): Promise<ProposalProjectionReplayEntity | null> {
    if (!manager.connection.hasMetadata(ProposalProjectionReplayEntity)) {
      return null;
    }
    return await manager
      .getRepository(ProposalProjectionReplayEntity)
      .findOneBy({ projectionName: "proposal" });
  }

  private async rebuildAllCompleteProposalHistories(
    manager: EntityManager,
  ): Promise<void> {
    const [facts, proposals] = await Promise.all([
      manager.getRepository(ProposalEventFactEntity).find(),
      manager.getRepository(ProposalEntity).find(),
    ]);
    const proposalPublicKeys = Array.from(
      new Set([
        ...facts.map((fact) => fact.proposalPublicKey),
        ...proposals.map((proposal) => proposal.proposalPublicKey),
      ]),
    ).sort();
    for (const proposalPublicKey of proposalPublicKeys) {
      const proposalFacts = facts.filter(
        (fact) => fact.proposalPublicKey === proposalPublicKey,
      );
      const hasCanonicalCreation = proposalFacts.some(
        (fact) =>
          fact.status === "canonical" &&
          fact.eventType === PROPOSAL_CREATED_EVENT_NAME,
      );
      const canonicalChild = proposalFacts.find(
        (fact) =>
          fact.status === "canonical" &&
          fact.eventType !== PROPOSAL_CREATED_EVENT_NAME,
      );
      if (canonicalChild && !hasCanonicalCreation) {
        throw new Error(
          `[proposal-processor] projection replay has canonical ${canonicalChild.eventType} event id=${canonicalChild.archiveEventId} without a canonical creation for proposalPublicKey=${proposalPublicKey}`,
        );
      }
      await this.reconcileProposal(proposalPublicKey, manager, true);
    }
  }

  public async reconcileProposal(
    proposalPublicKey: string,
    manager: EntityManager,
    removeProjectionWithoutCreation = false,
  ): Promise<void> {
    const facts = await manager.getRepository(ProposalEventFactEntity).findBy({
      proposalPublicKey,
    });
    facts.sort(compareFacts);
    assertCoherentProposalBranch(proposalPublicKey, facts);

    const proposal = await this.reconcileProposalRow(
      proposalPublicKey,
      facts,
      manager,
      removeProjectionWithoutCreation,
    );
    if (!proposal) {
      return;
    }

    await this.reconcileContractStatus(proposal, facts, manager);
    await this.reconcilePause(proposal, facts, manager);
    await this.reconcileVotesAndTallies(proposal, facts, manager);
    await this.reconcileExecutions(proposal, facts, manager);
  }

  private async reconcileProposalRow(
    proposalPublicKey: string,
    facts: ProposalEventFactEntity[],
    manager: EntityManager,
    removeProjectionWithoutCreation: boolean,
  ): Promise<ProposalEntity | null> {
    const proposalRepository = manager.getRepository(ProposalEntity);
    const creationFacts = facts.filter(
      (fact) => fact.eventType === PROPOSAL_CREATED_EVENT_NAME,
    );

    if (creationFacts.length > 0) {
      const survivingCreation = selectCreationFact(proposalPublicKey, facts);
      if (!survivingCreation) {
        await proposalRepository.delete({ proposalPublicKey });
        return null;
      }

      const payload = asPayload<ProposalCreatedPayload>(survivingCreation);
      const existing = await proposalRepository.findOneBy({
        proposalPublicKey,
      });
      const savedContent = await manager
        .getRepository(ProposalContentEntity)
        .findOneBy({
          proposalPublicKey,
          zkAppUriHash: payload.zkAppUriHash,
        });
      await proposalRepository.upsert(
        {
          ...payload,
          status: survivingCreation.status,
          creationObservationStatus: survivingCreation.status,
          contractStatus: existing ? existing.contractStatus : "unknown",
          contractStatusFinality: existing?.contractStatusFinality ?? "pending",
          contractStatusSourceEventId:
            existing?.contractStatusSourceEventId ?? null,
          contractStatusBlockHeight:
            existing?.contractStatusBlockHeight ?? null,
          isPaused: existing?.isPaused ?? false,
          paidOutAmount: existing?.paidOutAmount ?? "0",
          contents: savedContent?.contents ?? null,
          createdAtBlockHeight: survivingCreation.blockHeight,
          createdAtBlockTimestamp: survivingCreation.blockTimestamp,
        },
        ["proposalPublicKey"],
      );
    } else if (removeProjectionWithoutCreation) {
      await proposalRepository.delete({ proposalPublicKey });
      return null;
    }

    return await proposalRepository.findOneBy({ proposalPublicKey });
  }

  private async reconcileContractStatus(
    proposal: ProposalEntity,
    facts: ProposalEventFactEntity[],
    manager: EntityManager,
  ): Promise<void> {
    const creationFact = selectCreationFact(proposal.proposalPublicKey, facts);
    const creationObservationStatus = creationFact
      ? creationFact.status
      : isCreationObservationStatus(proposal.creationObservationStatus)
        ? proposal.creationObservationStatus
        : isCreationObservationStatus(proposal.status)
          ? proposal.status
          : "pending";
    const legacyContractStatus = isProposalContractStatus(proposal.status)
      ? proposal.status
      : "unknown";

    const projectionState: ContractProjectionState = {
      status: creationFact ? "unknown" : legacyContractStatus,
      sourceEventId: creationFact?.archiveEventId ?? null,
      sourceBlockHeight:
        creationFact?.blockHeight ?? proposal.createdAtBlockHeight,
    };
    let statusSource = creationFact;

    // The Archive event order is the processor's presentation order. Pending
    // and canonical facts use the same contract transition rules. A later
    // orphan observation removes the fact, and the full active history is
    // replayed without a separate business-data state.
    for (const fact of facts) {
      if (!isSurviving(fact)) {
        continue;
      }
      if (fact.eventType === PROPOSAL_VOTES_TALLIED_EVENT_NAME) {
        const payload = asPayload<ProposalTallyPayload>(fact);
        if (payload.lifecycleId !== proposal.lifecycleId) {
          throw new Error(
            `[proposal-processor] tally lifecycleId=${payload.lifecycleId} does not match proposal lifecycleId=${proposal.lifecycleId} for proposalPublicKey=${proposal.proposalPublicKey}`,
          );
        }
        projectionState.status = calculatePayloadLocalFinalTally(
          proposal,
          payload,
          fact.archiveEventId,
        ).voteResult;
        projectionState.sourceEventId = fact.archiveEventId;
        projectionState.sourceBlockHeight = fact.blockHeight;
        statusSource = fact;
      } else if (fact.eventType === PROPOSAL_PAUSE_TOGGLED_EVENT_NAME) {
        projectionState.status =
          projectionState.status === "paused" ? "unknown" : "paused";
        projectionState.sourceEventId = fact.archiveEventId;
        projectionState.sourceBlockHeight = fact.blockHeight;
        statusSource = fact;
      }
    }

    const contractStatusFinality: ProposalContractStatusFinality =
      statusSource?.status === "pending" ? "pending" : "canonical";

    await manager.getRepository(ProposalEntity).update(
      { proposalPublicKey: proposal.proposalPublicKey },
      {
        creationObservationStatus,
        contractStatus: projectionState.status,
        contractStatusFinality,
        contractStatusSourceEventId: projectionState.sourceEventId,
        contractStatusBlockHeight: projectionState.sourceBlockHeight,
      },
    );
    proposal.creationObservationStatus = creationObservationStatus;
    proposal.contractStatus = projectionState.status;
    proposal.contractStatusFinality = contractStatusFinality;
    proposal.contractStatusSourceEventId = projectionState.sourceEventId;
    proposal.contractStatusBlockHeight = projectionState.sourceBlockHeight;
  }

  private async reconcilePause(
    proposal: ProposalEntity,
    facts: ProposalEventFactEntity[],
    manager: EntityManager,
  ): Promise<void> {
    const pauseFacts = facts.filter(
      (fact) =>
        fact.eventType === PROPOSAL_PAUSE_TOGGLED_EVENT_NAME &&
        isSurviving(fact),
    );
    const isPaused = pauseFacts.length % 2 === 1;
    if (proposal.isPaused !== isPaused) {
      await manager
        .getRepository(ProposalEntity)
        .update(
          { proposalPublicKey: proposal.proposalPublicKey },
          { isPaused },
        );
      proposal.isPaused = isPaused;
    }
  }

  private async reconcileVotesAndTallies(
    proposal: ProposalEntity,
    facts: ProposalEventFactEntity[],
    manager: EntityManager,
  ): Promise<void> {
    const voteFacts = facts.filter(
      (fact) =>
        fact.eventType === PROPOSAL_VOTE_DISPATCHED_EVENT_NAME &&
        isSurviving(fact),
    );
    const activeVoteFacts = voteFacts;
    const projectableVoteFacts = activeVoteFacts.filter((fact) => {
      const payload = asPayload<ProposalVotePayload>(fact);
      return !isExactVoteReducerPadding(payload.vote, payload.voterPublicKey);
    });
    if (projectableVoteFacts.length > 0 && !this.voteDependencies) {
      throw new Error(
        `[proposal-processor] vote projection is not configured for proposalPublicKey=${proposal.proposalPublicKey}`,
      );
    }

    const voteRepository = manager.getRepository(VoteEntity);
    const nullifierRepository = manager.getRepository(VoteNullifierEntity);
    const tallyRepository = manager.getRepository(VoteTallyEntity);
    await voteRepository.delete({
      proposalPublicKey: proposal.proposalPublicKey,
    });
    await nullifierRepository.delete({
      proposalPublicKey: proposal.proposalPublicKey,
    });
    await tallyRepository.delete({
      proposalPublicKey: proposal.proposalPublicKey,
    });

    const activeVotesByVoter = new Map<string, ProposalEventFactEntity[]>();
    for (const fact of activeVoteFacts) {
      const payload = asPayload<ProposalVotePayload>(fact);
      if (isExactVoteReducerPadding(payload.vote, payload.voterPublicKey)) {
        continue;
      }
      const voterFacts = activeVotesByVoter.get(payload.voterPublicKey) ?? [];
      voterFacts.push(fact);
      activeVotesByVoter.set(payload.voterPublicKey, voterFacts);
    }
    const activeVoteOwnerByVoter = new Map<string, ProposalEventFactEntity>();
    for (const [voterPublicKey, voterFacts] of activeVotesByVoter) {
      activeVoteOwnerByVoter.set(voterPublicKey, voterFacts[0]!);
    }

    const weightByEvent = new Map<string, bigint>();
    for (const fact of projectableVoteFacts) {
      const payload = asPayload<ProposalVotePayload>(fact);
      if (isExactVoteReducerPadding(payload.vote, payload.voterPublicKey)) {
        continue;
      }
      const voteWeight = requireContractUInt64(
        await this.voteDependencies!.getVoteWeight(
          proposal,
          payload.voterPublicKey,
        ),
        `vote weight for voterPublicKey=${payload.voterPublicKey}`,
      );
      weightByEvent.set(fact.archiveEventId, voteWeight);
    }

    const runningTalliesByHeight = new Map<number, TallyProjection>();
    const finalTalliesByArchiveEventId = new Map<string, TallyProjection>();
    const finalTallyHeights = new Set<number>();
    let yayWeight = 0n;
    let nayWeight = 0n;
    let abstainWeight = 0n;
    let runningSourceStatus: "pending" | "canonical" = "canonical";
    const projectionFacts = facts.filter(
      (fact) =>
        isSurviving(fact) &&
        (fact.eventType === PROPOSAL_VOTE_DISPATCHED_EVENT_NAME ||
          fact.eventType === PROPOSAL_VOTES_TALLIED_EVENT_NAME),
    );
    for (const fact of projectionFacts) {
      if (!isSurviving(fact)) {
        continue;
      }
      if (fact.blockHeight === null) {
        throw new Error(
          `[proposal-processor] ${fact.eventType} event id=${fact.archiveEventId} is missing blockHeight`,
        );
      }
      if (fact.eventType === PROPOSAL_VOTE_DISPATCHED_EVENT_NAME) {
        if (fact.status === "pending") {
          runningSourceStatus = "pending";
        }
        const payload = asPayload<ProposalVotePayload>(fact);
        if (isExactVoteReducerPadding(payload.vote, payload.voterPublicKey)) {
          continue;
        }
        const ownsNullifier =
          activeVoteOwnerByVoter.get(payload.voterPublicKey)?.archiveEventId ===
          fact.archiveEventId;
        if (ownsNullifier && payload.vote !== "dummy") {
          const weight = weightByEvent.get(fact.archiveEventId) ?? 0n;
          if (payload.vote === "yay") {
            yayWeight = requireContractUInt64(
              yayWeight + weight,
              "running yay tally",
            );
          } else if (payload.vote === "nay") {
            nayWeight = requireContractUInt64(
              nayWeight + weight,
              "running nay tally",
            );
          } else {
            abstainWeight = requireContractUInt64(
              abstainWeight + weight,
              "running abstain tally",
            );
          }
        }
        if (!finalTallyHeights.has(fact.blockHeight)) {
          const totalParticipatingVotes = calculateParticipatingVotes(
            yayWeight,
            nayWeight,
            abstainWeight,
            `running tally for proposalPublicKey=${proposal.proposalPublicKey}`,
          );
          runningTalliesByHeight.set(fact.blockHeight, {
            archiveEventId: null,
            blockHeight: fact.blockHeight,
            blockEventIndex: fact.blockEventIndex,
            sourceStatus: runningSourceStatus,
            yayWeight: yayWeight.toString(),
            nayWeight: nayWeight.toString(),
            abstainWeight: abstainWeight.toString(),
            totalParticipatingVotes: totalParticipatingVotes.toString(),
            approvalBp: calculateApprovalBp(yayWeight, nayWeight),
            voteResult: await this.voteDependencies!.calculateVoteResult(
              proposal,
              yayWeight,
              nayWeight,
              abstainWeight,
            ),
            createdByEventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          });
        }
        continue;
      }

      const payload = asPayload<ProposalTallyPayload>(fact);
      if (payload.lifecycleId !== proposal.lifecycleId) {
        throw new Error(
          `[proposal-processor] tally lifecycleId=${payload.lifecycleId} does not match proposal lifecycleId=${proposal.lifecycleId} for proposalPublicKey=${proposal.proposalPublicKey}`,
        );
      }
      const finalTally = calculatePayloadLocalFinalTally(
        proposal,
        payload,
        fact.archiveEventId,
      );
      runningTalliesByHeight.delete(fact.blockHeight);
      finalTallyHeights.add(fact.blockHeight);
      finalTalliesByArchiveEventId.set(fact.archiveEventId, {
        archiveEventId: fact.archiveEventId,
        blockHeight: fact.blockHeight,
        blockEventIndex: fact.blockEventIndex,
        sourceStatus: fact.status,
        yayWeight: finalTally.yayWeight.toString(),
        nayWeight: finalTally.nayWeight.toString(),
        abstainWeight: finalTally.abstainWeight.toString(),
        totalParticipatingVotes: finalTally.totalParticipatingVotes.toString(),
        approvalBp: finalTally.approvalBp,
        voteResult: finalTally.voteResult,
        createdByEventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      });
    }

    const projectedTallies = [
      ...runningTalliesByHeight.values(),
      ...finalTalliesByArchiveEventId.values(),
    ].sort(compareTallyProjections);
    for (const tally of projectedTallies) {
      await tallyRepository.insert({
        archiveEventId: tally.archiveEventId,
        proposalPublicKey: proposal.proposalPublicKey,
        blockHeight: tally.blockHeight,
        blockEventIndex: tally.blockEventIndex,
        sourceStatus: tally.sourceStatus,
        yayWeight: tally.yayWeight,
        nayWeight: tally.nayWeight,
        abstainWeight: tally.abstainWeight,
        requiredParticipationBp: proposal.requiredParticipationBp,
        requiredApprovalBp: proposal.requiredApprovalBp,
        requiredParticipation: proposal.requiredParticipation,
        totalParticipatingVotes: tally.totalParticipatingVotes,
        approvalBp: tally.approvalBp,
        voteResult: tally.voteResult,
        createdByEventType: tally.createdByEventType,
      });
    }

    for (const fact of voteFacts) {
      const payload = asPayload<ProposalVotePayload>(fact);
      if (isExactVoteReducerPadding(payload.vote, payload.voterPublicKey)) {
        continue;
      }
      const voteWeight = weightByEvent.get(fact.archiveEventId) ?? 0n;
      const ownsNullifier =
        activeVoteOwnerByVoter.get(payload.voterPublicKey)?.archiveEventId ===
        fact.archiveEventId;
      if (ownsNullifier) {
        if (fact.blockHeight === null) {
          throw new Error(
            `[proposal-processor] vote event id=${fact.archiveEventId} is missing blockHeight`,
          );
        }
        await nullifierRepository.insert({
          sourceEventId: fact.archiveEventId,
          proposalPublicKey: proposal.proposalPublicKey,
          voterPublicKey: payload.voterPublicKey,
          vote: payload.vote,
          voteWeight: payload.vote === "dummy" ? "0" : voteWeight.toString(),
          blockHeight: fact.blockHeight,
        });
      }
      await voteRepository.insert({
        archiveEventId: fact.archiveEventId,
        proposalPublicKey: proposal.proposalPublicKey,
        voterPublicKey: payload.voterPublicKey,
        vote: payload.vote,
        voteWeight:
          ownsNullifier && payload.vote !== "dummy"
            ? voteWeight.toString()
            : "0",
        blockHeight: fact.blockHeight,
        blockEventIndex: fact.blockEventIndex,
        isNullified: !ownsNullifier,
        status: fact.status,
      });
    }
  }

  private async reconcileExecutions(
    proposal: ProposalEntity,
    facts: ProposalEventFactEntity[],
    manager: EntityManager,
  ): Promise<void> {
    const executionFacts = facts.filter(
      (fact) =>
        fact.eventType === PROPOSAL_EXECUTED_EVENT_NAME && isSurviving(fact),
    );

    const executionRepository = manager.getRepository(ProposalExecutionEntity);
    if (executionFacts.length === 0) {
      await executionRepository.delete({
        proposalPublicKey: proposal.proposalPublicKey,
      });
      await manager
        .getRepository(ProposalEntity)
        .update(
          { proposalPublicKey: proposal.proposalPublicKey },
          { paidOutAmount: "0" },
        );
      proposal.paidOutAmount = "0";
      return;
    }

    const proposalAmount = requireContractUInt64(
      BigInt(proposal.amount),
      `proposal amount for proposalPublicKey=${proposal.proposalPublicKey}`,
    );
    const bondAmount = proposalAmount / BigInt(BOND_AMOUNT_DIVISOR);
    const totalPayoutAmount = requireContractUInt64(
      proposalAmount + bondAmount,
      `total payout amount for proposalPublicKey=${proposal.proposalPublicKey}`,
    );
    const activeEventIds = new Set(
      executionFacts.map((fact) => fact.archiveEventId),
    );
    let paidOutAmount = 0n;
    for (const fact of executionFacts) {
      const payload = asPayload<ProposalExecutionPayload>(fact);
      if (
        payload.recipient !== undefined &&
        payload.recipient !== proposal.recipient
      ) {
        throw new Error(
          `[proposal-processor] execution recipient=${payload.recipient} does not match proposal recipient=${proposal.recipient} for proposalPublicKey=${proposal.proposalPublicKey}`,
        );
      }
      const amountToPayOut = requireContractUInt64(
        BigInt(payload.amountToPayOut),
        `execution amount for archiveEventId=${fact.archiveEventId}`,
      );
      paidOutAmount = requireContractUInt64(
        paidOutAmount + amountToPayOut,
        `paid out amount for proposalPublicKey=${proposal.proposalPublicKey}`,
      );
      if (paidOutAmount > totalPayoutAmount) {
        throw new Error(
          `[proposal-processor] paid out amount exceeds the contract payout limit for proposalPublicKey=${proposal.proposalPublicKey}`,
        );
      }
      await executionRepository.upsert(
        {
          archiveEventId: fact.archiveEventId,
          proposalPublicKey: proposal.proposalPublicKey,
          lifecycleId: proposal.lifecycleId,
          recipient: proposal.recipient,
          amountToPayOut: payload.amountToPayOut,
          proposalAmount: proposal.amount,
          bondAmount: bondAmount.toString(),
          senderPublicKey: payload.senderPublicKey,
          paidOutAmount: paidOutAmount.toString(),
          remainingAmount: (totalPayoutAmount - paidOutAmount).toString(),
          blockHeight: fact.blockHeight,
          blockEventIndex: fact.blockEventIndex,
          status: fact.status,
        },
        ["archiveEventId"],
      );
    }

    const executionRows = await executionRepository.findBy({
      proposalPublicKey: proposal.proposalPublicKey,
    });
    for (const execution of executionRows) {
      if (!activeEventIds.has(execution.archiveEventId)) {
        await executionRepository.delete({ id: execution.id });
      }
    }

    await manager
      .getRepository(ProposalEntity)
      .update(
        { proposalPublicKey: proposal.proposalPublicKey },
        { paidOutAmount: paidOutAmount.toString() },
      );
    proposal.paidOutAmount = paidOutAmount.toString();
  }
}

// This default keeps direct handler construction compatible with one processor.
// Applications that create more than one processor in a process must inject one
// reconciler per handler set so vote-ledger dependencies cannot overwrite each
// other.
export const defaultProposalProjectionReconciler =
  new ProposalProjectionReconciler();
