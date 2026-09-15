import { Buffer } from "buffer";
import { vi } from "vitest";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";

class TrackedEventTarget extends EventTarget {
  private listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** Replace only the physical device; transport, framing, and MinaApp stay real. */
export function createLedgerHidFixture() {
  const previousHid = Object.getOwnPropertyDescriptor(navigator, "hid");
  const previousSecureContext = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  );
  const device = Object.assign(new TrackedEventTarget(), {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    sendReport: vi.fn(async (_id: number, _data: Uint8Array) => {}),
    vendorId: 0x2c97,
    productId: 0x4011,
  });
  const hid = Object.assign(new TrackedEventTarget(), {
    getDevices: vi.fn(async () => [device]),
    requestDevice: vi.fn(async () => [device]),
  });
  Object.defineProperty(navigator, "hid", { configurable: true, value: hid });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  function disconnect(target: EventTarget = device) {
    const event = new Event("disconnect");
    Object.defineProperty(event, "device", { value: target });
    hid.dispatchEvent(event);
  }
  function replyAddress(address: string) {
    const request = device.sendReport.mock.calls.at(-1)?.[1];
    if (!request)
      throw new Error("The transport has not sent an address request.");
    const channel = Buffer.from(request).readUInt16BE(0);
    const response = Buffer.concat([
      Buffer.from(address),
      Buffer.from("9000", "hex"),
    ]);
    let offset = 0;
    let sequence = 0;
    while (offset < response.length) {
      const report = Buffer.alloc(64);
      report.writeUInt16BE(channel, 0);
      report.writeUInt8(0x05, 2);
      report.writeUInt16BE(sequence, 3);
      const headerLength = sequence === 0 ? 7 : 5;
      if (sequence === 0) report.writeUInt16BE(response.length, 5);
      const length = Math.min(64 - headerLength, response.length - offset);
      response.copy(report, headerLength, offset, offset + length);
      const event = new Event("inputreport");
      Object.defineProperty(event, "data", {
        value: new DataView(
          report.buffer.slice(
            report.byteOffset,
            report.byteOffset + report.byteLength,
          ),
        ),
      });
      device.dispatchEvent(event);
      offset += length;
      sequence++;
    }
  }
  return {
    hid,
    device,
    disconnect,
    replyAddress,
    open: () =>
      TransportWebHID.open(
        device as unknown as Parameters<typeof TransportWebHID.open>[0],
      ),
    restore() {
      disconnect();
      if (previousHid) Object.defineProperty(navigator, "hid", previousHid);
      else Reflect.deleteProperty(navigator, "hid");
      if (previousSecureContext)
        Object.defineProperty(window, "isSecureContext", previousSecureContext);
      else Reflect.deleteProperty(window, "isSecureContext");
    },
  };
}
