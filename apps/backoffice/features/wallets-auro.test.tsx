import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bool, Field, PrivateKey, Signature, UInt32 } from "o1js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { BackofficeApp } from "./backoffice-app";
import { BackofficeProviders } from "./backoffice-providers";
import {
  downloadJson,
  fetchTreasuryStatus,
  fetchProposalStatus,
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
const prover = vi.hoisted(() => ({ send: vi.fn() }));
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
  useProverWorker: () => ({ status: "idle", send: prover.send }),
}));

vi.mock("./operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations")>()),
  downloadJson: vi.fn(),
  fetchTreasuryStatus: vi.fn(),
  fetchProposalStatus: vi.fn(),
}));

const keys = Array.from({ length: 5 }, () => PrivateKey.random());
const participants = keys.map((key) => key.toPublicKey().toBase58());
const message = MultisigSignature.dataPauseTreasury(UInt32.from(2));
const operation: OperationPackage = {
  schemaVersion: 2,
  kind: "pauseTreasury",
  networkId: "devnet",
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
  controllerNonce: operation.controllerNonce!,
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
  vi.stubEnv(
    "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
    operation.treasuryOwnerAddress,
  );
  vi.stubEnv(
    "NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS",
    participants.join(","),
  );
  vi.mocked(fetchTreasuryStatus).mockResolvedValue(status);
  vi.mocked(fetchProposalStatus).mockResolvedValue({
    value: "1",
    name: "APPROVED",
    tokenId: "1",
    pauseNonce: "0",
  });
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
  vi.unstubAllEnvs();
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
      const nonce = UInt32.from(bundle.controllerNonce!);
      if (kind === "unpauseTreasury") {
        bundle.messageHash =
          MultisigSignature.dataUnpauseTreasury(nonce).toString();
      } else if (kind === "toggleProposal") {
        const proposal = PrivateKey.random().toPublicKey();
        bundle.proposalAddress = proposal.toBase58();
        delete bundle.controllerNonce;
        bundle.proposalTokenId = "1";
        bundle.proposalNonce = "0";
        bundle.proposalPaused = true;
        bundle.proposalStatusBefore = "APPROVED";
        bundle.proposalStatusAfter = "PAUSED";
        bundle.messageHash = MultisigSignature.dataTogglePauseProposal(
          proposal,
          Field(bundle.proposalTokenId),
          UInt32.from(bundle.proposalNonce),
          Bool(bundle.proposalPaused),
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

async function renderSigner(
  address = participants[1]!,
  providerId: "auro" | "ledger" = "auro",
  kind: OperationKind = "pauseTreasury",
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
      <BackofficeApp />
    </BackofficeProviders>,
  );
  await screen.findByRole("tab", { name: "Signer" });
  if (kind !== "pauseTreasury") {
    const labels = {
      unpauseTreasury: "Unpause treasury",
      toggleProposal: "Toggle proposal pause",
      rotateMultisig: "Rotate multisig keys",
    };
    const operationTab = screen.getByRole("tab", { name: labels[kind] });
    fireEvent.mouseDown(operationTab);
    fireEvent.click(operationTab);
  }
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

function proposalBundle(paused = true): OperationPackage {
  const proposal = PrivateKey.random().toPublicKey();
  return {
    ...operation,
    kind: "toggleProposal",
    controllerNonce: undefined,
    proposalAddress: proposal.toBase58(),
    proposalTokenId: "1",
    proposalNonce: "0",
    proposalPaused: paused,
    proposalStatusBefore: paused ? "APPROVED" : "PAUSED",
    proposalStatusAfter: paused ? "PAUSED" : "UNKNOWN",
    messageHash: MultisigSignature.dataTogglePauseProposal(
      proposal,
      Field(1),
      UInt32.from(0),
      Bool(paused),
    ).toString(),
    signatures: Array(5).fill(null),
  };
}

describe("proposal state verification", () => {
  it.each([
    ["0", "UNKNOWN"],
    ["1", "APPROVED"],
    ["2", "REJECTED"],
    ["3", "PAUSED"],
  ])(
    "checks status %s at import and before signing with both wallets",
    async (value, name) => {
      for (const provider of ["auro", "ledger"] as const) {
        const bundle = {
          ...proposalBundle(value !== "3"),
          proposalStatusBefore: name,
        };
        vi.mocked(fetchProposalStatus)
          .mockClear()
          .mockResolvedValue({ value, name, tokenId: "1", pauseNonce: "0" });
        await renderSigner(participants[1], provider, "toggleProposal");
        importBundle(bundle);
        const sign = await screen.findByRole("button", { name: "Sign bundle" });
        const review = within(
          screen.getByRole("region", { name: "Operation review" }),
        );
        expect(review.getByText(name, { exact: true })).toBeVisible();
        expect(
          within(
            review.getByText("Expected status after toggle").parentElement!,
          ).getByText(bundle.proposalStatusAfter!, { exact: true }),
        ).toBeVisible();
        expect(fetchProposalStatus).toHaveBeenCalledTimes(1);
        expect(fetchProposalStatus).toHaveBeenLastCalledWith(
          expect.objectContaining({
            treasuryOwnerAddress: operation.treasuryOwnerAddress,
          }),
          operation.treasuryOwnerAddress,
          bundle.proposalAddress,
        );
        fireEvent.click(sign);
        fireEvent.click(
          await screen.findByRole("button", {
            name: "Export signature contribution",
          }),
        );
        expect(fetchProposalStatus).toHaveBeenCalledTimes(2);
        expect(downloadJson).toHaveBeenLastCalledWith(expect.any(String), {
          ...bundle,
          signatures: [null, expect.any(String), null, null, null],
        });
        cleanup();
      }
    },
  );

  it.each([
    { proposalStatusBefore: undefined },
    { proposalStatusAfter: undefined },
    { proposalPaused: undefined },
    { proposalPaused: "true" },
    { proposalStatusBefore: "PAUSED" },
    { proposalStatusBefore: "FORGED" },
    { proposalStatusAfter: "UNKNOWN" },
    { proposalPaused: false },
  ])(
    "rejects invalid proposal metadata before accepting the bundle: %j",
    async (changes) => {
      await renderSigner(participants[1], "auro", "toggleProposal");
      importBundle({ ...proposalBundle(), ...changes } as OperationPackage);
      expect(
        await screen.findByText(
          /proposal-toggle operation is incomplete|proposal status changed|proposal outcome is inconsistent|operation message hash is invalid/,
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("region", { name: "Operation review" }),
      ).toBeNull();
      expect(signFields).not.toHaveBeenCalled();
      expect(ledger.signFieldElement).not.toHaveBeenCalled();
    },
  );

  it.each(["auro", "ledger"] as const)(
    "stops %s signing if proposal state changes or cannot be fetched",
    async (provider) => {
      await renderSigner(participants[1], provider, "toggleProposal");
      importBundle(proposalBundle());
      await screen.findByRole("button", { name: "Sign bundle" });
      vi.mocked(fetchProposalStatus).mockResolvedValue({
        value: "3",
        name: "PAUSED",
        tokenId: "1",
        pauseNonce: "0",
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
      expect(await screen.findByText(/proposal status changed/)).toBeVisible();
      vi.mocked(fetchProposalStatus).mockRejectedValue(
        new Error("Proposal node unavailable"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
      expect(
        await screen.findByText("Proposal node unavailable"),
      ).toBeVisible();
      expect(signFields).not.toHaveBeenCalled();
      expect(ledger.signFieldElement).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "Export signature contribution" }),
      ).toBeNull();
      expect(
        within(
          screen.getByRole("region", { name: "Operation review" }),
        ).getByText("APPROVED", { exact: true }),
      ).toBeVisible();
    },
  );

  it("rejects an unavailable proposal at import", async () => {
    vi.mocked(fetchProposalStatus).mockRejectedValue(
      new Error("Proposal account was not found"),
    );
    await renderSigner(participants[1], "auro", "toggleProposal");
    importBundle(proposalBundle());
    expect(
      await screen.findByText("Proposal account was not found"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign bundle" })).toBeNull();
  });

  it("rechecks the proposal before starting proof construction", async () => {
    await renderSigner(participants[1], "auro", "toggleProposal");
    const submitter = screen.getByRole("tab", { name: "Submitter" });
    fireEvent.mouseDown(submitter);
    fireEvent.click(submitter);
    const bundle = proposalBundle();
    bundle.signatures = keys.map((key, index) =>
      index < 3
        ? Signature.create(key, [Field(bundle.messageHash)]).toBase58()
        : null,
    );
    importBundle(bundle);
    const submit = await screen.findByRole("button", {
      name: "Prove and submit",
    });
    vi.mocked(fetchProposalStatus).mockResolvedValue({
      value: "3",
      name: "PAUSED",
      tokenId: "1",
      pauseNonce: "0",
    });
    fireEvent.click(submit);
    expect(await screen.findByText(/proposal status changed/)).toBeVisible();
    expect(prover.send).not.toHaveBeenCalled();
  });
});

describe("signer bundle exchange", () => {
  it.each<OperationKind>([
    "pauseTreasury",
    "unpauseTreasury",
    "toggleProposal",
    "rotateMultisig",
  ])("shows the exact target and authorization for %s", async (kind) => {
    const bundle: OperationPackage = {
      ...operation,
      kind,
      signatures: Array(5).fill(null),
    };
    const nonce = UInt32.from(bundle.controllerNonce!);
    if (kind === "unpauseTreasury") {
      vi.mocked(fetchTreasuryStatus).mockResolvedValue({
        ...status,
        paused: true,
      });
      bundle.messageHash =
        MultisigSignature.dataUnpauseTreasury(nonce).toString();
    } else if (kind === "toggleProposal") {
      const proposal = PrivateKey.random().toPublicKey();
      delete bundle.controllerNonce;
      bundle.proposalAddress = proposal.toBase58();
      bundle.proposalTokenId = "1";
      bundle.proposalNonce = "0";
      bundle.proposalPaused = true;
      bundle.messageHash = MultisigSignature.dataTogglePauseProposal(
        proposal,
        Field(bundle.proposalTokenId),
        UInt32.from(bundle.proposalNonce),
        Bool(bundle.proposalPaused),
      ).toString();
      bundle.proposalStatusBefore = "APPROVED";
      bundle.proposalStatusAfter = "PAUSED";
    } else if (kind === "rotateMultisig") {
      const replacements = Array.from({ length: 5 }, () =>
        PrivateKey.random().toPublicKey(),
      );
      bundle.nextParticipants = replacements.map((key) => key.toBase58());
      bundle.nextMultisigCommitment =
        MultisigSignatures.createCommitment(replacements).toString();
      bundle.messageHash = MultisigSignature.dataRotateMultisigKeys(
        Field(bundle.multisigCommitment),
        Field(bundle.nextMultisigCommitment),
        nonce,
      ).toString();
    }
    await renderSigner(participants[1], "auro", kind);
    importBundle(bundle);
    const review = within(
      await screen.findByRole("region", { name: "Operation review" }),
    );
    for (const value of [
      bundle.networkId,
      bundle.treasuryOwnerAddress,
      bundle.pauseControllerAddress,
      ...(bundle.kind === "toggleProposal"
        ? [bundle.proposalTokenId, bundle.proposalNonce]
        : [bundle.controllerNonce]),
      bundle.multisigCommitment,
      bundle.messageHash,
    ]) {
      expect(review.getByText(value!, { exact: true })).toBeVisible();
    }
    if (kind === "toggleProposal") {
      expect(review.getByText(bundle.proposalAddress!)).toBeVisible();
      expect(
        review.getByText(/If the proposal is PAUSED, set it to UNKNOWN/),
      ).toBeVisible();
      expect(review.getByText("APPROVED", { exact: true })).toBeVisible();
      expect(
        within(
          review.getByText("Signed pause target").parentElement!,
        ).getByText("PAUSED", { exact: true }),
      ).toBeVisible();
    }
    if (kind === "rotateMultisig") {
      expect(review.getByText(bundle.nextMultisigCommitment!)).toBeVisible();
      for (const key of [...participants, ...bundle.nextParticipants!]) {
        expect(screen.getByText(key, { exact: true })).toBeVisible();
      }
    } else {
      expect(
        review.getAllByRole("listitem").map((item) => item.textContent),
      ).toEqual(participants);
    }
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign bundle" })).toBeEnabled(),
    );
    expect(signFields).not.toHaveBeenCalled();
  });

  it.each([
    { networkId: "mainnet" },
    { treasuryOwnerAddress: PrivateKey.random().toPublicKey().toBase58() },
    { pauseControllerAddress: PrivateKey.random().toPublicKey().toBase58() },
    { controllerNonce: "3" },
    { multisigCommitment: "1" },
    { participants: [...participants].reverse() },
  ])(
    "rejects a bundle that differs from the configured deployment: %j",
    async (changes) => {
      await renderSigner();
      importBundle({ ...operation, ...changes });
      expect(
        await screen.findByText(/stale or belongs to another deployment/),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "Sign bundle" })).toBeNull();
      expect(signFields).not.toHaveBeenCalled();
      expect(ledger.signFieldElement).not.toHaveBeenCalled();
    },
  );

  it("rejects a rotation hash disguised as a treasury pause", async () => {
    await renderSigner();
    importBundle({
      ...operation,
      messageHash: MultisigSignature.dataRotateMultisigKeys(
        Field(operation.multisigCommitment),
        Field(123),
        UInt32.from(operation.controllerNonce!),
      ).toString(),
    });
    expect(
      await screen.findByText("The operation message hash is invalid."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign bundle" })).toBeNull();
    expect(signFields).not.toHaveBeenCalled();
  });

  it.each(["auro", "ledger"] as const)(
    "checks fresh state before %s signing and permits retry after a node failure",
    async (providerId) => {
      await renderSigner(participants[1], providerId);
      importBundle(operation);
      await screen.findByRole("button", { name: "Sign bundle" });
      vi.mocked(fetchTreasuryStatus).mockRejectedValueOnce(
        new Error("Node unavailable"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
      await waitFor(() =>
        expect(screen.getAllByText("Node unavailable").length).toBeGreaterThan(
          0,
        ),
      );
      expect(signFields).not.toHaveBeenCalled();
      expect(ledger.signFieldElement).not.toHaveBeenCalled();
      vi.mocked(fetchTreasuryStatus).mockResolvedValue({
        ...status,
        controllerNonce: "3",
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
      expect(
        await screen.findByText(/stale or belongs to another deployment/),
      ).toBeVisible();
      expect(signFields).not.toHaveBeenCalled();
      expect(ledger.signFieldElement).not.toHaveBeenCalled();
      // A transient node error must not discard the reviewed bundle.
      vi.mocked(fetchTreasuryStatus).mockResolvedValue(status);
      fireEvent.click(screen.getByRole("button", { name: "Sign bundle" }));
      expect(
        await screen.findByRole("button", {
          name: "Export signature contribution",
        }),
      ).toBeEnabled();
    },
  );

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
      await renderSigner(participants[1], providerId);
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
    await renderSigner(PrivateKey.random().toPublicKey().toBase58());
    importBundle(operation);
    expect(
      await screen.findByRole("button", { name: "Sign bundle" }),
    ).toBeDisabled();
    expect(screen.getByText("Wallet is not a participant")).toBeVisible();
    expect(signFields).not.toHaveBeenCalled();
  });

  it("keeps the imported signatures after wallet rejection and permits another attempt", async () => {
    await renderSigner();
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
    await renderSigner(participants[0]!);
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
    await renderSigner();
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
