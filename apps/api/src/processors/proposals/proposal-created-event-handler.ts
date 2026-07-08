import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import type { EntityManager } from "typeorm";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  type StakingLedgerServiceLookup,
} from "../../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { ProposalEntity } from "./proposal-entity.js";

const PROPOSAL_CREATED_EVENT_NAME = "proposalCreated";

interface DecodedProposalCreatedPayload {
  proposalPublicKey: string;
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

interface ProposalCreatedEventHandlerOptions {
  stakingLedgerServices?: StakingLedgerServiceLookup;
  treasuryOwnerPublicKey?: string;
  resolveTreasuryBalanceForLifecycle?: (
    lifecycleId: number,
  ) => Promise<string | null>;
  deriveAcceptanceCriteria?: (
    input: {
      proposalAmount: string;
      stakingEpochDataLedgerTotalCurrency: string | null;
      treasuryBalance: string | null;
    },
  ) => Promise<{
    requiredParticipationBp: string | null;
    requiredApprovalBp: string | null;
    requiredParticipation: string | null;
  }>;
}

function parseLifecycleId(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      return null;
    }
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }
  return null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

interface AcceptanceCriteriaComputationModules {
  UInt64: {
    from(value: bigint): unknown;
  };
  UInt128: {
    from(value: bigint): unknown;
  };
  TreasuryProposalSmartContract: {
    calculateAcceptanceCriteria(
      proposalAmount: unknown,
      treasuryBalance: unknown,
      stakingEpochDataLedgerTotalCurrency: unknown,
    ): {
      requiredParticipationBp: { toString(): string };
      requiredApprovalBp: { toString(): string };
      requiredParticipation: { toString(): string };
    };
  };
}

let acceptanceCriteriaComputationModulesPromise:
  | Promise<AcceptanceCriteriaComputationModules>
  | null = null;

async function getAcceptanceCriteriaComputationModules(): Promise<AcceptanceCriteriaComputationModules> {
  if (acceptanceCriteriaComputationModulesPromise) {
    return await acceptanceCriteriaComputationModulesPromise;
  }

  acceptanceCriteriaComputationModulesPromise = (async () => {
    const o1jsModuleName = "o1js";
    const treasuryProposalModuleName =
      "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
    const [o1jsModule, treasuryProposalModule] = await Promise.all([
      import(o1jsModuleName),
      import(treasuryProposalModuleName),
    ]);

    return {
      UInt64: (o1jsModule as { UInt64: AcceptanceCriteriaComputationModules["UInt64"] })
        .UInt64,
      UInt128: (
        o1jsModule as { UInt128: AcceptanceCriteriaComputationModules["UInt128"] }
      ).UInt128,
      TreasuryProposalSmartContract: (
        treasuryProposalModule as {
          TreasuryProposalSmartContract: AcceptanceCriteriaComputationModules["TreasuryProposalSmartContract"];
        }
      ).TreasuryProposalSmartContract,
    };
  })();

  return await acceptanceCriteriaComputationModulesPromise;
}

