import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import type { EntityManager } from "typeorm";
import { Field } from "o1js";
import {
  ProposalCreatedEvent,
  PROPOSAL_CREATED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { ProposalEntity } from "./proposal-entity.js";

interface DecodedProposalCreatedPayload {
  proposalPublicKey: string;
  lifecycleId: number;
  amount: string;
  recipient: string;
  zkAppUriHash: string;
}

const PROPOSAL_CREATED_FIELD_COUNT = 7;

function getProposalCreatedFieldValues(event: ArchiveEventEntity): string[] | null {
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
  if (data.length === PROPOSAL_CREATED_FIELD_COUNT) {
    return data;
  }
  if (data.length === PROPOSAL_CREATED_FIELD_COUNT + 1) {
    return data.slice(1);
  }
  return null;
}

function decodeProposalCreatedPayload(
  event: ArchiveEventEntity,
): DecodedProposalCreatedPayload | null {
  const fieldValues = getProposalCreatedFieldValues(event);
  if (!fieldValues) {
    return null;
  }

  try {
    const decoded = ProposalCreatedEvent.fromFields(
      fieldValues.map((value) => Field(value)),
    );
    const lifecycleId = Number(decoded.lifecycleId.toBigint());
    if (!Number.isInteger(lifecycleId) || lifecycleId < 0) {
      return null;
    }

    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      lifecycleId,
      amount: decoded.amount.toString(),
      recipient: decoded.recipient.toBase58(),
      zkAppUriHash: decoded.zkAppUriHash.toString(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalCreated event id=${event.id}`,
      error,
    );
    return null;
  }
}

export class ProposalCreatedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_CREATED_EVENT_NAME;

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const proposalRepository = manager.getRepository(ProposalEntity);
    const payload = decodeProposalCreatedPayload(event);
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
      },
      ["proposalPublicKey"],
    );
    return true;
  }
}
