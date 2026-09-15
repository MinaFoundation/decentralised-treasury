import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Mina } from "o1js";
import { connectLedgerAccount, signTxWithLedger } from "./ledger-signing";
import { createLedgerHidFixture } from "./ledger-hid-test-fixture";

let fixture: ReturnType<typeof createLedgerHidFixture>;
let address: string;
let transaction: { toJSON(): string };

beforeAll(async () => {
  // Build a valid unsigned command only. This unit fixture submits no transaction.
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const account = local.testAccounts[0]!;
  address = account.toBase58();
  transaction = await Mina.transaction(
    { sender: account, fee: "100000000" },
    async () => {},
  );
});

beforeEach(() => {
  vi.useFakeTimers();
  fixture = createLedgerHidFixture();
});

afterEach(() => {
  fixture.restore();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function waitForDeviceRequest() {
  await vi.waitFor(() => expect(fixture.device.sendReport).toHaveBeenCalled(), {
    timeout: 2_000,
    interval: 10,
  });
}

it("rejects a disconnected Ledger connection, closes the transport, and permits reconnection", async () => {
  const result = expect(connectLedgerAccount(0)).rejects.toThrow(
    "Ledger address request failed: Unknown transport error",
  );
  await waitForDeviceRequest();
  fixture.disconnect();
  await result;
  expect(fixture.device.close).toHaveBeenCalledOnce();
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);

  fixture.device.sendReport.mockClear();
  const reconnected = connectLedgerAccount(0);
  await waitForDeviceRequest();
  fixture.replyAddress(address);
  await expect(reconnected).resolves.toBe(address);
  expect(fixture.device.open).toHaveBeenCalledTimes(2);
  expect(fixture.device.close).toHaveBeenCalledTimes(2);
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});

it("rejects a Ledger signing request before submission and leaves the command unchanged", async () => {
  const original = transaction.toJSON();
  const submit = vi.fn();
  const result = expect(
    signTxWithLedger(transaction, address, 0, "devnet").then(submit),
  ).rejects.toThrow("Ledger address request failed: Unknown transport error");
  await waitForDeviceRequest();
  fixture.disconnect();
  await result;
  expect(submit).not.toHaveBeenCalled();
  expect(transaction.toJSON()).toBe(original);
  expect(fixture.device.close).toHaveBeenCalledOnce();
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});
