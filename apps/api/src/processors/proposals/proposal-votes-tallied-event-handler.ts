import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { PROPOSAL_VOTES_TALLIED_EVENT_NAME } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { EntityManager } from "typeorm";
import {
  defaultProposalProjectionReconciler,
  ProposalProjectionReconciler,
} from "./proposal-projection-reconciler.js";
import {
  parseContractFieldArray,
  parseContractPublicKey,
  parseContractUInt32,
  parseContractUInt64,
} from "./proposal-contract-domain.js";
import { getRawProposalEventFields } from "./proposal-event-decoding.js";
import type { VoteTallyVoteResult } from "./vote-tally-entity.js";

interface DecodedProposalVotesTalliedPayload {
  proposalPublicKey: string;
  lifecycleId: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  voteResult: VoteTallyVoteResult;
  senderPublicKey: string | null;
}

function toVoteResult(value: bigint): VoteTallyVoteResult | null {
  if (value === 1n) {
    return "approved";
  }
  if (value === 2n) {
    return "rejected";
  }
  return null;
}

function decodeArchiveProvidedPayload(
  event: ArchiveEventEntity,
): DecodedProposalVotesTalliedPayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    lifecycleId?: unknown;
    yayWeight?: unknown;
    nayWeight?: unknown;
    abstainWeight?: unknown;
    voteResult?: unknown;
    senderPublicKey?: unknown;
  };
  const proposalPublicKey = parseContractPublicKey(candidate.proposalPublicKey);
  const lifecycleId = parseContractUInt32(candidate.lifecycleId);
  const yayWeight = parseContractUInt64(candidate.yayWeight);
  const nayWeight = parseContractUInt64(candidate.nayWeight);
  const abstainWeight = parseContractUInt64(candidate.abstainWeight);
  const senderPublicKey =
    candidate.senderPublicKey === null ||
    candidate.senderPublicKey === undefined
      ? null
      : parseContractPublicKey(candidate.senderPublicKey);
  if (
    proposalPublicKey === null ||
    lifecycleId === null ||
    yayWeight === null ||
    nayWeight === null ||
    abstainWeight === null ||
    typeof candidate.voteResult !== "string" ||
    (candidate.senderPublicKey != null && senderPublicKey === null)
  ) {
    return null;
  }
  const voteResult = candidate.voteResult.trim().toLowerCase();
  if (voteResult !== "approved" && voteResult !== "rejected") {
    return null;
  }
  return {
    proposalPublicKey,
    lifecycleId,
    yayWeight,
    nayWeight,
    abstainWeight,
    voteResult,
    senderPublicKey,
  };
}

async function decodeProposalVotesTalliedPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalVotesTalliedPayload | null> {
  const rawFields = getRawProposalEventFields(
    event,
    PROPOSAL_VOTES_TALLIED_EVENT_NAME,
  );
  if (rawFields.kind === "absent") {
    return decodeArchiveProvidedPayload(event);
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
    const ProposalVotesTalliedEvent = (
      proposalEventsModule as {
        ProposalVotesTalliedEvent: {
          fromFields(values: unknown[]): {
            proposalPublicKey: { toBase58(): string };
            lifecycleId: { toBigint(): bigint };
            yayWeight: { toString(): string };
            nayWeight: { toString(): string };
            abstainWeight: { toString(): string };
            voteResult: { toBigInt(): bigint };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalVotesTalliedEvent;
    const decoded = ProposalVotesTalliedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    PublicKey.check(decoded.proposalPublicKey);
    PublicKey.check(decoded.senderPublicKey);
    // o1js `fromFields()` does not apply UInt range checks off-circuit.
    const lifecycleId = parseContractUInt32(
      decoded.lifecycleId.toBigint().toString(),
    );
    const yayWeight = parseContractUInt64(decoded.yayWeight.toString());
    const nayWeight = parseContractUInt64(decoded.nayWeight.toString());
    const abstainWeight = parseContractUInt64(decoded.abstainWeight.toString());
    if (
      lifecycleId === null ||
      yayWeight === null ||
      nayWeight === null ||
      abstainWeight === null
    ) {
      return null;
    }
    const voteResult = toVoteResult(decoded.voteResult.toBigInt());
    if (!voteResult) {
      return null;
    }

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      lifecycleId,
      yayWeight,
      nayWeight,
      abstainWeight,
      voteResult,
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalVotesTallied event id=${event.id}`,
      error,
    );
    return null;
  }
}

export class ProposalVotesTalliedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_VOTES_TALLIED_EVENT_NAME;

  public constructor(
    private readonly reconciler: ProposalProjectionReconciler = defaultProposalProjectionReconciler,
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalVotesTalliedPayload(event);
    if (!payload) {
      return false;
    }

    await this.reconciler.recordAndReconcile(
      event,
      PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      { ...payload },
      manager,
    );
    return true;
  }
}
