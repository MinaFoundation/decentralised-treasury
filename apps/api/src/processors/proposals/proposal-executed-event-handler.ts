import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { PROPOSAL_EXECUTED_EVENT_NAME } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import type { EntityManager } from "typeorm";
import {
  defaultProposalProjectionReconciler,
  ProposalProjectionReconciler,
} from "./proposal-projection-reconciler.js";
import {
  parseContractFieldArray,
  parseContractPublicKey,
  parseContractUInt64,
} from "./proposal-contract-domain.js";
import { getRawProposalEventFields } from "./proposal-event-decoding.js";

interface DecodedProposalExecutedPayload {
  proposalPublicKey: string;
  recipient?: string;
  amountToPayOut: string;
  senderPublicKey: string;
}

function decodeArchiveProvidedPayload(
  event: ArchiveEventEntity,
): DecodedProposalExecutedPayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    recipient?: unknown;
    amountToPayOut?: unknown;
    senderPublicKey?: unknown;
  };
  const proposalPublicKey = parseContractPublicKey(candidate.proposalPublicKey);
  const recipient =
    candidate.recipient === undefined
      ? undefined
      : parseContractPublicKey(candidate.recipient);
  const amountToPayOut = parseContractUInt64(candidate.amountToPayOut);
  const senderPublicKey = parseContractPublicKey(candidate.senderPublicKey);
  if (
    proposalPublicKey === null ||
    recipient === null ||
    amountToPayOut === null ||
    senderPublicKey === null
  ) {
    return null;
  }

  return {
    proposalPublicKey,
    ...(recipient === undefined ? {} : { recipient }),
    amountToPayOut,
    senderPublicKey,
  };
}

async function decodeProposalExecutedPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalExecutedPayload | null> {
  const rawFields = getRawProposalEventFields(
    event,
    PROPOSAL_EXECUTED_EVENT_NAME,
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
    const { Field, PublicKey, UInt64 } = o1jsModule as {
      Field: (value: string) => unknown;
      PublicKey: {
        fromFields(values: unknown[]): { toBase58(): string };
        check(value: unknown): void;
      };
      UInt64: {
        fromFields(values: unknown[]): { toString(): string };
      };
    };
    if (data.length === 7) {
      const proposalPublicKey = PublicKey.fromFields(
        data.slice(0, 2).map((value) => Field(value)),
      );
      const recipient = PublicKey.fromFields(
        data.slice(2, 4).map((value) => Field(value)),
      );
      const senderPublicKey = PublicKey.fromFields(
        data.slice(5, 7).map((value) => Field(value)),
      );
      PublicKey.check(proposalPublicKey);
      PublicKey.check(recipient);
      PublicKey.check(senderPublicKey);
      const amountToPayOut = parseContractUInt64(
        UInt64.fromFields([Field(data[4])]).toString(),
      );
      if (amountToPayOut === null) {
        return null;
      }
      return {
        proposalPublicKey: proposalPublicKey.toBase58(),
        recipient: recipient.toBase58(),
        amountToPayOut,
        senderPublicKey: senderPublicKey.toBase58(),
      };
    }
    const ProposalExecutedEvent = (
      proposalEventsModule as {
        ProposalExecutedEvent: {
          fromFields(values: unknown[]): {
            proposalPublicKey: { toBase58(): string };
            amountToPayOut: { toString(): string };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalExecutedEvent;
    const decoded = ProposalExecutedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    PublicKey.check(decoded.proposalPublicKey);
    PublicKey.check(decoded.senderPublicKey);
    // o1js `fromFields()` does not apply UInt range checks off-circuit.
    const amountToPayOut = parseContractUInt64(
      decoded.amountToPayOut.toString(),
    );
    if (amountToPayOut === null) {
      return null;
    }
    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      amountToPayOut,
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalExecuted event id=${event.id}`,
      error,
    );
    return null;
  }
}

export class ProposalExecutedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_EXECUTED_EVENT_NAME;

  public constructor(
    private readonly reconciler: ProposalProjectionReconciler = defaultProposalProjectionReconciler,
  ) {}

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalExecutedPayload(event);
    if (!payload) {
      return false;
    }

    await this.reconciler.recordAndReconcile(
      event,
      PROPOSAL_EXECUTED_EVENT_NAME,
      { ...payload },
      manager,
    );
    return true;
  }
}
