import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import {
  getRawProposalEventFields,
  type ProposalEventName,
} from "../src/processors/proposals/proposal-event-decoding.js";

describe("proposal event discriminator decoding", () => {
  // o1js assigns event discriminators from the lexical order of the declared
  // event names. Keep the expected values fixed so this test cannot repeat a
  // sorting defect in the decoder.
  const eventTypes: Array<[ProposalEventName, number, string]> = [
    [PROPOSAL_CREATED_EVENT_NAME, 13, "0"],
    [PROPOSAL_EXECUTED_EVENT_NAME, 5, "1"],
    [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME, 5, "2"],
    [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME, 7, "3"],
    [PROPOSAL_VOTES_TALLIED_EVENT_NAME, 9, "4"],
  ];

  it("validates and removes the o1js discriminator for all proposal events", () => {
    for (const [expectedEventType, fieldCount, discriminator] of eventTypes) {
      const archiveEvent = new ArchiveEventEntity();
      archiveEvent.eventType = expectedEventType;
      archiveEvent.rawEventData = {
        data: [
          discriminator,
          ...Array.from({ length: fieldCount }, (_, index) =>
            String(index + 1),
          ),
        ],
        proposalPublicKey: "must-not-take-precedence-over-raw-data",
      } as never;
      assert.deepEqual(
        getRawProposalEventFields(archiveEvent, expectedEventType),
        {
          kind: "fields",
          fields: Array.from({ length: fieldCount }, (_, index) =>
            String(index + 1),
          ),
        },
      );

      archiveEvent.rawEventData = {
        data: ["99", ...Array.from({ length: fieldCount }, () => "0")],
        proposalPublicKey: "must-not-be-used-as-a-fallback",
      } as never;
      assert.deepEqual(
        getRawProposalEventFields(archiveEvent, expectedEventType),
        {
          kind: "invalid",
        },
      );
    }
  });

  it("rejects wrong event types, widths, and non-string fields", () => {
    for (const [expectedEventType, fieldCount, discriminator] of eventTypes) {
      const archiveEvent = new ArchiveEventEntity();
      archiveEvent.eventType = expectedEventType;

      for (const data of [
        [discriminator, ...Array.from({ length: fieldCount - 2 }, () => "0")],
        [discriminator, ...Array.from({ length: fieldCount + 2 }, () => "0")],
        [
          discriminator,
          1,
          ...Array.from({ length: fieldCount - 1 }, () => "0"),
        ],
      ]) {
        archiveEvent.rawEventData = { data } as never;
        assert.deepEqual(
          getRawProposalEventFields(archiveEvent, expectedEventType),
          { kind: "invalid" },
        );
      }

      archiveEvent.eventType = eventTypes.find(
        ([eventType]) => eventType !== expectedEventType,
      )![0];
      archiveEvent.rawEventData = {
        data: [discriminator, ...Array.from({ length: fieldCount }, () => "0")],
      } as never;
      assert.deepEqual(
        getRawProposalEventFields(archiveEvent, expectedEventType),
        { kind: "invalid" },
      );

      archiveEvent.eventType = expectedEventType;
      archiveEvent.rawEventData = {} as never;
      assert.deepEqual(
        getRawProposalEventFields(archiveEvent, expectedEventType),
        { kind: "absent" },
      );
    }
  });

  it("keeps the explicit stripped-payload compatibility boundary", () => {
    for (const [expectedEventType, fieldCount] of eventTypes) {
      const archiveEvent = new ArchiveEventEntity();
      archiveEvent.eventType = expectedEventType;
      archiveEvent.rawEventData = {
        data: Array.from({ length: fieldCount }, (_, index) => String(index)),
      } as never;

      assert.deepEqual(
        getRawProposalEventFields(archiveEvent, expectedEventType),
        {
          kind: "fields",
          fields: Array.from({ length: fieldCount }, (_, index) =>
            String(index),
          ),
        },
      );
    }

    const legacyExecuted = new ArchiveEventEntity();
    legacyExecuted.eventType = PROPOSAL_EXECUTED_EVENT_NAME;
    legacyExecuted.rawEventData = {
      data: Array.from({ length: 7 }, (_, index) => String(index)),
    } as never;
    assert.deepEqual(
      getRawProposalEventFields(legacyExecuted, PROPOSAL_EXECUTED_EVENT_NAME),
      {
        kind: "fields",
        fields: Array.from({ length: 7 }, (_, index) => String(index)),
      },
    );
  });
});
