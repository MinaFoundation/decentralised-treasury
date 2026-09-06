import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "@repo/ui/wallet-provider";
import { BackofficeApp, type BackofficePreviewState } from "./backoffice-app";
import { BackofficeProviders } from "./backoffice-providers";
import type { OperationPackage, TreasuryStatus } from "./operations";

const participants = ["key-1", "key-2", "key-3", "key-4", "key-5"];

const status: TreasuryStatus = {
  networkId: "testnet",
  treasuryOwnerAddress: "owner",
  pauseControllerAddress: "controller",
  treasuryBalance: "1000000000",
  paused: false,
  controllerNonce: "2",
  onChainCommitment: "10",
  configuredCommitment: "10",
  participantCommitmentMatches: true,
  participants,
  blockHeight: 100,
};

const operation: OperationPackage = {
  schemaVersion: 1,
  kind: "pauseTreasury",
  networkId: "testnet",
  treasuryOwnerAddress: "owner",
  pauseControllerAddress: "controller",
  controllerNonce: "2",
  multisigCommitment: "10",
  participants,
  messageHash: "20",
  signatures: [null, null, null, null, null],
  createdAt: "2026-09-03T00:00:00.000Z",
};

const ledgerSession: ProviderSession = {
  providerId: "ledger",
  address: participants[0]!,
  displayName: "Ledger",
  details: [{ label: "Account index", value: "3" }],
  data: { accountIndex: 3 },
};

const auroSession: ProviderSession = {
  providerId: "auro",
  address: "fee-payer",
  displayName: "Auro",
  details: [],
};

function renderPreview(
  preview: BackofficePreviewState,
  initialSession: ProviderSession | null = null,
) {
  render(
    <BackofficeProviders initialSession={initialSession} persistSession={false}>
      <BackofficeApp preview={preview} />
    </BackofficeProviders>,
  );
}

function expectLoadingButton(name: string) {
  const button = screen.getByRole("button", { name });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveClass("w-full");
  expect(button.querySelector(".animate-spin")).not.toBeNull();
}

describe("backoffice action button loading states", () => {
  afterEach(cleanup);

  it("shows progress on the bundle import button", () => {
    renderPreview({
      status,
      activeOperation: "pauseTreasury",
      dialog: {
        workflowRole: "signer",
        busy: "Importing signing bundle",
        pendingAction: "import",
      },
    });

    expectLoadingButton("Importing signing bundle");
  });

  it("shows progress on the bundle build button", () => {
    renderPreview({
      status,
      activeOperation: "pauseTreasury",
      dialog: {
        busy: "Building signing bundle",
        pendingAction: "prepare",
      },
    });

    expectLoadingButton("Building signing bundle");
  });

  it("shows progress on the signature merge button", () => {
    renderPreview({
      status,
      activeOperation: "pauseTreasury",
      dialog: {
        operation,
        busy: "Merging signature contribution",
        pendingAction: "import",
      },
    });

    expectLoadingButton("Merging signature contribution");
  });

  it("shows progress on the Ledger signing button", () => {
    renderPreview(
      {
        status,
        activeOperation: "pauseTreasury",
        dialog: {
          operation,
          workflowRole: "signer",
          busy: "Waiting for Ledger participant 1",
          pendingAction: "sign",
        },
      },
      ledgerSession,
    );

    expectLoadingButton("Waiting for Ledger participant 1");
  });

  it("shows each submission stage on the submit button", () => {
    renderPreview(
      {
        status,
        activeOperation: "pauseTreasury",
        dialog: {
          operation: {
            ...operation,
            signatures: ["one", "two", "three", null, null],
          },
          validSignatures: [true, true, true, false, false],
          busy: "Building proof",
          pendingAction: "submit",
        },
      },
      auroSession,
    );

    expectLoadingButton("Building proof");
  });
});

describe("backoffice wallet actions", () => {
  afterEach(cleanup);

  it("uses the signer primary action to connect a wallet", () => {
    renderPreview({
      status,
      activeOperation: "pauseTreasury",
      dialog: {
        operation,
        workflowRole: "signer",
      },
    });

    const button = screen.getByRole("button", { name: "Connect wallet" });
    expect(button).toBeEnabled();
    expect(button).toHaveClass("w-full");
    expect(
      document.querySelector('[data-component="wallet-connect-control"]'),
    ).toBeNull();

    fireEvent.click(button);
    expect(
      screen.getByRole("heading", { name: "Connect wallet" }),
    ).toBeVisible();
  });

  it("uses the submitter primary action to connect a fee payer", () => {
    renderPreview({
      status,
      activeOperation: "pauseTreasury",
      dialog: {
        operation: {
          ...operation,
          signatures: ["one", "two", "three", null, null],
        },
        validSignatures: [true, true, true, false, false],
      },
    });

    const button = screen.getByRole("button", { name: "Connect wallet" });
    expect(button).toBeEnabled();
    expect(button).toHaveClass("w-full");
    expect(
      document.querySelector('[data-component="wallet-connect-control"]'),
    ).toBeNull();
  });
});

describe("backoffice action navigation", () => {
  afterEach(cleanup);

  it("keeps the action tabs outside and replaces the selected action panel", async () => {
    renderPreview({
      status,
      loading: false,
      activeOperation: "pauseTreasury",
      dialog: {},
    });

    const switcher = document.querySelector(
      '[data-component="action-switcher"]',
    );
    const pausePanel = document.querySelector(
      '[data-component="action-panel"]',
    );
    expect(switcher).not.toBeNull();
    expect(pausePanel).toHaveAttribute("data-operation", "pauseTreasury");
    expect(switcher?.contains(pausePanel)).toBe(false);

    const proposalTab = screen.getByRole("tab", {
      name: "Toggle proposal pause",
    });
    fireEvent.mouseDown(proposalTab);
    fireEvent.click(proposalTab);

    await waitFor(() => {
      const proposalPanel = document.querySelector(
        '[data-component="action-panel"]',
      );
      expect(
        screen.getByRole("heading", { name: "Toggle proposal pause" }),
      ).toBeVisible();
      expect(proposalPanel).toHaveAttribute("data-operation", "toggleProposal");
      expect(proposalPanel).not.toBe(pausePanel);
    });
  });
});
