import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { PROPOSAL_VOTE_DISPATCHED_EVENT_NAME } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { EntityManager } from "typeorm";
import type { StakingLedgerServiceLookup } from "../../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { ProposalEntity } from "./proposal-entity.js";
import {
  defaultProposalProjectionReconciler,
  ProposalProjectionReconciler,
} from "./proposal-projection-reconciler.js";
import {
  parseContractFieldArray,
  parseContractPublicKey,
  parseContractUInt128,
  parseContractUInt64,
  requireContractUInt64,
} from "./proposal-contract-domain.js";
import { getRawProposalEventFields } from "./proposal-event-decoding.js";
import { type VotingLedgerServiceLookup } from "./lifecycle-voting-ledger-service-registry.js";
import type { VoteLabel } from "./vote-entity.js";
import type { VoteTallyVoteResult } from "./vote-tally-entity.js";
import { getDefaultTokenTreasuryAccount } from "./default-token-treasury-account.js";
import { StakingLedgerVoteWeightResolver } from "./staking-ledger-vote-weight.js";

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
  const rawFields = getRawProposalEventFields(
    event,
    PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  );
  if (rawFields.kind === "absent") {
    return decodeArchiveProvidedVotePayload(event);
  }
  if (rawFields.kind === "invalid") {
    return null;
  }
  const data = parseContractFieldArray(rawFields.fields);
  if (!data) {
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
    const { Field, PublicKey } = o1jsModule as {
      Field: (value: string) => unknown;
      PublicKey: { check(value: unknown): void };
    };
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
    PublicKey.check(decoded.proposalPublicKey);
    PublicKey.check(decoded.voterPublicKey);
    PublicKey.check(decoded.senderPublicKey);
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
  const proposalPublicKey = parseContractPublicKey(candidate.proposalPublicKey);
  const voterPublicKey = parseContractPublicKey(candidate.voterPublicKey);
  const senderPublicKey =
    candidate.senderPublicKey === null ||
    candidate.senderPublicKey === undefined
      ? null
      : parseContractPublicKey(candidate.senderPublicKey);
  if (
    proposalPublicKey === null ||
    voterPublicKey === null ||
    typeof candidate.vote !== "string" ||
    (candidate.senderPublicKey != null && senderPublicKey === null)
  ) {
    return null;
  }
  const vote = candidate.vote.trim().toLowerCase();
  if (
    vote !== "dummy" &&
    vote !== "yay" &&
    vote !== "nay" &&
    vote !== "abstain"
  ) {
    return null;
  }
  return {
    proposalPublicKey,
    voterPublicKey,
    vote,
    senderPublicKey,
  };
}

