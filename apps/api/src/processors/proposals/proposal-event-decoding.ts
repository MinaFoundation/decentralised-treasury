import type { ArchiveEventEntity } from "@repo/indexer";
import {
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  ProposalPauseToggledEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";

export type ProposalEventName =
  | typeof PROPOSAL_CREATED_EVENT_NAME
  | typeof PROPOSAL_EXECUTED_EVENT_NAME
  | typeof PROPOSAL_PAUSE_TOGGLED_EVENT_NAME
  | typeof PROPOSAL_VOTE_DISPATCHED_EVENT_NAME
  | typeof PROPOSAL_VOTES_TALLIED_EVENT_NAME;

type RawProposalEventFieldsResult =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "fields"; fields: string[] };

const PROPOSAL_EVENT_NAMES: ProposalEventName[] = [
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
].sort();

const EVENT_SCHEMAS = {
  [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
  [PROPOSAL_EXECUTED_EVENT_NAME]: ProposalExecutedEvent,
  [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME]: ProposalPauseToggledEvent,
  [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME]: ProposalVoteDispatchedEvent,
  [PROPOSAL_VOTES_TALLIED_EVENT_NAME]: ProposalVotesTalliedEvent,
};

/**
 * Validate an o1js event discriminator and return only the Struct payload.
 *
 * Select the current schema by discriminator before checking its width.
 * Mina's event commitment permits omission of the last zero from an even-width
 * event. Restore only that field; never interpret a short event as legacy data.
 */
export function getRawProposalEventFields(
  event: ArchiveEventEntity,
  expectedEventType: ProposalEventName,
): RawProposalEventFieldsResult {
  if (
    event.eventType &&
    event.eventType !== "unknown" &&
    event.eventType !== expectedEventType
  ) {
    return { kind: "invalid" };
  }

  if (!("data" in event.rawEventData)) {
    return { kind: "absent" };
  }
  const data = event.rawEventData.data;
  if (!Array.isArray(data) || data.some((value) => typeof value !== "string")) {
    return { kind: "invalid" };
  }

  const expectedDiscriminator = PROPOSAL_EVENT_NAMES.indexOf(expectedEventType);
  if (data[0] !== String(expectedDiscriminator)) {
    return { kind: "invalid" };
  }
  const rawFieldCount = EVENT_SCHEMAS[expectedEventType].sizeInFields() + 1;
  if (data.length === rawFieldCount) {
    return { kind: "fields", fields: data.slice(1) };
  }
  if (rawFieldCount % 2 === 0 && data.length === rawFieldCount - 1) {
    return { kind: "fields", fields: [...data.slice(1), "0"] };
  }
  return { kind: "invalid" };
}
