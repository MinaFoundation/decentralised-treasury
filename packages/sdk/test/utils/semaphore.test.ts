import { it } from "node:test";
import assert from "node:assert";
import { Semaphore } from "../../src/utils/concurrency.js";

it("never lets more than `limit` holders through at once", async () => {
  const semaphore = new Semaphore(3);
  let active = 0;
  let maxActive = 0;

  const holders = Array.from({ length: 20 }, () =>
    (async () => {
      await semaphore.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      semaphore.release();
    })(),
  );

  await Promise.all(holders);

  assert.strictEqual(maxActive <= 3, true, `max concurrent was ${maxActive}`);
});

it("releases a slot to the next waiter in order", async () => {
  const semaphore = new Semaphore(1);
  const order: number[] = [];

  await semaphore.acquire();

  const waiter1 = semaphore.acquire().then(() => order.push(1));
  const waiter2 = semaphore.acquire().then(() => order.push(2));

  // Nothing should have run yet - the semaphore is held.
  assert.deepStrictEqual(order, []);

  semaphore.release();
  await waiter1;
  semaphore.release();
  await waiter2;

  assert.deepStrictEqual(order, [1, 2]);
});

it("rejects a concurrency limit below 1", () => {
  assert.throws(() => new Semaphore(0), /concurrency limit/);
});
