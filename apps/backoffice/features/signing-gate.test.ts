import { expect, it } from "vitest";
import { createSigningGate } from "../e2e/utils/held-auro-wallet";

it("holds the exact request until release without changing it", async () => {
  const gate = createSigningGate();
  const held = gate.hold();
  const request = Object.freeze({
    transaction: "unchanged proved transaction",
    onlySign: true,
  });
  let completed = false;
  const pending = gate.intercept(request).then(() => {
    completed = true;
  });
  expect(await held.entered).toBe(request);
  expect(completed).toBe(false);
  expect(() => gate.hold()).toThrow(/already held/);
  held.release();
  held.release();
  await pending;
  expect(completed).toBe(true);
  await expect(gate.intercept(request)).resolves.toBeUndefined();
});

it("can release an unused hold and create the next independent gate", async () => {
  const gate = createSigningGate();
  gate.hold().release();
  const held = gate.hold();
  const request = { transaction: "next" };
  const pending = gate.intercept(request);
  expect(await held.entered).toBe(request);
  held.release();
  await pending;
});

it("cancels a waiting request without releasing it to the signer", async () => {
  const gate = createSigningGate();
  const held = gate.hold();
  const result = expect(
    gate.intercept({ transaction: "proved" }),
  ).rejects.toThrow(/cancelled/);
  await held.entered;
  held.cancel();
  await result;
  gate.hold().cancel();
});
