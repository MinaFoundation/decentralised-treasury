import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import type { EntityManager } from "typeorm";
import { ProposalEntity } from "./proposal-entity.js";
import { VoteTallyEntity, type VoteTallyVoteResult } from "./vote-tally-entity.js";

const PROPOSAL_VOTES_TALLIED_EVENT_NAME = "proposalVotesTallied";

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
  const lifecycleId = parseLifecycleId(candidate.lifecycleId);
  if (
    typeof candidate.proposalPublicKey !== "string" ||
    lifecycleId === null ||
    typeof candidate.yayWeight !== "string" ||
    typeof candidate.nayWeight !== "string" ||
    typeof candidate.abstainWeight !== "string" ||
    typeof candidate.voteResult !== "string"
  ) {
    return null;
  }
  const voteResult = candidate.voteResult.trim().toLowerCase();
  if (voteResult !== "approved" && voteResult !== "rejected") {
    return null;
  }
  return {
    proposalPublicKey: candidate.proposalPublicKey,
    lifecycleId,
    yayWeight: candidate.yayWeight,
    nayWeight: candidate.nayWeight,
    abstainWeight: candidate.abstainWeight,
    voteResult,
    senderPublicKey: typeof candidate.senderPublicKey === "string" ? candidate.senderPublicKey : null,
  };
}

async function decodeProposalVotesTalliedPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalVotesTalliedPayload | null> {
  const archiveProvidedPayload = decodeArchiveProvidedPayload(event);
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
    event.eventType !== PROPOSAL_VOTES_TALLIED_EVENT_NAME
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
    const lifecycleId = Number(decoded.lifecycleId.toBigint());
    if (!Number.isInteger(lifecycleId) || lifecycleId < 0) {
      return null;
    }
    const voteResult = toVoteResult(decoded.voteResult.toBigInt());
    if (!voteResult) {
      return null;
    }

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      lifecycleId,
      yayWeight: decoded.yayWeight.toString(),
      nayWeight: decoded.nayWeight.toString(),
      abstainWeight: decoded.abstainWeight.toString(),
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

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalVotesTalliedPayload(event);
    if (!payload) {
      return false;
    }

    const proposalRepository = manager.getRepository(ProposalEntity);
    const tallyRepository = manager.getRepository(VoteTallyEntity);
    const blockHeight = event.blockHeight;
    if (typeof blockHeight !== "number") {
      throw new Error(
        `[proposal-processor] proposalVotesTallied event id=${event.id} is missing blockHeight`,
      );
    }

    if (event.status === "orphaned") {
      await tallyRepository.delete({
        proposalPublicKey: payload.proposalPublicKey,
        blockHeight,
      });
      return true;
    }

    const proposal = await proposalRepository.findOneBy({
      proposalPublicKey: payload.proposalPublicKey,
    });
    const totalParticipatingVotes = (
      BigInt(payload.yayWeight) +
      BigInt(payload.nayWeight) +
      BigInt(payload.abstainWeight)
    ).toString();
    const totalApprovalVotes =
      BigInt(payload.yayWeight) + BigInt(payload.nayWeight);
    const approvalBp =
      totalApprovalVotes > 0n
        ? (BigInt(payload.yayWeight) * 10_000n / totalApprovalVotes).toString()
        : "0";

    await tallyRepository.upsert(
      {
        proposalPublicKey: payload.proposalPublicKey,
        blockHeight,
        yayWeight: payload.yayWeight,
        nayWeight: payload.nayWeight,
        abstainWeight: payload.abstainWeight,
        requiredParticipationBp: proposal?.requiredParticipationBp ?? null,
        requiredApprovalBp: proposal?.requiredApprovalBp ?? null,
        requiredParticipation: proposal?.requiredParticipation ?? null,
        totalParticipatingVotes,
        approvalBp,
        voteResult: payload.voteResult,
        createdByEventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      },
      ["proposalPublicKey", "blockHeight"],
    );
    return true;
  }
}
