import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  requestTransport: vi.fn(),
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: {
    create: mocks.createTransport,
    request: mocks.requestTransport,
  },
}));

vi.mock("@zondax/ledger-mina-js", () => ({
  MinaApp: class {
    getAddress = mocks.getAddress;
  },
}));

vi.mock("o1js", () => ({
  Field: Object.assign((value: unknown) => value, {}),
  PublicKey: {
    fromBase58: (value: string) => ({ toBase58: () => value }),
  },
  Transaction: { fromJSON: vi.fn() },
}));

vi.mock("@repo/sdk/src/signing/ledger-signing.js", () => ({
  signFieldWithLedgerClient: vi.fn(),
  signTransactionWithLedgerClient: mocks.signTransaction,
}));

import {
  connectLedgerAccount,
  signTxWithLedger,
  validateLedgerAccountIndex,
} from "./ledger-signing";

describe("browser Ledger adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "hid", {
      configurable: true,
      value: {},
    });
    mocks.close.mockResolvedValue(undefined);
    mocks.createTransport.mockResolvedValue({ close: mocks.close });
    mocks.requestTransport.mockResolvedValue({ close: mocks.close });
    mocks.getAddress.mockResolvedValue({
      returnCode: "9000",
      publicKey: "B62ledger",
    });
  });

  it("connects the requested index and closes the permission transport", async () => {
    await expect(connectLedgerAccount(12)).resolves.toBe("B62ledger");

    expect(mocks.requestTransport).toHaveBeenCalledOnce();
    expect(mocks.getAddress).toHaveBeenCalledWith(12, true);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("passes only the connected account to transaction signing", async () => {
    const transaction = { toJSON: () => "{}" };
    const signed = { toJSON: () => "signed" };
    mocks.signTransaction.mockResolvedValue(signed);

    await expect(
      signTxWithLedger(transaction, "B62ledger", 7, "devnet"),
    ).resolves.toBe(signed);

    expect(mocks.signTransaction).toHaveBeenCalledWith(
      transaction,
      expect.anything(),
      new Map([["B62ledger", 7]]),
      "devnet",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid indices before opening a device", () => {
    expect(() => validateLedgerAccountIndex(-1)).toThrow(
      /0 through 4294967295/,
    );
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.requestTransport).not.toHaveBeenCalled();
  });
});
