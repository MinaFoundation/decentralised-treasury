import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationPackage } from "./operations";

const mocks = vi.hoisted(() => ({
  validateOperation: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
  constructMinaApp: vi.fn(),
  signField: vi.fn(),
  signTransaction: vi.fn(),
}));

// These tests isolate WebHID transport behavior. The review regression uses
// real operation hashing and verifies rejection before the device is called.
vi.mock("./operations", () => ({
  assertOperationMessageHash: mocks.validateOperation,
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
  Transaction: { fromJSON: (value: unknown) => value },
  Field: (value: string) => ({ value }),
  PublicKey: {
    fromBase58: (value: string) => ({ value, toBase58: () => value }),
  },
}));

vi.mock("@repo/sdk/src/signing/ledger-signing.js", () => ({
  signFieldWithLedgerClient: mocks.signField,
  signTransactionWithLedgerClient: mocks.signTransaction,
}));

import { backofficeWalletProviders, signOperationWithLedger } from "./wallets";

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
      expect.any(Function),
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

  it("forwards participant and transaction approval hashes from the actual signing request", async () => {
    const onReview = vi.fn();
    const event = {
      type: "signature-requested",
      accountIndex: 12,
      publicKey: "key-3",
      hash: "12345",
    };
    mocks.signField.mockImplementationOnce(
      async (_field, _ledger, _key, _index, progress) => {
        progress(event);
        return { toBase58: () => "signature" };
      },
    );
    await signOperationWithLedger(operation(), 3, 12, onReview);
    expect(onReview).toHaveBeenLastCalledWith({
      wallet: "ledger",
      accountIndex: 12,
      publicKey: "key-3",
      hash: "0".repeat(60) + "3039",
    });

    mocks.signTransaction.mockImplementationOnce(
      async (_transaction, _ledger, _indices, network, progress) => {
        expect(network).toBe("devnet");
        progress({ ...event, hash: "11259375" });
        return { toJSON: () => "{}" };
      },
    );
    await backofficeWalletProviders[1].signZkapp(
      {
        providerId: "ledger",
        address: "key-3",
        displayName: "Ledger",
        details: [],
        data: { accountIndex: 12 },
      },
      {
        transactionJson: "{}",
        expectedSenderAddress: "key-3",
        networkId: "devnet",
        minaNodeUrl: "/graphql",
        fee: "0.1",
        memo: "",
        onSigningReview: onReview,
      },
    );
    expect(onReview).toHaveBeenLastCalledWith({
      wallet: "ledger",
      accountIndex: 12,
      publicKey: "key-3",
      hash: "0".repeat(58) + "abcdef",
    });
  });
});
