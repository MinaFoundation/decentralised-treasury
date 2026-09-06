import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { PROPOSAL_PAUSE_TOGGLED_EVENT_NAME } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { EntityManager } from "typeorm";
import {
  defaultProposalProjectionReconciler,
  ProposalProjectionReconciler,
} from "./proposal-projection-reconciler.js";
import {
  parseContractBool,
  parseContractFieldArray,
  parseContractPublicKey,
} from "./proposal-contract-domain.js";
import { getRawProposalEventFields } from "./proposal-event-decoding.js";

interface DecodedProposalPauseToggledPayload {
  proposalPublicKey: string;
  paused: boolean;
  senderPublicKey: string | null;
}

function decodeArchiveProvidedPayload(
  event: ArchiveEventEntity,
): DecodedProposalPauseToggledPayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    paused?: unknown;
    senderPublicKey?: unknown;
  };
  const proposalPublicKey = parseContractPublicKey(candidate.proposalPublicKey);
  const paused = parseContractBool(candidate.paused);
  const senderPublicKey =
    candidate.senderPublicKey === null ||
    candidate.senderPublicKey === undefined
      ? null
      : parseContractPublicKey(candidate.senderPublicKey);
  if (
    proposalPublicKey === null ||
    paused === null ||
    (candidate.senderPublicKey != null && senderPublicKey === null)
  ) {
    return null;
  }
  return {
    proposalPublicKey,
    paused,
    senderPublicKey,
  };
}

async function decodeProposalPauseToggledPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalPauseToggledPayload | null> {
  const rawFields = getRawProposalEventFields(
    event,
    PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
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
    const ProposalPauseToggledEvent = (
      proposalEventsModule as {
        ProposalPauseToggledEvent: {
          fromFields(values: unknown[]): {
            proposalPublicKey: { toBase58(): string };
            paused: {
              toBoolean(): boolean;
              toField(): { toString(): string };
            };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalPauseToggledEvent;
    const decoded = ProposalPauseToggledEvent.fromFields(
      data.map((value) => Field(value)),
    );
    PublicKey.check(decoded.proposalPublicKey);
    PublicKey.check(decoded.senderPublicKey);
    // Bool.fromFields() accepts a non-Boolean Field off-circuit. Reject it.
    const pausedField = decoded.paused.toField().toString();
    if (pausedField !== "0" && pausedField !== "1") {
      return null;
    }

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

  public constructor(
    private readonly reconciler: ProposalProjectionReconciler = defaultProposalProjectionReconciler,
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalPauseToggledPayload(event);
    if (!payload) {
      return false;
    }

    await this.reconciler.recordAndReconcile(
      event,
      PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      { ...payload },
      manager,
    );
    return true;
  }
}