function createContractProposalApprovalMath(): ProposalApprovalMath {
  const loadApprovalMathDeps = async (): Promise<{
    UInt64: { from(value: bigint): unknown };
    UInt128: { from(value: bigint): unknown };
    ProposalStatus: {
      APPROVED: { equals(value: unknown): { toBoolean(): boolean } };
    };
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
      TreasuryProposalSmartContract:
        treasuryProposalAny.TreasuryProposalSmartContract,
    };
  };

  return {
    async calculateAcceptanceCriteria(input) {
      const { UInt64, UInt128, TreasuryProposalSmartContract } =
        await loadApprovalMathDeps();
      const criteria =
        TreasuryProposalSmartContract.calculateAcceptanceCriteria(
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
  private readonly stakingVoteWeightResolver: StakingLedgerVoteWeightResolver | null;

  public constructor(
    private readonly votingLedgerServices:
      | VotingLedgerServiceLookup
      | undefined,
    private readonly approvalMath: ProposalApprovalMath = createContractProposalApprovalMath(),
    private readonly options: ProposalVoteDispatchedEventHandlerOptions = {},
    private readonly reconciler: ProposalProjectionReconciler = defaultProposalProjectionReconciler,
  ) {
    this.stakingVoteWeightResolver = options.stakingLedgerServices
      ? new StakingLedgerVoteWeightResolver(options.stakingLedgerServices)
      : null;
    this.reconciler.configureVoteProjection({
      getVoteWeight: async (proposal, voterPublicKey) => {
        if (this.stakingVoteWeightResolver) {
          const expectedRoot = proposal.stakingEpochDataLedgerHash;
          if (!expectedRoot) {
            throw new Error(
              `[proposal-processor] proposal is missing staking ledger root for proposalPublicKey=${proposal.proposalPublicKey}`,
            );
          }
          return await this.stakingVoteWeightResolver.getVoteWeight(
            String(proposal.lifecycleId),
            expectedRoot,
            voterPublicKey,
          );
        }

        // Compatibility seam for tests that inject a voting-ledger lookup.
        // Production supplies stakingLedgerServices and does not use this path.
        return await this.getVoteWeightFromLedger(
          String(proposal.lifecycleId),
          voterPublicKey,
        );
      },
      calculateVoteResult: async (
        proposal,
        yayWeight,
        nayWeight,
        abstainWeight,
      ) =>
        await this.calculateVoteTallyResult(
          proposal,
          yayWeight,
          nayWeight,
          abstainWeight,
        ),
    });
  }

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalVoteDispatchedPayload(event);
    if (!payload) {
      return false;
    }

    await this.reconciler.recordAndReconcile(
      event,
      PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      { ...payload },
      manager,
    );
    return true;
  }

  private async getVoteWeightFromLedger(
    lifecycleId: string,
    voterPublicKey: string,
  ): Promise<bigint> {
    if (!this.votingLedgerServices) {
      throw new Error(
        `[proposal-processor] test voting-ledger lookup is not configured for lifecycleId=${lifecycleId}`,
      );
    }
    try {
      const votingLedger =
        await this.votingLedgerServices.getService(lifecycleId);
      return requireContractUInt64(
        await votingLedger.getVoteWeight(voterPublicKey),
        `vote weight for voterPublicKey=${voterPublicKey}`,
      );
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

  private async calculateVoteTallyResult(
    proposal: ProposalEntity | null,
    yayWeight: bigint,
    nayWeight: bigint,
    abstainWeight: bigint,
  ): Promise<VoteTallyVoteResult> {
    if (!proposal || !proposal.stakingEpochDataLedgerTotalCurrency) {
      return "rejected";
    }

    const proposalAmountValue = parseContractUInt64(proposal.amount);
    const stakingTotalValue = parseContractUInt64(
      proposal.stakingEpochDataLedgerTotalCurrency,
    );
    if (proposalAmountValue === null || stakingTotalValue === null) {
      throw new Error(
        `[proposal-processor] proposal ${proposal.proposalPublicKey} has values outside the contract UInt64 domain`,
      );
    }
    const proposalAmount = BigInt(proposalAmountValue);
    const stakingEpochDataLedgerTotalCurrency = BigInt(stakingTotalValue);

    let criteria: {
      requiredParticipation: bigint;
      requiredApprovalBp: bigint;
    };
    if (
      proposal.requiredParticipation !== null &&
      proposal.requiredApprovalBp !== null
    ) {
      const requiredParticipation = parseContractUInt128(
        proposal.requiredParticipation,
      );
      const requiredApprovalBp = parseContractUInt128(
        proposal.requiredApprovalBp,
      );
      if (requiredParticipation === null || requiredApprovalBp === null) {
        throw new Error(
          `[proposal-processor] proposal ${proposal.proposalPublicKey} has acceptance criteria outside the contract UInt128 domain`,
        );
      }
      criteria = {
        requiredParticipation: BigInt(requiredParticipation),
        requiredApprovalBp: BigInt(requiredApprovalBp),
      };
    } else {
      criteria = await this.approvalMath.calculateAcceptanceCriteria({
        // Legacy rows do not have persisted criteria yet.
        proposalAmount,
        treasuryBalance: await this.getTreasuryBalanceForLifecycle(proposal),
        stakingEpochDataLedgerTotalCurrency,
      });
    }

    return await this.approvalMath.calculateVoteResult({
      yay: yayWeight,
      nay: nayWeight,
      abstain: abstainWeight,
      requiredParticipation: criteria.requiredParticipation,
      requiredApprovalBp: criteria.requiredApprovalBp,
    });
  }

  private async getTreasuryBalanceForLifecycle(
    proposal: ProposalEntity,
  ): Promise<bigint> {
    const lifecycleId = proposal.lifecycleId;
    const customResolver = this.options.resolveTreasuryBalanceForLifecycle;
    if (customResolver) {
      const resolved = await customResolver(lifecycleId);
      if (!resolved) {
        throw new Error(
          `[proposal-processor] treasury balance resolver returned empty value for lifecycleId=${lifecycleId}`,
        );
      }
      const value = parseContractUInt64(resolved);
      if (value === null) {
        throw new Error(
          `[proposal-processor] treasury balance resolver returned a value outside the UInt64 domain for lifecycleId=${lifecycleId}`,
        );
      }
      return BigInt(value);
    }

    const stakingLedgerServices = this.options.stakingLedgerServices;
    const treasuryOwnerPublicKey = this.options.treasuryOwnerPublicKey;
    if (!stakingLedgerServices || !treasuryOwnerPublicKey) {
      throw new Error(
        `[proposal-processor] staking-ledger treasury balance lookup is not configured for lifecycleId=${lifecycleId}`,
      );
    }

    await this.assertLocalStakingLedgerRoot(proposal);
    const stakingLedger = await stakingLedgerServices.getService(
      String(lifecycleId),
    );
    const treasuryAccount = await getDefaultTokenTreasuryAccount(
      stakingLedger,
      treasuryOwnerPublicKey,
      lifecycleId,
      proposal.stakingEpochDataLedgerHash!,
    );
    const balance = treasuryAccount.balance;
    const balanceValue = parseContractUInt64(balance.toString());
    if (balanceValue === null) {
      throw new Error(
        `[proposal-processor] treasury balance is outside the UInt64 domain for lifecycleId=${lifecycleId}`,
      );
    }
    return BigInt(balanceValue);
  }

  private async assertLocalStakingLedgerRoot(
    proposal: ProposalEntity,
  ): Promise<void> {
    const stakingLedgerServices = this.options.stakingLedgerServices;
    if (!stakingLedgerServices) {
      if (this.options.resolveTreasuryBalanceForLifecycle) {
        // Dependency-injected tests can supply an already verified ledger view.
        return;
      }
      throw new Error(
        `[proposal-processor] staking-ledger root verification is not configured for lifecycleId=${proposal.lifecycleId}`,
      );
    }

    const expectedRoot = proposal.stakingEpochDataLedgerHash;
    if (!expectedRoot) {
      throw new Error(
        `[proposal-processor] proposal is missing staking ledger root for proposalPublicKey=${proposal.proposalPublicKey}`,
      );
    }
    const stakingLedger = await stakingLedgerServices.getService(
      String(proposal.lifecycleId),
    );
    const actualRoot = (await stakingLedger.getRootHash()).toString();
    if (actualRoot !== expectedRoot) {
      throw new Error(
        `[proposal-processor] staking ledger root mismatch for lifecycleId=${proposal.lifecycleId}: expected=${expectedRoot} actual=${actualRoot}`,
      );
    }
  }
}
