import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalCreatePageContainer } from "./proposal-create-page-container";

const state = vi.hoisted(() => ({
  treasury: {} as { currentLifecycleId?: number; currentPeriod?: string },
  owner: "treasury-owner",
  wallet: { address: "wallet", status: "connected" } as {
    address: string;
    status: "connected" | "disconnected";
  },
  estimate: vi.fn(async () => ({})),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock(
  "../../endpoint-settings/store/endpoint-settings-store.selectors",
  () => ({
    useEndpointSettingsState: () => ({
      hydrated: true,
      value: {
        apiUrl: "http://api",
        minaNodeUrl: "http://node",
        networkId: "DEVNET",
      },
    }),
  }),
);
vi.mock("../../treasury/store/treasury-store.selectors", () => ({
  useTreasuryState: () => state.treasury,
}));
vi.mock("../../runtime-config/lib/get-runtime-config", () => ({
  getRuntimeConfig: () => ({
    proofsEnabled: "false",
    treasuryOwnerContractAddress: state.owner,
  }),
}));
vi.mock("../../treasury-header/hooks/use-wallet-session", () => ({
  useWalletSession: () => ({
    wallet: state.wallet,
    connectWallet: vi.fn(),
    signAndSubmitZkapp: vi.fn(),
  }),
}));
vi.mock("../../treasury-header/lib/treasury-header-api", () => ({
  fetchLifecycleProposalEstimateContext: state.estimate,
}));
vi.mock("../hooks/use-proposal-drafts", () => ({
  useProposalDrafts: () => ({
    getDraftById: vi.fn(),
    removeDraft: vi.fn(),
    saveDraft: vi.fn(),
  }),
}));
vi.mock("../hooks/use-proposal-prover-worker", () => ({
  useProposalProverWorker: () => ({
    compile: vi.fn(),
    buildAndProveCreateProposal: vi.fn(),
  }),
}));
vi.mock("@repo/ui/treasury-proposal-creation-form", () => ({
  TreasuryProposalCreationForm: ({
    lifecycleId,
    connectedWalletAddress,
  }: {
    lifecycleId: number | null;
    connectedWalletAddress: string | null;
  }) => (
    <button data-wallet-address={connectedWalletAddress ?? ""}>
      Create proposal for {String(lifecycleId)}
    </button>
  ),
}));
vi.mock("@repo/ui/treasury-transaction-flow-dialog", () => ({
  TreasuryTransactionFlowDialog: () => null,
}));

afterEach(cleanup);

describe("proposal creation lifecycle readiness", () => {
  beforeEach(() => {
    state.treasury = {};
    state.owner = "treasury-owner";
    state.wallet = { address: "wallet", status: "connected" };
    state.estimate.mockClear();
  });

  it("does not expose submission before the real lifecycle resolves, including lifecycle zero", async () => {
    const view = render(<ProposalCreatePageContainer />);
    expect(
      screen.queryByRole("button", { name: /Create proposal/ }),
    ).toBeNull();
    expect(state.estimate).not.toHaveBeenCalled();

    state.treasury = { currentLifecycleId: 0, currentPeriod: "proposal" };
    view.rerender(<ProposalCreatePageContainer />);
    expect(
      screen.getByRole("button", { name: "Create proposal for 0" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(state.estimate).toHaveBeenCalledWith(
        "http://api",
        "http://node",
        0,
        "treasury-owner",
      ),
    );
  });

  it("clears the form wallet on disconnect even if the store retains its address", () => {
    state.treasury = { currentLifecycleId: 0, currentPeriod: "proposal" };
    const view = render(<ProposalCreatePageContainer />);
    const form = screen.getByRole("button", { name: "Create proposal for 0" });
    expect(form.getAttribute("data-wallet-address")).toBe("wallet");

    state.wallet = { address: "wallet", status: "disconnected" };
    view.rerender(<ProposalCreatePageContainer />);
    expect(form.getAttribute("data-wallet-address")).toBe("");

    state.wallet = { address: "wallet", status: "connected" };
    view.rerender(<ProposalCreatePageContainer />);
    expect(form.getAttribute("data-wallet-address")).toBe("wallet");
  });

  it("keeps the missing-configuration error visible without a lifecycle", () => {
    state.owner = "";
    render(<ProposalCreatePageContainer />);
    expect(
      screen.getByText("Proposal creation is not configured"),
    ).toBeTruthy();
  });
});
