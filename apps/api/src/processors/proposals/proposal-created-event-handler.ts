import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { PROPOSAL_CREATED_EVENT_NAME } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { EntityManager } from "typeorm";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  type StakingLedgerServiceLookup,
} from "../../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import {
  defaultProposalProjectionReconciler,
  ProposalProjectionReconciler,
} from "./proposal-projection-reconciler.js";
import { ProposalEventFactEntity } from "./proposal-event-fact-entity.js";
import {
  parseContractField,
  parseContractFieldArray,
  parseContractPublicKey,
  parseContractUInt128,
  parseContractUInt32,
  parseContractUInt64,
} from "./proposal-contract-domain.js";
import { getRawProposalEventFields } from "./proposal-event-decoding.js";
import { getDefaultTokenTreasuryAccount } from "./default-token-treasury-account.js";

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
  deriveAcceptanceCriteria?: (input: {
    proposalAmount: string;
    stakingEpochDataLedgerTotalCurrency: string | null;
    treasuryBalance: string | null;
  }) => Promise<{
    requiredParticipationBp: string | null;
    requiredApprovalBp: string | null;
    requiredParticipation: string | null;
  }>;
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

let acceptanceCriteriaComputationModulesPromise: Promise<AcceptanceCriteriaComputationModules> | null =
  null;

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
      UInt64: (
        o1jsModule as { UInt64: AcceptanceCriteriaComputationModules["UInt64"] }
      ).UInt64,
      UInt128: (
        o1jsModule as {
          UInt128: AcceptanceCriteriaComputationModules["UInt128"];
        }
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
  getTreasuryBalanceForLifecycle: (
    lifecycleId: number,
    stakingEpochDataLedgerHash: string | null,
  ) => Promise<string | null>,
  calculateAcceptanceCriteria: (input: {
    proposalAmount: string;
    stakingEpochDataLedgerTotalCurrency: string | null;
    treasuryBalance: string | null;
  }) => Promise<{
    requiredParticipationBp: string | null;
    requiredApprovalBp: string | null;
    requiredParticipation: string | null;
  }>,
): Promise<DecodedProposalCreatedPayload | null> {
  const rawFields = getRawProposalEventFields(
    event,
    PROPOSAL_CREATED_EVENT_NAME,
  );
  if (rawFields.kind === "absent") {
    const archiveProvidedPayload = decodeArchiveProvidedProposalPayload(event);
    if (!archiveProvidedPayload) {
      return null;
    }
    const treasuryBalance = await getTreasuryBalanceForLifecycle(
      archiveProvidedPayload.lifecycleId,
      archiveProvidedPayload.stakingEpochDataLedgerHash,
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
            proposerPublicKey: { toBase58(): string };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalCreatedEvent;
    const decoded = ProposalCreatedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    PublicKey.check(decoded.proposalPublicKey);
    PublicKey.check(decoded.recipient);
    PublicKey.check(decoded.proposerPublicKey);
    PublicKey.check(decoded.senderPublicKey);
    if (
      decoded.proposerPublicKey.toBase58() !==
      decoded.senderPublicKey.toBase58()
    ) {
      return null;
    }
    // o1js `fromFields()` reconstructs values but does not run the UInt range
    // checks outside a circuit. Validate the decoded values explicitly before
    // they become durable processor facts.
    const lifecycleId = parseContractUInt32(
      decoded.lifecycleId.toBigint().toString(),
    );
    const amount = parseContractUInt64(decoded.amount.toString());
    const stakingEpochDataLedgerTotalCurrency = parseContractUInt64(
      decoded.stakingEpochDataLedgerTotalCurrency.toString(),
    );
    if (
      lifecycleId === null ||
      amount === null ||
      stakingEpochDataLedgerTotalCurrency === null
    ) {
      return null;
    }

    const stakingEpochDataLedgerHash =
      decoded.stakingEpochDataLedgerHash.toString();
    const treasuryBalance = await getTreasuryBalanceForLifecycle(
      lifecycleId,
      stakingEpochDataLedgerHash,
    );
    const acceptanceCriteria = await calculateAcceptanceCriteria({
      proposalAmount: amount,
      stakingEpochDataLedgerTotalCurrency,
      treasuryBalance,
    });

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      lifecycleId,
      amount,
      recipient: decoded.recipient.toBase58(),
      zkAppUriHash: decoded.zkAppUriHash.toString(),
      stakingEpochDataLedgerHash,
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
    proposerPublicKey?: unknown;
    senderPublicKey?: unknown;
  };
  const lifecycleId = parseContractUInt32(candidate.lifecycleId);
  const proposalPublicKey = parseContractPublicKey(candidate.proposalPublicKey);
  const amount = parseContractUInt64(candidate.amount);
  const recipient = parseContractPublicKey(candidate.recipient);
  const zkAppUriHash = parseContractField(candidate.zkAppUriHash);
  const stakingEpochDataLedgerHash =
    candidate.stakingEpochDataLedgerHash === null ||
    candidate.stakingEpochDataLedgerHash === undefined
      ? null
      : parseContractField(candidate.stakingEpochDataLedgerHash);
  const stakingEpochDataLedgerTotalCurrency =
    candidate.stakingEpochDataLedgerTotalCurrency === null ||
    candidate.stakingEpochDataLedgerTotalCurrency === undefined
      ? null
      : parseContractUInt64(candidate.stakingEpochDataLedgerTotalCurrency);
  const requiredParticipationBp =
    candidate.requiredParticipationBp === null ||
    candidate.requiredParticipationBp === undefined
      ? null
      : parseContractUInt128(candidate.requiredParticipationBp);
  const requiredApprovalBp =
    candidate.requiredApprovalBp === null ||
    candidate.requiredApprovalBp === undefined
      ? null
      : parseContractUInt128(candidate.requiredApprovalBp);
  const requiredParticipation =
    candidate.requiredParticipation === null ||
    candidate.requiredParticipation === undefined
      ? null
      : parseContractUInt128(candidate.requiredParticipation);
  const senderPublicKey =
    candidate.senderPublicKey === null ||
    candidate.senderPublicKey === undefined
      ? null
      : parseContractPublicKey(candidate.senderPublicKey);
  const proposerPublicKey =
    candidate.proposerPublicKey === null ||
    candidate.proposerPublicKey === undefined
      ? null
      : parseContractPublicKey(candidate.proposerPublicKey);
  if (
    proposalPublicKey === null ||
    lifecycleId === null ||
    amount === null ||
    recipient === null ||
    zkAppUriHash === null ||
    (candidate.stakingEpochDataLedgerHash != null &&
      stakingEpochDataLedgerHash === null) ||
    (candidate.stakingEpochDataLedgerTotalCurrency != null &&
      stakingEpochDataLedgerTotalCurrency === null) ||
    (candidate.requiredParticipationBp != null &&
      requiredParticipationBp === null) ||
    (candidate.requiredApprovalBp != null && requiredApprovalBp === null) ||
    (candidate.requiredParticipation != null &&
      requiredParticipation === null) ||
    (candidate.proposerPublicKey != null && proposerPublicKey === null) ||
    (candidate.senderPublicKey != null && senderPublicKey === null) ||
    (proposerPublicKey !== null &&
      senderPublicKey !== null &&
      proposerPublicKey !== senderPublicKey)
  ) {
    return null;
  }

  return {
    proposalPublicKey,
    lifecycleId,
    amount,
    recipient,
    zkAppUriHash,
    stakingEpochDataLedgerHash,
    stakingEpochDataLedgerTotalCurrency,
    requiredParticipationBp,
    requiredApprovalBp,
    requiredParticipation,
    senderPublicKey,
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

  const proposalAmountValue = parseContractUInt64(input.proposalAmount);
  const stakingTotalValue = parseContractUInt64(
    input.stakingEpochDataLedgerTotalCurrency,
  );
  const treasuryBalanceValue = parseContractUInt64(input.treasuryBalance);
  if (
    proposalAmountValue === null ||
    stakingTotalValue === null ||
    treasuryBalanceValue === null ||
    treasuryBalanceValue === "0"
  ) {
    return {
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
    };
  }
  const proposalAmount = BigInt(proposalAmountValue);
  const stakingEpochDataLedgerTotalCurrency = BigInt(stakingTotalValue);
  const treasuryBalance = BigInt(treasuryBalanceValue);

  const modules = await getAcceptanceCriteriaComputationModules();
  const criteria =
    modules.TreasuryProposalSmartContract.calculateAcceptanceCriteria(
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
    private readonly reconciler: ProposalProjectionReconciler = defaultProposalProjectionReconciler,
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const previousFact = await manager
      .getRepository(ProposalEventFactEntity)
      .findOneBy({ archiveEventId: event.id });
    const previousCreationPayload =
      previousFact?.eventType === PROPOSAL_CREATED_EVENT_NAME
        ? (previousFact.decodedPayload as unknown as DecodedProposalCreatedPayload)
        : null;
    const previousPayloadHasDerivedCriteria =
      previousCreationPayload !== null &&
      previousCreationPayload.requiredParticipationBp !== null &&
      previousCreationPayload.requiredApprovalBp !== null &&
      previousCreationPayload.requiredParticipation !== null;
    const canReusePreviousPayload =
      previousCreationPayload !== null &&
      (event.status === "orphaned" ||
        previousFact?.status !== "orphaned" ||
        previousPayloadHasDerivedCriteria);
    const deriveCriteria = event.status !== "orphaned";
    const payload =
      (canReusePreviousPayload ? previousCreationPayload : null) ??
      (await decodeProposalCreatedPayload(
        event,
        deriveCriteria
          ? async (lifecycleId, stakingEpochDataLedgerHash) =>
              await this.getTreasuryBalanceForLifecycle(
                lifecycleId,
                stakingEpochDataLedgerHash,
              )
          : async () => null,
        deriveCriteria
          ? (this.options.deriveAcceptanceCriteria ?? deriveAcceptanceCriteria)
          : async () => ({
              requiredParticipationBp: null,
              requiredApprovalBp: null,
              requiredParticipation: null,
            }),
      ));
    if (!payload) {
      return false;
    }

    await this.reconciler.recordAndReconcile(
      event,
      PROPOSAL_CREATED_EVENT_NAME,
      { ...payload },
      manager,
    );
    return true;
  }

  private async getTreasuryBalanceForLifecycle(
    lifecycleId: number,
    expectedStakingLedgerRoot: string | null,
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
    if (!expectedStakingLedgerRoot) {
      throw new Error(
        `[proposal-processor] proposal creation is missing staking ledger root for lifecycleId=${lifecycleId}`,
      );
    }
    const localStakingLedgerRoot = (await service.getRootHash()).toString();
    if (localStakingLedgerRoot !== expectedStakingLedgerRoot) {
      throw new Error(
        `[proposal-processor] staking ledger root mismatch for lifecycleId=${lifecycleId}: expected=${expectedStakingLedgerRoot} actual=${localStakingLedgerRoot}`,
      );
    }
    let treasuryAccount: Awaited<
      ReturnType<typeof getDefaultTokenTreasuryAccount>
    >;
    try {
      treasuryAccount = await getDefaultTokenTreasuryAccount(
        service,
        treasuryOwnerPublicKey,
        lifecycleId,
        expectedStakingLedgerRoot,
      );
    } catch (error) {
      const missingDefaultTokenAccountMessage = `[proposal-processor] expected exactly one default-token treasury account in staking ledger for lifecycleId=${lifecycleId} publicKey=${treasuryOwnerPublicKey}; found=0`;
      if (
        error instanceof Error &&
        error.message === missingDefaultTokenAccountMessage &&
        (await service.getAccountByPublicKey(treasuryOwnerPublicKey)) === null
      ) {
        console.warn(
          `[proposal-processor] treasury account missing in staking ledger for lifecycleId=${lifecycleId} publicKey=${treasuryOwnerPublicKey}`,
        );
        return null;
      }
      throw error;
    }
    const balance = treasuryAccount.balance;
    return balance.toString();
  }
}
