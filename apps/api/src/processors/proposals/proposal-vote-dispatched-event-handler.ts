import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import type { EntityManager } from "typeorm";
import type { StakingLedgerServiceLookup } from "../../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { ProposalEntity } from "./proposal-entity.js";
import {
  type VotingLedgerServiceLookup,
} from "./lifecycle-voting-ledger-service-registry.js";
import { VoteEntity, type VoteLabel } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";
import {
  VoteTallyEntity,
  type VoteTallyVoteResult,
} from "./vote-tally-entity.js";

const PROPOSAL_VOTE_DISPATCHED_EVENT_NAME = "proposalVoteDispatched";
const PROPOSAL_VOTES_TALLIED_EVENT_NAME = "proposalVotesTallied";

interface DecodedProposalVotePayload {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: VoteLabel;
  senderPublicKey: string | null;
}

interface ProposalApprovalMath {
  calculateAcceptanceCriteria(input: {
    proposalAmount: bigint;
    treasuryBalance: bigint;
    stakingEpochDataLedgerTotalCurrency: bigint;
  }): Promise<{
    requiredParticipation: bigint;
    requiredApprovalBp: bigint;
  }>;
  calculateVoteResult(input: {
    yay: bigint;
    nay: bigint;
    abstain: bigint;
    requiredParticipation: bigint;
    requiredApprovalBp: bigint;
  }): Promise<VoteTallyVoteResult>;
}

interface ProposalVoteDispatchedEventHandlerOptions {
  stakingLedgerServices?: StakingLedgerServiceLookup;
  treasuryOwnerPublicKey?: string;
  resolveTreasuryBalanceForLifecycle?: (
    lifecycleId: number,
  ) => Promise<string | null>;
}

const O1JS_MODULE_NAME = "o1js";
const TREASURY_PROPOSAL_MODULE_NAME =
  "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";

function toVoteLabel(value: bigint): VoteLabel | null {
  if (value === 0n) {
    return "dummy";
  }
  if (value === 1n) {
    return "yay";
  }
  if (value === 2n) {
    return "nay";
  }
  if (value === 3n) {
    return "abstain";
  }
  return null;
}

async function decodeProposalVoteDispatchedPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalVotePayload | null> {
  const archiveProvidedPayload = decodeArchiveProvidedVotePayload(event);
  if (archiveProvidedPayload) {
    return archiveProvidedPayload;
  }

  const data = event.rawEventData.data;
  if (!Array.isArray(data)) {
    return null;
  }
  if (
    event.eventType &&
    event.eventType !== "unknown" &&
    event.eventType !== PROPOSAL_VOTE_DISPATCHED_EVENT_NAME
  ) {
    return null;
  }

  try {
    const o1jsModuleName = "o1js";
    const proposalEventsModuleName =
      "@repo/sdk/src/provable/events/treasury-proposal-events.js";
    const [o1jsModule, proposalEventsModule] = await Promise.all([
      import(o1jsModuleName),
      import(proposalEventsModuleName),
    ]);
    const Field = (o1jsModule as { Field: (value: string) => unknown }).Field;
    const ProposalVoteDispatchedEvent = (
      proposalEventsModule as {
        ProposalVoteDispatchedEvent: {
          fromFields(values: unknown[]): {
            vote: { toBigInt(): bigint };
            proposalPublicKey: { toBase58(): string };
            voterPublicKey: { toBase58(): string };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalVoteDispatchedEvent;
    const decoded = ProposalVoteDispatchedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    const vote = toVoteLabel(decoded.vote.toBigInt());
    if (!vote) {
      return null;
    }

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      voterPublicKey: decoded.voterPublicKey.toBase58(),
      vote,
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalVoteDispatched event id=${event.id}`,
      error,
    );
    return null;
  }
}

function decodeArchiveProvidedVotePayload(
  event: ArchiveEventEntity,
): DecodedProposalVotePayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    voterPublicKey?: unknown;
    vote?: unknown;
    senderPublicKey?: unknown;
  };
  if (
    typeof candidate.proposalPublicKey !== "string" ||
    typeof candidate.voterPublicKey !== "string" ||
    typeof candidate.vote !== "string"
  ) {
    return null;
  }
  const vote = candidate.vote.trim().toLowerCase();
  if (vote !== "dummy" && vote !== "yay" && vote !== "nay" && vote !== "abstain") {
    return null;
  }
  return {
    proposalPublicKey: candidate.proposalPublicKey,
    voterPublicKey: candidate.voterPublicKey,
    vote,
    senderPublicKey: typeof candidate.senderPublicKey === "string" ? candidate.senderPublicKey : null,
  };
}

function createContractProposalApprovalMath(): ProposalApprovalMath {
  const loadApprovalMathDeps = async (): Promise<{
    UInt64: { from(value: bigint): unknown };
    UInt128: { from(value: bigint): unknown };
    ProposalStatus: { APPROVED: { equals(value: unknown): { toBoolean(): boolean } } };
    TreasuryProposalSmartContract: {
      calculateAcceptanceCriteria(
        proposalAmount: unknown,
        treasuryBalance: unknown,
        stakingEpochDataLedgerTotalCurrency: unknown,
      ): {
        requiredParticipation: { toBigInt(): bigint };
        requiredApprovalBp: { toBigInt(): bigint };
      };
      calculateApprovalStatus(input: {
        yay: unknown;
        nay: unknown;
        abstain: unknown;
        requiredParticipation: unknown;
        requiredApprovalBp: unknown;
      }): { voteResult: unknown };
    };
  }> => {
    const [o1js, treasuryProposal] = await Promise.all([
      import(O1JS_MODULE_NAME),
      import(TREASURY_PROPOSAL_MODULE_NAME),
    ]);
    const o1jsAny = o1js as any;
    const treasuryProposalAny = treasuryProposal as any;

    return {
      UInt64: o1jsAny.UInt64,
      UInt128: o1jsAny.UInt128,
      ProposalStatus: treasuryProposalAny.ProposalStatus,
      TreasuryProposalSmartContract: treasuryProposalAny.TreasuryProposalSmartContract,
    };
  };

  return {
    async calculateAcceptanceCriteria(input) {
      const { UInt64, UInt128, TreasuryProposalSmartContract } =
        await loadApprovalMathDeps();
      const criteria = TreasuryProposalSmartContract.calculateAcceptanceCriteria(
        UInt128.from(input.proposalAmount),
        UInt128.from(input.treasuryBalance),
        UInt64.from(input.stakingEpochDataLedgerTotalCurrency),
      );
      return {
        requiredParticipation: criteria.requiredParticipation.toBigInt(),
        requiredApprovalBp: criteria.requiredApprovalBp.toBigInt(),
      };
    },
    async calculateVoteResult(input) {
      const { ProposalStatus, TreasuryProposalSmartContract, UInt128 } =
        await loadApprovalMathDeps();
      const contractVoteStatus =
        TreasuryProposalSmartContract.calculateApprovalStatus({
          yay: UInt128.from(input.yay),
          nay: UInt128.from(input.nay),
          abstain: UInt128.from(input.abstain),
          requiredParticipation: UInt128.from(input.requiredParticipation),
          requiredApprovalBp: UInt128.from(input.requiredApprovalBp),
        });
      const isApproved = ProposalStatus.APPROVED.equals(
        contractVoteStatus.voteResult,
      ).toBoolean();
      return isApproved ? "approved" : "rejected";
    },
  };
}

export class ProposalVoteDispatchedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_VOTE_DISPATCHED_EVENT_NAME;

  public constructor(
    private readonly votingLedgerServices: VotingLedgerServiceLookup,
    private readonly approvalMath: ProposalApprovalMath = createContractProposalApprovalMath(),
    private readonly options: ProposalVoteDispatchedEventHandlerOptions = {},
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const voteRepository = manager.getRepository(VoteEntity);
    const proposalRepository = manager.getRepository(ProposalEntity);
    const voteNullifierRepository = manager.getRepository(VoteNullifierEntity);
    const payload = await decodeProposalVoteDispatchedPayload(event);
    if (!payload) {
      return false;
    }

    const existingVote = await voteRepository.findOneBy({
      archiveEventId: event.id,
    });
    const existingNullifier = await voteNullifierRepository.findOneBy({
      proposalPublicKey: payload.proposalPublicKey,
      voterPublicKey: payload.voterPublicKey,
    });
    const proposal = await proposalRepository.findOneBy({
      proposalPublicKey: payload.proposalPublicKey,
    });

    if (event.status === "orphaned") {
      await voteRepository.upsert(
        {
          archiveEventId: event.id,
          proposalPublicKey: payload.proposalPublicKey,
          voterPublicKey: payload.voterPublicKey,
          vote: payload.vote,
          voteWeight: existingVote?.voteWeight ?? "0",
          blockHeight: event.blockHeight ?? existingVote?.blockHeight ?? null,
          isNullified:
            existingNullifier !== null &&
            existingNullifier.sourceEventId !== event.id,
          status: event.status,
        },
        ["archiveEventId"],
      );

      if (
        existingNullifier &&
        existingNullifier.sourceEventId === event.id
      ) {
        await this.applyVoteWeightDelta(manager, {
          proposal,
          proposalPublicKey: existingNullifier.proposalPublicKey,
          blockHeight: existingNullifier.blockHeight,
          vote: existingNullifier.vote,
          deltaWeight: -BigInt(existingNullifier.voteWeight),
        });
        await voteNullifierRepository.delete({
          id: existingNullifier.id,
        });
      }

      return true;
    }

    const blockHeight = this.resolveEventBlockHeight(event);
    if (!proposal) {
      throw new Error(
        `[proposal-processor] proposal row missing for proposalPublicKey=${payload.proposalPublicKey}; cannot project vote`,
      );
    }

    const voteWeight = await this.getVoteWeightFromLedger(
      String(proposal.lifecycleId),
      payload.voterPublicKey,
    );

    const isDuplicateVote =
      existingNullifier !== null &&
      existingNullifier.sourceEventId !== event.id;

    if (!existingNullifier) {
      await this.applyVoteWeightDelta(manager, {
        proposal,
        proposalPublicKey: payload.proposalPublicKey,
        blockHeight,
        vote: payload.vote,
        deltaWeight: voteWeight,
      });
      await voteNullifierRepository.insert({
        sourceEventId: event.id,
        proposalPublicKey: payload.proposalPublicKey,
        voterPublicKey: payload.voterPublicKey,
        vote: payload.vote,
        voteWeight: voteWeight.toString(),
        blockHeight,
      });
    }

    await voteRepository.upsert(
      {
        archiveEventId: event.id,
        proposalPublicKey: payload.proposalPublicKey,
        voterPublicKey: payload.voterPublicKey,
        vote: payload.vote,
        voteWeight: voteWeight.toString(),
        blockHeight,
        isNullified: isDuplicateVote,
        status: event.status,
      },
      ["archiveEventId"],
    );
    return true;
  }

  private resolveEventBlockHeight(event: ArchiveEventEntity): number {
    if (typeof event.blockHeight === "number") {
      return event.blockHeight;
    }
    throw new Error(
      `[proposal-processor] vote event id=${event.id} is missing blockHeight`,
    );
  }

  private async getVoteWeightFromLedger(
    lifecycleId: string,
    voterPublicKey: string,
  ): Promise<bigint> {
    try {
      const votingLedger = await this.votingLedgerServices.getService(lifecycleId);
      return await votingLedger.getVoteWeight(voterPublicKey);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "LifecycleVotingLedgerFileNotFoundError"
      ) {
        throw new Error(
          `[proposal-processor] lifecycle voting ledger sqlite is unavailable for lifecycleId=${lifecycleId}`,
        );
      }
      throw error;
    }
  }

  private async applyVoteWeightDelta(
    manager: EntityManager,
    input: {
      proposal: ProposalEntity | null;
      proposalPublicKey: string;
      blockHeight: number;
      vote: VoteLabel;
      deltaWeight: bigint;
    },
  ): Promise<void> {
    if (input.vote === "dummy" || input.deltaWeight === 0n) {
      return;
    }

    const tallyRepository = manager.getRepository(VoteTallyEntity);
    const existingTallies = await tallyRepository.find({
      where: {
        proposalPublicKey: input.proposalPublicKey,
      },
      order: {
        blockHeight: "ASC",
        createdAt: "ASC",
        id: "ASC",
      },
    });

    const talliedRowAtBlock = existingTallies.find(
      (row) =>
        row.blockHeight === input.blockHeight &&
        row.createdByEventType === PROPOSAL_VOTES_TALLIED_EVENT_NAME,
    );
    if (talliedRowAtBlock) {
      throw new Error(
        `[proposal-processor] cannot apply dispatched vote delta on tallied block for proposalPublicKey=${input.proposalPublicKey} blockHeight=${input.blockHeight}`,
      );
    }

    const dispatchTallies = existingTallies.filter(
      (row) =>
        row.createdByEventType === null ||
        row.createdByEventType === PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    );
    const previousDispatchTally = dispatchTallies
      .filter((row) => row.blockHeight < input.blockHeight)
      .at(-1);
    const existingDispatchTally = dispatchTallies.find(
      (row) => row.blockHeight === input.blockHeight,
    );

    const baseTally =
      existingDispatchTally ??
      tallyRepository.create({
        proposalPublicKey: input.proposalPublicKey,
        blockHeight: input.blockHeight,
        yayWeight: previousDispatchTally?.yayWeight ?? "0",
        nayWeight: previousDispatchTally?.nayWeight ?? "0",
        abstainWeight: previousDispatchTally?.abstainWeight ?? "0",
        requiredParticipationBp:
          previousDispatchTally?.requiredParticipationBp ??
          input.proposal?.requiredParticipationBp ??
          null,
        requiredApprovalBp:
          previousDispatchTally?.requiredApprovalBp ??
          input.proposal?.requiredApprovalBp ??
          null,
        requiredParticipation:
          previousDispatchTally?.requiredParticipation ??
          input.proposal?.requiredParticipation ??
          null,
        totalParticipatingVotes: previousDispatchTally?.totalParticipatingVotes ?? null,
        approvalBp: previousDispatchTally?.approvalBp ?? null,
        voteResult: previousDispatchTally?.voteResult ?? null,
        createdByEventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      });

    const talliesToUpdate = [
      baseTally,
      ...dispatchTallies.filter((row) => row.blockHeight > input.blockHeight),
    ];

    for (const tally of talliesToUpdate) {
      const delta = input.deltaWeight;
      let updatedYay = BigInt(tally.yayWeight);
      let updatedNay = BigInt(tally.nayWeight);
      let updatedAbstain = BigInt(tally.abstainWeight);
      if (input.vote === "yay") {
        updatedYay += delta;
      } else if (input.vote === "nay") {
        updatedNay += delta;
      } else if (input.vote === "abstain") {
        updatedAbstain += delta;
      }

      if (updatedYay < 0n || updatedNay < 0n || updatedAbstain < 0n) {
        throw new Error(
          `[proposal-processor] vote tally underflow for proposalPublicKey=${input.proposalPublicKey} blockHeight=${tally.blockHeight}`,
        );
      }

      const voteResult = await this.calculateVoteTallyResult(
        input.proposal,
        updatedYay,
        updatedNay,
        updatedAbstain,
      );
      const totalParticipatingVotes = (updatedYay + updatedNay + updatedAbstain).toString();
      const approvalBp =
        updatedYay + updatedNay > 0n
          ? ((updatedYay * 10_000n) / (updatedYay + updatedNay)).toString()
          : "0";

      await tallyRepository.upsert(
        {
          proposalPublicKey: input.proposalPublicKey,
          blockHeight: tally.blockHeight,
          yayWeight: updatedYay.toString(),
          nayWeight: updatedNay.toString(),
          abstainWeight: updatedAbstain.toString(),
          requiredParticipationBp:
            tally.requiredParticipationBp ?? input.proposal?.requiredParticipationBp ?? null,
          requiredApprovalBp:
            tally.requiredApprovalBp ?? input.proposal?.requiredApprovalBp ?? null,
          requiredParticipation:
            tally.requiredParticipation ?? input.proposal?.requiredParticipation ?? null,
          totalParticipatingVotes,
          approvalBp,
          voteResult,
          createdByEventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        },
        ["proposalPublicKey", "blockHeight"],
      );
    }
  }

  private async calculateVoteTallyResult(
    proposal: ProposalEntity | null,
    yayWeight: bigint,
    nayWeight: bigint,
    abstainWeight: bigint,
  ): Promise<VoteTallyVoteResult> {
    if (!proposal || !proposal.stakingEpochDataLedgerTotalCurrency) {
      return "rejected";
    }

    const proposalAmount = BigInt(proposal.amount);
    const stakingEpochDataLedgerTotalCurrency = BigInt(
      proposal.stakingEpochDataLedgerTotalCurrency,
    );
    if (proposalAmount <= 0n || stakingEpochDataLedgerTotalCurrency <= 0n) {
      return "rejected";
    }

    const criteria =
      proposal.requiredParticipation !== null &&
      proposal.requiredApprovalBp !== null
        ? {
            requiredParticipation: BigInt(proposal.requiredParticipation),
            requiredApprovalBp: BigInt(proposal.requiredApprovalBp),
          }
        : await this.approvalMath.calculateAcceptanceCriteria({
            // Legacy rows do not have persisted criteria yet.
            proposalAmount,
            treasuryBalance: await this.getTreasuryBalanceForLifecycle(
              proposal.lifecycleId,
            ),
            stakingEpochDataLedgerTotalCurrency,
          });

    return await this.approvalMath.calculateVoteResult({
      yay: yayWeight,
      nay: nayWeight,
      abstain: abstainWeight,
      requiredParticipation: criteria.requiredParticipation,
      requiredApprovalBp: criteria.requiredApprovalBp,
    });
  }

  private async getTreasuryBalanceForLifecycle(lifecycleId: number): Promise<bigint> {
    const customResolver = this.options.resolveTreasuryBalanceForLifecycle;
    if (customResolver) {
      const resolved = await customResolver(lifecycleId);
      if (!resolved) {
        throw new Error(
          `[proposal-processor] treasury balance resolver returned empty value for lifecycleId=${lifecycleId}`,
        );
      }
      return BigInt(resolved);
    }

    const stakingLedgerServices = this.options.stakingLedgerServices;
    const treasuryOwnerPublicKey = this.options.treasuryOwnerPublicKey;
    if (!stakingLedgerServices || !treasuryOwnerPublicKey) {
      throw new Error(
        `[proposal-processor] staking-ledger treasury balance lookup is not configured for lifecycleId=${lifecycleId}`,
      );
    }

    const stakingLedger = await stakingLedgerServices.getService(String(lifecycleId));
    const treasuryAccount = await stakingLedger.getAccountByPublicKey(
      treasuryOwnerPublicKey,
    );
    if (!treasuryAccount) {
      throw new Error(
        `[proposal-processor] treasury account missing in staking ledger for lifecycleId=${lifecycleId} publicKey=${treasuryOwnerPublicKey}`,
      );
    }
    const balance = (
      treasuryAccount.account as unknown as {
        balance: { toString(): string };
      }
    ).balance;
    return BigInt(balance.toString());
  }
}
