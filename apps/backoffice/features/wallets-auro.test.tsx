import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field, PrivateKey, Signature, UInt32 } from "o1js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { BackofficeApp } from "./backoffice-app";
import { BackofficeProviders } from "./backoffice-providers";
import {
  downloadJson,
  type OperationKind,
  type OperationPackage,
  type TreasuryStatus,
} from "./operations";
import { signOperationWithAuro } from "./wallets";

const ledger = vi.hoisted(() => ({
  getAddress: vi.fn(),
  signFieldElement: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: { create: async () => ({ close: ledger.close }) },
}));
vi.mock("@zondax/ledger-mina-js", () => ({
  MinaApp: class {
    getAddress = ledger.getAddress;
    signFieldElement = ledger.signFieldElement;
  },
}));

vi.mock("./use-prover-worker", () => ({
  useProverWorker: () => ({ status: "idle", send: vi.fn() }),
}));

vi.mock("./operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations")>()),
  downloadJson: vi.fn(),
}));

const keys = Array.from({ length: 5 }, () => PrivateKey.random());
const participants = keys.map((key) => key.toPublicKey().toBase58());
const message = MultisigSignature.dataPauseTreasury(UInt32.from(2));
const operation: OperationPackage = {
  schemaVersion: 1,
  kind: "pauseTreasury",
  networkId: "testnet",
  treasuryOwnerAddress: PrivateKey.random().toPublicKey().toBase58(),
  pauseControllerAddress: PrivateKey.random().toPublicKey().toBase58(),
  controllerNonce: "2",
  multisigCommitment: MultisigSignatures.createCommitment(
    keys.map((key) => key.toPublicKey()),
  ).toString(),
  participants,
  messageHash: message.toString(),
  signatures: [
    Signature.create(keys[0]!, [message]).toBase58(),
    null,
    null,
    null,
    null,
  ],
  createdAt: "2026-09-17T00:00:00.000Z",
};
const status: TreasuryStatus = {
  networkId: operation.networkId,
  treasuryOwnerAddress: operation.treasuryOwnerAddress,
  pauseControllerAddress: operation.pauseControllerAddress,
  treasuryBalance: "1000000000",
  paused: false,
  controllerNonce: operation.controllerNonce,
  onChainCommitment: operation.multisigCommitment,
  configuredCommitment: operation.multisigCommitment,
  participantCommitmentMatches: true,
  participants,
};
const signFields = vi.fn(
  async ({ message: fields }: { message: string[] }) => ({
    signature: Signature.create(
      keys[1]!,
      fields.map((field) => Field(field)),
    ).toBase58(),
    publicKey: participants[1]!,
  }),
);
const requestAccounts = vi.fn(async () => [participants[1]!]);

beforeEach(() => {
  vi.clearAllMocks();
  window.mina = { requestAccounts, signFields };
  ledger.getAddress.mockResolvedValue({
    returnCode: "9000",
    publicKey: participants[1],
  });
  ledger.signFieldElement.mockImplementation(
    async (_index, _network, bytes: Uint8Array) => {
      const field = Field(
        bytes.reduceRight((n, byte) => (n << 8n) + BigInt(byte), 0n),
      );
      const signature = Signature.create(keys[1]!, [field]).toJSON();
      return { returnCode: "9000", field: signature.r, scalar: signature.s };
    },
  );
});
afterEach(() => {
  cleanup();
  delete window.mina;
});

