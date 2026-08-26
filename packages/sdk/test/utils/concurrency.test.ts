import { it } from "node:test";
import assert from "node:assert";
import { forEachWithConcurrency } from "../../src/utils/concurrency.js";

it("never runs more than `limit` workers at once", async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  let active = 0;
  let maxActive = 0;
  const seen: number[] = [];

  await forEachWithConcurrency(items, 5, async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    // Yield a few times so overlapping workers actually overlap instead of
    // resolving synchronously in enqueue order.
    await new Promise((resolve) => setTimeout(resolve, 1));
    seen.push(item);
    active--;
  });

  assert.strictEqual(maxActive <= 5, true, `max concurrent was ${maxActive}`);
  assert.deepStrictEqual(seen.slice().sort((a, b) => a - b), items);
});

it("pulls a lazy async source no further than the concurrency limit allows", async () => {
  let pulled = 0;
  let maxPulledAheadOfCompleted = 0;
  let completed = 0;

  async function* source() {
    for (let i = 0; i < 20; i++) {
      pulled++;
      maxPulledAheadOfCompleted = Math.max(
        maxPulledAheadOfCompleted,
        pulled - completed,
      );
      yield i;
    }
  }

  await forEachWithConcurrency(source(), 4, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    completed++;
  });

  // The generator is only ever allowed to run 1 item ahead of what's
  // in-flight (the item it just yielded, before its worker is started) on
  // top of the concurrency limit itself.
  assert.strictEqual(
    maxPulledAheadOfCompleted <= 5,
    true,
    `source ran ${maxPulledAheadOfCompleted} items ahead of completion, limit was 4`,
  );
});

it("propagates a worker's rejection", async () => {
  const items = [1, 2, 3];

  await assert.rejects(
    forEachWithConcurrency(items, 2, async (item) => {
      if (item === 2) {
        throw new Error("boom");
      }
    }),
    /boom/,
  );
});

it("rejects a concurrency limit below 1", async () => {
  await assert.rejects(
    forEachWithConcurrency([1], 0, async () => {}),
    /concurrency limit/,
  );
});
