import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import type { EntityManager } from "typeorm";
import { ProposalEntity } from "./proposal-entity.js";

const PROPOSAL_PAUSE_TOGGLED_EVENT_NAME = "proposalPauseToggled";

interface DecodedProposalPauseToggledPayload {
  proposalPublicKey: string;
  paused: boolean;
  senderPublicKey: string | null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return null;
}

function decodeArchiveProvidedPayload(
  event: ArchiveEventEntity,
): DecodedProposalPauseToggledPayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    paused?: unknown;
    senderPublicKey?: unknown;
  };
  const paused = asBoolean(candidate.paused);
  if (typeof candidate.proposalPublicKey !== "string" || paused === null) {
    return null;
  }
  return {
    proposalPublicKey: candidate.proposalPublicKey,
    paused,
    senderPublicKey: typeof candidate.senderPublicKey === "string" ? candidate.senderPublicKey : null,
  };
}

async function decodeProposalPauseToggledPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalPauseToggledPayload | null> {
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
    event.eventType !== PROPOSAL_PAUSE_TOGGLED_EVENT_NAME
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
    const ProposalPauseToggledEvent = (
      proposalEventsModule as {
        ProposalPauseToggledEvent: {
          fromFields(values: unknown[]): {
            proposalPublicKey: { toBase58(): string };
            paused: { toBoolean(): boolean };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalPauseToggledEvent;
    const decoded = ProposalPauseToggledEvent.fromFields(
      data.map((value) => Field(value)),
    );

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      paused: decoded.paused.toBoolean(),
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalPauseToggled event id=${event.id}`,
      error,
    );
    return null;
  }
}

export class ProposalPauseToggledEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_PAUSE_TOGGLED_EVENT_NAME;

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalPauseToggledPayload(event);
    if (!payload) {
      return false;
    }

    const proposalRepository = manager.getRepository(ProposalEntity);
    await proposalRepository.update(
      { proposalPublicKey: payload.proposalPublicKey },
      {
        isPaused: event.status === "orphaned" ? !payload.paused : payload.paused,
      },
    );
    return true;
  }
}