describe("Auro participant signatures", () => {
  it.each<OperationKind>([
    "pauseTreasury",
    "unpauseTreasury",
    "toggleProposal",
    "rotateMultisig",
  ])(
    "signs the exact %s hash and verifies the result with o1js",
    async (kind) => {
      const bundle = { ...operation, kind, signatures: Array(5).fill(null) };
      const nonce = UInt32.from(bundle.controllerNonce);
      if (kind === "unpauseTreasury") {
        bundle.messageHash =
          MultisigSignature.dataUnpauseTreasury(nonce).toString();
      } else if (kind === "toggleProposal") {
        const proposal = PrivateKey.random().toPublicKey();
        bundle.proposalAddress = proposal.toBase58();
        bundle.messageHash = MultisigSignature.dataTogglePauseProposal(
          proposal,
          nonce,
        ).toString();
      } else if (kind === "rotateMultisig") {
        const nextKeys = Array.from({ length: 5 }, () =>
          PrivateKey.random().toPublicKey(),
        );
        bundle.nextParticipants = nextKeys.map((key) => key.toBase58());
        bundle.nextMultisigCommitment =
          MultisigSignatures.createCommitment(nextKeys).toString();
        bundle.messageHash = MultisigSignature.dataRotateMultisigKeys(
          Field(bundle.multisigCommitment),
          Field(bundle.nextMultisigCommitment),
          nonce,
        ).toString();
      }
      const result = await signOperationWithAuro(bundle, 1);
      expect(signFields).toHaveBeenCalledWith({
        message: [bundle.messageHash],
      });
      expect(
        Signature.fromBase58(result)
          .verify(keys[1]!.toPublicKey(), [Field(bundle.messageHash)])
          .toBoolean(),
      ).toBe(true);
    },
  );

  it("rejects a returned public key that differs from the participant", async () => {
    signFields.mockResolvedValueOnce({
      publicKey: participants[2]!,
      signature: Signature.create(keys[1]!, [message]).toBase58(),
    });
    await expect(signOperationWithAuro(operation, 1)).rejects.toThrow(
      /another participant/,
    );
  });

  it.each([undefined, "malformed-signature"])(
    "rejects a missing or malformed signature (%s)",
    async (signature) => {
      window.mina!.signFields = vi.fn(async () => ({ signature }));
      await expect(signOperationWithAuro(operation, 1)).rejects.toThrow();
    },
  );

  it("rejects a misleading operation before it requests wallet approval", async () => {
    await expect(
      signOperationWithAuro({ ...operation, kind: "unpauseTreasury" }, 1),
    ).rejects.toThrow(/message hash is invalid/);
    expect(signFields).not.toHaveBeenCalled();
  });

  it("rejects an account change before it requests a signature", async () => {
    requestAccounts.mockResolvedValueOnce([participants[2]!]);
    await expect(signOperationWithAuro(operation, 1)).rejects.toThrow(
      /Auro is using/,
    );
    expect(signFields).not.toHaveBeenCalled();
  });

  it.each(["wrong key", "wrong message"])(
    "rejects a signature with the %s",
    async (failure) => {
      signFields.mockResolvedValueOnce({
        publicKey: participants[1]!,
        signature: Signature.create(
          failure === "wrong key" ? keys[2]! : keys[1]!,
          [failure === "wrong message" ? Field(1) : message],
        ).toBase58(),
      });
      await expect(signOperationWithAuro(operation, 1)).rejects.toThrow(
        /does not match/,
      );
    },
  );

  it("reports unsupported wallets and wallet rejection", async () => {
    window.mina = { requestAccounts };
    await expect(signOperationWithAuro(operation, 1)).rejects.toThrow(
      /does not support field signing/,
    );
    window.mina.signFields = vi.fn(async () => ({
      code: 1002,
      message: "User rejected the request.",
    }));
    await expect(signOperationWithAuro(operation, 1)).rejects.toThrow(
      "User rejected the request.",
    );
  });
});

function renderSigner(
  address = participants[1]!,
  providerId: "auro" | "ledger" = "auro",
) {
  render(
    <BackofficeProviders
      persistSession={false}
      initialSession={{
        providerId,
        address,
        displayName: providerId === "auro" ? "Auro" : "Ledger",
        details: [],
        data: providerId === "ledger" ? { accountIndex: 7 } : undefined,
      }}
    >
      <BackofficeApp
        preview={{ status, loading: false, activeOperation: "pauseTreasury" }}
      />
    </BackofficeProviders>,
  );
  const signerTab = screen.getByRole("tab", { name: "Signer" });
  fireEvent.mouseDown(signerTab);
  fireEvent.click(signerTab);
}

