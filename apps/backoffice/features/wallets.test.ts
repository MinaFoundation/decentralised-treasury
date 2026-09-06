import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationPackage } from "./operations";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  constructMinaApp: vi.fn(),
  signField: vi.fn(),
}));

vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: { create: mocks.createTransport },
}));

vi.mock("@zondax/ledger-mina-js", () => ({
  MinaApp: class {
    constructor(transport: unknown) {
      mocks.constructMinaApp(transport);
    }
  },
}));

vi.mock("o1js", () => ({
  Field: (value: string) => ({ value }),
  PublicKey: {
    fromBase58: (value: string) => ({ value, toBase58: () => value }),
  },
}));

vi.mock("@repo/sdk/src/signing/ledger-signing.js", () => ({
  signFieldWithLedgerClient: mocks.signField,
}));

import { signOperationWithLedger } from "./wallets";

function operation(): OperationPackage {
  return {
    schemaVersion: 1,
    kind: "pauseTreasury",
    networkId: "testnet",
    treasuryOwnerAddress: "owner",
    pauseControllerAddress: "controller",
    controllerNonce: "9",
    multisigCommitment: "10",
    participants: ["key-0", "key-1", "key-2", "key-3", "key-4"],
    messageHash: "12345",
    signatures: [null, null, null, null, null],
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("Ledger browser signing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockResolvedValue({ close: mocks.close });
    mocks.close.mockResolvedValue(undefined);
    mocks.signField.mockResolvedValue({ toBase58: () => "ledger-signature" });
  });

  it("signs the operation hash for the selected ordered participant", async () => {
    await expect(signOperationWithLedger(operation(), 3, 12)).resolves.toBe(
      "ledger-signature",
    );

    expect(mocks.createTransport).toHaveBeenCalledOnce();
    expect(mocks.constructMinaApp).toHaveBeenCalledOnce();
    expect(mocks.signField).toHaveBeenCalledWith(
      { value: "12345" },
      expect.anything(),
      expect.objectContaining({ value: "key-3" }),
      12,
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("closes WebHID transport when the Ledger rejects the key or signature", async () => {
    mocks.signField.mockRejectedValueOnce(
      new Error("The Ledger public key does not match participant 2."),
    );

    await expect(signOperationWithLedger(operation(), 2, 8)).rejects.toThrow(
      /does not match participant 2/,
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
