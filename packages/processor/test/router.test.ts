import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import type { EntityManager } from "typeorm";
import {
  EventProcessorRouter,
  type EventProcessorHandler,
} from "../src/index.js";

function eventWithType(eventType: string): ArchiveEventEntity {
  return Object.assign(new ArchiveEventEntity(), { eventType });
}

function handler(
  eventType: string,
  calls: string[],
  result: boolean | Error,
): EventProcessorHandler {
  return {
    eventType,
    async tryHandle() {
      calls.push(eventType);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
}

describe("EventProcessorRouter", () => {
  const manager = {} as EntityManager;

  it("stops after the typed handler accepts the event", async () => {
    const calls: string[] = [];
    const router = new EventProcessorRouter([
      handler("typed", calls, true),
      handler("fallback", calls, true),
    ]);

    assert.deepEqual(await router.dispatch(eventWithType("typed"), manager), {
      handled: true,
      resolvedEventType: "typed",
    });
    assert.deepEqual(calls, ["typed"]);
  });

  it("uses the next handler after the typed handler declines", async () => {
    const calls: string[] = [];
    const router = new EventProcessorRouter([
      handler("typed", calls, false),
      handler("fallback", calls, true),
      handler("unused", calls, true),
    ]);

    assert.deepEqual(await router.dispatch(eventWithType("typed"), manager), {
      handled: true,
      resolvedEventType: "fallback",
    });
    assert.deepEqual(calls, ["typed", "fallback"]);
  });

  it("reports an unhandled event after every applicable handler declines", async () => {
    const calls: string[] = [];
    const router = new EventProcessorRouter([
      handler("typed", calls, false),
      handler("fallback", calls, false),
    ]);

    assert.deepEqual(await router.dispatch(eventWithType("typed"), manager), {
      handled: false,
      resolvedEventType: null,
    });
    assert.deepEqual(calls, ["typed", "fallback"]);
  });

  it("propagates a typed handler error without calling later handlers", async () => {
    const calls: string[] = [];
    const expectedError = new Error("typed handler failed");
    const router = new EventProcessorRouter([
      handler("typed", calls, expectedError),
      handler("fallback", calls, true),
    ]);

    await assert.rejects(
      router.dispatch(eventWithType("typed"), manager),
      (error: unknown) => error === expectedError,
    );
    assert.deepEqual(calls, ["typed"]);
  });
});