function importBundle(bundle: OperationPackage) {
  const file = new File([], "bundle.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify(bundle),
  });
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
}

describe("signer bundle exchange", () => {
  it.each([
    ["auro", 0],
    ["auro", 1],
    ["auro", 3],
    ["ledger", 0],
    ["ledger", 1],
    ["ledger", 3],
  ] as const)(
    "adds a %s signature and preserves %i imported signatures",
    async (providerId, count) => {
      const bundle = {
        ...operation,
        signatures: Array<string | null>(5).fill(null),
      };
      for (const index of [0, 2, 4].slice(0, count)) {
        bundle.signatures[index] = Signature.create(keys[index]!, [
          message,
        ]).toBase58();
      }
      renderSigner(participants[1], providerId);
      importBundle(bundle);
      const signButton = await screen.findByRole("button", {
        name: "Sign bundle",
      });
      expect(signButton).toBeEnabled();
      expect(screen.queryByText("Ledger required")).toBeNull();
      fireEvent.click(signButton);
      const exportButton = await screen.findByRole("button", {
        name: "Export signature contribution",
      });
      fireEvent.click(exportButton);
      const exported = vi.mocked(downloadJson).mock
        .calls[0]![1] as OperationPackage;
      expect(exported).toEqual({
        ...bundle,
        signatures: [
          bundle.signatures[0],
          expect.any(String),
          ...bundle.signatures.slice(2),
        ],
      });
      expect(
        Signature.fromBase58(exported.signatures[1]!)
          .verify(keys[1]!.toPublicKey(), [message])
          .toBoolean(),
      ).toBe(true);
      if (providerId === "auro") {
        expect(signFields).toHaveBeenCalledOnce();
        expect(ledger.signFieldElement).not.toHaveBeenCalled();
      } else {
        expect(signFields).not.toHaveBeenCalled();
        expect(ledger.signFieldElement).toHaveBeenCalledWith(
          7,
          expect.anything(),
          expect.any(Uint8Array),
        );
        expect(ledger.close).toHaveBeenCalledOnce();
      }
    },
  );

  it("blocks signing when the connected wallet is not a participant", async () => {
    renderSigner(PrivateKey.random().toPublicKey().toBase58());
    importBundle(operation);
    expect(
      await screen.findByRole("button", { name: "Sign bundle" }),
    ).toBeDisabled();
    expect(screen.getByText("Wallet is not a participant")).toBeVisible();
    expect(signFields).not.toHaveBeenCalled();
  });

  it("keeps the imported signatures after wallet rejection and permits another attempt", async () => {
    renderSigner();
    importBundle(operation);
    signFields.mockRejectedValueOnce(new Error("User rejected the request."));
    fireEvent.click(await screen.findByRole("button", { name: "Sign bundle" }));
    expect(await screen.findByText("User rejected the request.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Export signature contribution" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Export signature contribution",
      }),
    );
    const exported = vi.mocked(downloadJson).mock
      .calls[0]![1] as OperationPackage;
    expect(exported.signatures[0]).toBe(operation.signatures[0]);
    expect(exported.signatures[1]).toEqual(expect.any(String));
  });

  it("exports an existing signature for the connected participant without signing again", async () => {
    renderSigner(participants[0]!);
    importBundle(operation);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Export signature contribution",
      }),
    );
    expect(downloadJson).toHaveBeenCalledWith(expect.any(String), operation);
    expect(screen.queryByRole("button", { name: "Sign bundle" })).toBeNull();
    expect(signFields).not.toHaveBeenCalled();
  });

  it("rejects an invalid imported signature", async () => {
    renderSigner();
    importBundle({
      ...operation,
      signatures: ["invalid", null, null, null, null],
    });
    await waitFor(() =>
      expect(
        screen.getByText("The signature for participant 1 is invalid."),
      ).toBeVisible(),
    );
    expect(screen.queryByRole("button", { name: "Sign bundle" })).toBeNull();
    expect(signFields).not.toHaveBeenCalled();
  });
});
