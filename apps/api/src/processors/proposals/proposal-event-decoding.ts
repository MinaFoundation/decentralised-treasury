import type { ArchiveEventEntity } from "@repo/indexer";
import {
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

const PAYLOAD_FIELD_COUNTS: Record<ProposalEventName, number> = {
  [PROPOSAL_CREATED_EVENT_NAME]: 13,
  [PROPOSAL_EXECUTED_EVENT_NAME]: 5,
  [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME]: 5,
  [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME]: 7,
  [PROPOSAL_VOTES_TALLIED_EVENT_NAME]: 9,
};

const LEGACY_STRIPPED_FIELD_COUNTS: Partial<
  Record<ProposalEventName, readonly number[]>
> = {
  [PROPOSAL_EXECUTED_EVENT_NAME]: [7],
};

/**
 * Validate an o1js event discriminator and return only the Struct payload.
 *
 * Old indexer rows can contain an already stripped payload. The exact payload
 * size distinguishes those rows from the current raw archive representation.
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

  const payloadFieldCount = PAYLOAD_FIELD_COUNTS[expectedEventType];
  const legacyFieldCounts =
    LEGACY_STRIPPED_FIELD_COUNTS[expectedEventType] ?? [];
  if (
    data.length === payloadFieldCount ||
    legacyFieldCounts.includes(data.length)
  ) {
    return { kind: "fields", fields: data };
  }
  if (data.length !== payloadFieldCount + 1) {
    return { kind: "invalid" };
  }

  const expectedDiscriminator = PROPOSAL_EVENT_NAMES.indexOf(expectedEventType);
  if (data[0] !== String(expectedDiscriminator)) {
    return { kind: "invalid" };
  }
  return { kind: "fields", fields: data.slice(1) };
}
