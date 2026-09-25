import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { EventProcessorRouter } from "@repo/processor";
import { AccountUpdate, Field, PrivateKey } from "o1js";
import type { EntityManager } from "typeorm";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalPauseToggledEventHandler } from "../src/processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import {
  getRawProposalEventFields,
  type ProposalEventName,
} from "../src/processors/proposals/proposal-event-decoding.js";

const proposal = PrivateKey.fromBigInt(11n)
  .toPublicKey()
  .toFields()
  .map(String);
const recipient = PrivateKey.fromBigInt(12n)
  .toPublicKey()
  .toFields()
  .map(String);
// Use a real key with an even y-coordinate. Do not depend on a random fixture.
let senderSeed = 1n;
while (PrivateKey.fromBigInt(senderSeed).toPublicKey().isOdd.toBoolean()) {
  senderSeed += 1n;
}
const sender = PrivateKey.fromBigInt(senderSeed)
  .toPublicKey()
  .toFields()
  .map(String);

const shortenedEventCases: Array<{
  type: ProposalEventName;
  discriminator: string;
  payload: string[];
}> = [
  {
    type: "proposalCreated",
    discriminator: "0",
    payload: [
      ...proposal,
      "2",
      "100",
      ...recipient,
      "123",
      "999",
      "1000",
      ...sender,
      ...sender,
    ],
  },
  {
    type: "proposalExecuted",
    discriminator: "1",
    payload: [...proposal, "10", ...sender],
  },
  {
    type: "proposalPauseToggled",
    discriminator: "2",
    payload: [...proposal, "1", ...sender],
  },
  {
    type: "proposalVoteDispatched",
    discriminator: "3",
    payload: [...proposal, ...recipient, "1", ...sender],
  },
  {
    type: "proposalVotesTallied",
    discriminator: "4",
    payload: [...proposal, "2", "60", "25", "0", "1", ...sender],
  },
];

describe("shortened Treasury events", () => {
  for (const { type, discriminator, payload } of shortenedEventCases) {
    it(`preserves the o1js commitment and restores ${type}`, () => {
      const original = [discriminator, ...payload];
      assert.equal(original.length % 2, 0);
      assert.equal(original.at(-1), "0");
      const shortened = original.slice(0, -1);
      const hash = (data: string[]) =>
        AccountUpdate.Events.hash([data.map(Field)]).toString();
      assert.equal(hash(original), hash(shortened));
      assert.notEqual(hash(original), hash(original.slice(0, -2)));
      assert.notEqual(hash([...shortened, "1"]), hash(shortened));

      const update = AccountUpdate.create(
        PrivateKey.fromBigInt(11n).toPublicKey(),
      );
      update.body.events = AccountUpdate.Events.fromList([original.map(Field)]);
      const json = update.toJSON();
      json.body.events = [shortened];
      assert.equal(
        AccountUpdate.fromJSON(json).hash().toString(),
        update.hash().toString(),
      );

      const event = Object.assign(new ArchiveEventEntity(), {
        eventType: type,
        rawEventData: { data: shortened },
      });
      assert.deepEqual(getRawProposalEventFields(event, type), {
        kind: "fields",
        fields: payload,
      });
      assert.deepEqual(event.rawEventData.data, shortened);
    });

    it(`routes complete and shortened ${type} to identical facts`, async () => {
      const facts: unknown[] = [];
      const reconciler = new ProposalProjectionReconciler();
      reconciler.recordAndReconcile = async (_event, eventType, decoded) => {
        facts.push({ eventType, decoded });
      };
      const router = new EventProcessorRouter([
        new ProposalCreatedEventHandler({}, reconciler),
        new ProposalExecutedEventHandler(reconciler),
        new ProposalPauseToggledEventHandler(reconciler),
        new ProposalVoteDispatchedEventHandler(
          undefined,
          undefined,
          {},
          reconciler,
        ),
        new ProposalVotesTalliedEventHandler(reconciler),
      ]);
      const manager = {
        getRepository: () => ({ findOneBy: async () => null }),
      } as unknown as EntityManager;
      for (const eventType of [type, "unknown"]) {
        for (const data of [
          [discriminator, ...payload],
          [discriminator, ...payload.slice(0, -1)],
        ]) {
          const event = Object.assign(new ArchiveEventEntity(), {
            eventType,
            rawEventData: { data },
          });
          assert.deepEqual(await router.dispatch(event, manager), {
            handled: true,
            resolvedEventType: type,
          });
        }
      }
      assert.equal(facts.length, 4);
      for (const fact of facts) assert.deepEqual(fact, facts[0]);

      const shortened = [discriminator, ...payload.slice(0, -1)];
      const invalidParity = [...shortened];
      invalidParity[2] = "2";
      const invalidField = [...shortened];
      invalidField[1] = "-1";
      for (const data of [
        shortened.slice(0, -1),
        [discriminator, ...payload, "0"],
        ["99", ...shortened.slice(1)],
        invalidParity,
        invalidField,
      ]) {
        const event = Object.assign(new ArchiveEventEntity(), {
          eventType: type,
          rawEventData: { data },
        });
        assert.deepEqual(await router.dispatch(event, manager), {
          handled: false,
          resolvedEventType: null,
        });
      }
      assert.equal(facts.length, 4);
    });
  }
});
