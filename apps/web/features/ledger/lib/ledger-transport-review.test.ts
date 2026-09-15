import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { MinaApp } from "@zondax/ledger-mina-js";
import { createLedgerHidFixture } from "./ledger-hid-test-fixture";

let fixture: ReturnType<typeof createLedgerHidFixture>;
const address = "B62" + "a".repeat(52);
const apdu = Buffer.from("e001000000", "hex");

beforeEach(() => {
  vi.useFakeTimers();
  fixture = createLedgerHidFixture();
});

afterEach(() => {
  fixture.restore();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("REVIEW DEFECT: disconnect settles the pending address request with MinaApp's non-success result", async () => {
  const transport = await fixture.open();
  const response = new MinaApp(transport).getAddress(0, true);
  const result = expect(response).resolves.toMatchObject({
    publicKey: null,
    message: "Unknown transport error",
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.device.sendReport).toHaveBeenCalledOnce();
  fixture.disconnect();
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect((await response).returnCode).not.toBe("9000");
  expect(transport).toHaveProperty("exchangeBusyPromise", null);
  await transport.close();
  expect(fixture.device.close).toHaveBeenCalledOnce();
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});

it("rejects a pending transport read on disconnect", async () => {
  const transport = await fixture.open();
  const result = expect(transport.read()).rejects.toThrow(/disconnect/i);
  fixture.disconnect();
  await result;
  expect(transport.inputCallback).toBeNull();
  await transport.close();
});

it("completes a normal address request and removes listeners on close", async () => {
  const transport = await fixture.open();
  const result = new MinaApp(transport).getAddress(0, true);
  await vi.advanceTimersByTimeAsync(1);
  fixture.replyAddress(address);
  await expect(result).resolves.toEqual({
    publicKey: address,
    returnCode: "9000",
  });
  await transport.close();
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});

it("makes idle close idempotent without a false disconnect event", async () => {
  const transport = await fixture.open();
  const onDisconnect = vi.fn();
  transport.on("disconnect", onDisconnect);
  await Promise.all([transport.close(), transport.close()]);
  fixture.disconnect();
  expect(fixture.device.close).toHaveBeenCalledOnce();
  expect(onDisconnect).not.toHaveBeenCalled();
  await expect(transport.read()).rejects.toThrow(/disconnect/i);
});

it("cancels a pending exchange when close is requested", async () => {
  const transport = await fixture.open();
  const result = expect(transport.exchange(apdu)).rejects.toThrow(
    /disconnect/i,
  );
  await vi.advanceTimersByTimeAsync(1);
  await transport.close();
  await result;
  expect(transport).toHaveProperty("exchangeBusyPromise", null);
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});

it("ignores another device's disconnect", async () => {
  const transport = await fixture.open();
  const result = new MinaApp(transport).getAddress(0, true);
  await vi.advanceTimersByTimeAsync(1);
  fixture.disconnect(new EventTarget());
  expect(fixture.hid.listenerCount("disconnect")).toBe(1);
  fixture.replyAddress(address);
  await expect(result).resolves.toHaveProperty("returnCode", "9000");
  await transport.close();
});

it("cannot start a pending read after disconnect occurred during the write", async () => {
  let releaseWrite: (() => void) | undefined;
  fixture.device.sendReport.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const transport = await fixture.open();
  const result = expect(transport.exchange(apdu)).rejects.toThrow(
    /disconnect/i,
  );
  expect(releaseWrite).toBeDefined();
  fixture.disconnect();
  releaseWrite?.();
  await result;
  await transport.close();
});

it("ignores duplicate disconnect and late input, and prevents new writes", async () => {
  const transport = await fixture.open();
  const onDisconnect = vi.fn();
  transport.on("disconnect", onDisconnect);
  const result = new MinaApp(transport).getAddress(0, true);
  await vi.advanceTimersByTimeAsync(1);
  fixture.disconnect();
  fixture.disconnect();
  fixture.replyAddress(address);
  expect((await result).returnCode).not.toBe("9000");
  await expect(transport.exchange(apdu)).rejects.toThrow(/disconnect/i);
  expect(fixture.device.sendReport).toHaveBeenCalledOnce();
  expect(onDisconnect).toHaveBeenCalledOnce();
  expect(transport.inputs).toEqual([]);
  await transport.close();
});

it("reconnects to the same device through a fresh transport", async () => {
  const first = await fixture.open();
  fixture.disconnect();
  await first.close();
  const second = await fixture.open();
  const result = new MinaApp(second).getAddress(0, true);
  await vi.advanceTimersByTimeAsync(1);
  fixture.replyAddress(address);
  await expect(result).resolves.toHaveProperty("returnCode", "9000");
  await second.close();
  expect(fixture.device.open).toHaveBeenCalledTimes(2);
  expect(fixture.device.close).toHaveBeenCalledTimes(2);
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
});

it("removes listeners after a write failure", async () => {
  fixture.device.sendReport.mockRejectedValue(new Error("write failed"));
  const transport = await fixture.open();
  await expect(transport.exchange(apdu)).rejects.toThrow(/write failed/);
  expect(transport).toHaveProperty("exchangeBusyPromise", null);
  expect(fixture.hid.listenerCount("disconnect")).toBe(0);
  expect(fixture.device.listenerCount("inputreport")).toBe(0);
  await transport.close();
});