async function decodeProposalCreatedPayload(
  event: ArchiveEventEntity,
  getTreasuryBalanceForLifecycle: (lifecycleId: number) => Promise<string | null>,
  calculateAcceptanceCriteria: (
    input: {
      proposalAmount: string;
      stakingEpochDataLedgerTotalCurrency: string | null;
      treasuryBalance: string | null;
    },
  ) => Promise<{
    requiredParticipationBp: string | null;
    requiredApprovalBp: string | null;
    requiredParticipation: string | null;
  }>,
): Promise<DecodedProposalCreatedPayload | null> {
  const archiveProvidedPayload = decodeArchiveProvidedProposalPayload(event);
  if (archiveProvidedPayload) {
    const treasuryBalance = await getTreasuryBalanceForLifecycle(
      archiveProvidedPayload.lifecycleId,
    );
    const acceptanceCriteria = await calculateAcceptanceCriteria({
      proposalAmount: archiveProvidedPayload.amount,
      stakingEpochDataLedgerTotalCurrency:
        archiveProvidedPayload.stakingEpochDataLedgerTotalCurrency,
      treasuryBalance,
    });
    return {
      ...archiveProvidedPayload,
      requiredParticipationBp:
        acceptanceCriteria.requiredParticipationBp ??
        archiveProvidedPayload.requiredParticipationBp,
      requiredApprovalBp:
        acceptanceCriteria.requiredApprovalBp ??
        archiveProvidedPayload.requiredApprovalBp,
      requiredParticipation:
        acceptanceCriteria.requiredParticipation ??
        archiveProvidedPayload.requiredParticipation,
    };
  }

  const data = event.rawEventData.data;
  if (!Array.isArray(data)) {
    return null;
  }
  if (
    event.eventType &&
    event.eventType !== "unknown" &&
    event.eventType !== PROPOSAL_CREATED_EVENT_NAME
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
    const ProposalCreatedEvent = (
      proposalEventsModule as {
        ProposalCreatedEvent: {
          fromFields(values: unknown[]): {
            lifecycleId: { toBigint(): bigint };
            proposalPublicKey: { toBase58(): string };
            amount: { toString(): string };
            recipient: { toBase58(): string };
            zkAppUriHash: { toString(): string };
            stakingEpochDataLedgerHash: { toString(): string };
            stakingEpochDataLedgerTotalCurrency: { toString(): string };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalCreatedEvent;
    const decoded = ProposalCreatedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    const lifecycleId = Number(decoded.lifecycleId.toBigint());
    if (!Number.isInteger(lifecycleId) || lifecycleId < 0) {
      return null;
    }

    const stakingEpochDataLedgerTotalCurrency =
      decoded.stakingEpochDataLedgerTotalCurrency.toString();
    const treasuryBalance = await getTreasuryBalanceForLifecycle(lifecycleId);
    const acceptanceCriteria = await calculateAcceptanceCriteria({
      proposalAmount: decoded.amount.toString(),
      stakingEpochDataLedgerTotalCurrency,
      treasuryBalance,
    });

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      lifecycleId,
      amount: decoded.amount.toString(),
      recipient: decoded.recipient.toBase58(),
      zkAppUriHash: decoded.zkAppUriHash.toString(),
      stakingEpochDataLedgerHash: decoded.stakingEpochDataLedgerHash.toString(),
      stakingEpochDataLedgerTotalCurrency,
      requiredParticipationBp: acceptanceCriteria.requiredParticipationBp,
      requiredApprovalBp: acceptanceCriteria.requiredApprovalBp,
      requiredParticipation: acceptanceCriteria.requiredParticipation,
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalCreated event id=${event.id}`,
      error,
    );
    return null;
  }
}

function decodeArchiveProvidedProposalPayload(
  event: ArchiveEventEntity,
): DecodedProposalCreatedPayload | null {
  if (
    event.eventType &&
    event.eventType !== "unknown" &&
    event.eventType !== PROPOSAL_CREATED_EVENT_NAME
  ) {
    return null;
  }

  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    lifecycleId?: unknown;
    amount?: unknown;
    recipient?: unknown;
    zkAppUriHash?: unknown;
    stakingEpochDataLedgerHash?: unknown;
    stakingEpochDataLedgerTotalCurrency?: unknown;
    requiredParticipationBp?: unknown;
    requiredApprovalBp?: unknown;
    requiredParticipation?: unknown;
    senderPublicKey?: unknown;
  };
  const lifecycleId = parseLifecycleId(candidate.lifecycleId);
  if (
    typeof candidate.proposalPublicKey !== "string" ||
    lifecycleId === null ||
    typeof candidate.amount !== "string" ||
    typeof candidate.recipient !== "string" ||
    typeof candidate.zkAppUriHash !== "string"
  ) {
    return null;
  }

  return {
    proposalPublicKey: candidate.proposalPublicKey,
    lifecycleId,
    amount: candidate.amount,
    recipient: candidate.recipient,
    zkAppUriHash: candidate.zkAppUriHash,
    stakingEpochDataLedgerHash: asOptionalString(candidate.stakingEpochDataLedgerHash),
    stakingEpochDataLedgerTotalCurrency: asOptionalString(
      candidate.stakingEpochDataLedgerTotalCurrency,
    ),
    requiredParticipationBp: asOptionalString(candidate.requiredParticipationBp),
    requiredApprovalBp: asOptionalString(candidate.requiredApprovalBp),
    requiredParticipation: asOptionalString(candidate.requiredParticipation),
    senderPublicKey: asOptionalString(candidate.senderPublicKey),
  };
}

async function deriveAcceptanceCriteria(input: {
  proposalAmount: string;
  stakingEpochDataLedgerTotalCurrency: string | null;
  treasuryBalance: string | null;
}): Promise<{
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
}> {
  if (!input.stakingEpochDataLedgerTotalCurrency || !input.treasuryBalance) {
    return {
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
    };
  }

  const proposalAmount = BigInt(input.proposalAmount);
  const stakingEpochDataLedgerTotalCurrency = BigInt(
    input.stakingEpochDataLedgerTotalCurrency,
  );
  const treasuryBalance = BigInt(input.treasuryBalance);
  if (
    proposalAmount <= 0n ||
    stakingEpochDataLedgerTotalCurrency <= 0n ||
    treasuryBalance <= 0n
  ) {
    return {
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
    };
  }

  const modules = await getAcceptanceCriteriaComputationModules();
  const criteria = modules.TreasuryProposalSmartContract.calculateAcceptanceCriteria(
    modules.UInt128.from(proposalAmount),
    modules.UInt128.from(treasuryBalance),
    modules.UInt64.from(stakingEpochDataLedgerTotalCurrency),
  );
  return {
    requiredParticipationBp: criteria.requiredParticipationBp.toString(),
    requiredApprovalBp: criteria.requiredApprovalBp.toString(),
    requiredParticipation: criteria.requiredParticipation.toString(),
  };
}

export class ProposalCreatedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_CREATED_EVENT_NAME;

  public constructor(
    private readonly options: ProposalCreatedEventHandlerOptions = {},
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const proposalRepository = manager.getRepository(ProposalEntity);
    const payload = await decodeProposalCreatedPayload(
      event,
      async (lifecycleId) => await this.getTreasuryBalanceForLifecycle(lifecycleId),
      this.options.deriveAcceptanceCriteria ?? deriveAcceptanceCriteria,
    );
    if (!payload) {
      return false;
    }

    if (event.status === "orphaned") {
      await proposalRepository.delete({
        proposalPublicKey: payload.proposalPublicKey,
      });
      return true;
    }

    await proposalRepository.upsert(
      {
        ...payload,
        status: event.status,
        createdAtBlockHeight: event.blockHeight,
        createdAtBlockTimestamp: event.blockTimestamp,
      },
      ["proposalPublicKey"],
    );
    return true;
  }

  private async getTreasuryBalanceForLifecycle(
    lifecycleId: number,
  ): Promise<string | null> {
    const customResolver = this.options.resolveTreasuryBalanceForLifecycle;
    if (customResolver) {
      return await customResolver(lifecycleId);
    }

    const stakingLedgerServices = this.options.stakingLedgerServices;
    const treasuryOwnerPublicKey = this.options.treasuryOwnerPublicKey;
    if (!stakingLedgerServices || !treasuryOwnerPublicKey) {
      return null;
    }

    let service;
    try {
      service = await stakingLedgerServices.getService(String(lifecycleId));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === LIFECYCLE_DATA_UNAVAILABLE_ERROR
      ) {
        return null;
      }
      throw error;
    }
    const treasuryAccount = await service.getAccountByPublicKey(treasuryOwnerPublicKey);
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
    return balance.toString();
  }
}
