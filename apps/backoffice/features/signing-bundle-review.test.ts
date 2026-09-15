import { expect, it, vi } from "vitest";
import { Field, PrivateKey, Signature, UInt32 } from "o1js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  assertOperationPackage,
  assertPureSigningOperation,
} from "./operations";
import { signOperationWithLedger } from "./wallets";

const device = vi.hoisted(() => ({
  getAddress: vi.fn(),
  signFieldElement: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: { create: async () => ({ close: device.close }) },
}));
vi.mock("@zondax/ledger-mina-js", () => ({
  MinaApp: class {
    getAddress = device.getAddress;
    signFieldElement = device.signFieldElement;
  },
}));

it("REVIEW DEFECT: a bundle labelled pause must not obtain a valid unpause signature", async () => {
  const keys = Array.from({ length: 5 }, () => PrivateKey.random());
  const participants = keys.map((key) => key.toPublicKey());
  const unpause = MultisigSignature.dataUnpauseTreasury(UInt32.from(9));
  const operation = assertPureSigningOperation(
    assertOperationPackage({
      schemaVersion: 1,
      kind: "pauseTreasury",
      networkId: "devnet",
      treasuryOwnerAddress: PrivateKey.random().toPublicKey().toBase58(),
      pauseControllerAddress: PrivateKey.random().toPublicKey().toBase58(),
      controllerNonce: "9",
      multisigCommitment:
        MultisigSignatures.createCommitment(participants).toString(),
      participants: participants.map((key) => key.toBase58()),
      messageHash: unpause.toString(),
      signatures: Array(5).fill(null),
      createdAt: "2026-09-14T00:00:00.000Z",
    }),
  );
  device.getAddress.mockResolvedValue({
    returnCode: "9000",
    publicKey: participants[0]!.toBase58(),
  });
  device.signFieldElement.mockImplementation(
    async (_index, _network, bytes: Uint8Array) => {
      const field = Field(
        bytes.reduceRight((n, b) => (n << 8n) + BigInt(b), 0n),
      );
      const signature = Signature.create(keys[0]!, [field]).toJSON();
      return { returnCode: "9000", field: signature.r, scalar: signature.s };
    },
  );
  await expect(signOperationWithLedger(operation, 0, 0)).rejects.toThrow(
    "The operation message hash is invalid.",
  );
  expect(device.signFieldElement).not.toHaveBeenCalled();
});
