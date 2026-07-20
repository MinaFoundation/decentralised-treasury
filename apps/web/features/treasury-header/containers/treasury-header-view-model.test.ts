import { describe, expect, it, vi } from "vitest";
import { buildTreasuryHeaderProps } from "./treasury-header-view-model";

describe("buildTreasuryHeaderProps", () => {
  it("maps state into header props and wires callbacks", () => {
    const push = vi.fn();
    const saveSettings = vi.fn();
    const forceRefresh = vi.fn();
    const connectWallet = vi.fn();
    const disconnectWallet = vi.fn();
    const openInstallWallet = vi.fn();
    const setSearchQuery = vi.fn();
    const selectDraftProposal = vi.fn();
    const deleteDraftProposal = vi.fn();

    const props = buildTreasuryHeaderProps({
      pathname: "/proposals",
      search: {
        query: "grant",
        results: [
          {
            id: "P-1",
            title: "Treasury proposal",
            proposer: "B62qsender",
            requestedAmount: "10 MINA",
            stage: "Voting",
            period: "Voting",
            createdAt: "2026-01-01",
            proposalAddress: "B62qproposal",
          },
        ],
        loading: false,
        error: null,
      },
      treasury: {
        paused: true,
        balance: "120000000000",
        currentLifecycleId: 12,
        loading: false,
        error: null,
        health: {
          apiStatus: "healthy",
          indexerStatus: "healthy",
          updatedAt: null,
        },
      },
      settings: {
        hydrated: true,
        value: {
          networkId: "MAINNET",
          apiUrl: "http://127.0.0.1:4000",
          indexerApiUrl: "http://127.0.0.1:4001",
          processorApiUrl: "http://127.0.0.1:4002",
          minaNodeUrl: "http://127.0.0.1:8080/graphql",
        },
      },
      wallet: {
        loading: false,
        status: "connected",
        isAuroInstalled: true,
        address: "B62qwallet",
        accountInfo: {
          minaBalance: "4.2 MINA",
        },
        accountInfoLoading: false,
        error: null,
      },
      draftProposals: [],
      setSearchQuery,
      saveSettings,
      forceRefresh,
      connectWallet,
      disconnectWallet,
      openInstallWallet,
      push,
      selectDraftProposal,
      deleteDraftProposal,
    });

    expect(props.activeNavigationItemId).toBe("proposals");
    expect(props.treasuryPaused).toBe(true);
    expect(props.treasuryBalance).toBe("120000000000");
    expect(props.treasuryBalanceLoading).toBe(false);
    expect(props.treasuryBalanceFailed).toBe(false);
    expect(props.walletLoading).toBe(false);
    expect(props.walletConnectStatus).toBe("connected");

    props.onCreateProposalClick?.();
    expect(push).toHaveBeenCalledWith(
      "/proposals/create?lifecycleId=12&from=proposals",
    );

    const settings = {
      networkId: "MAINNET",
      apiUrl: "http://127.0.0.1:4000",
      indexerApiUrl: "http://127.0.0.1:4001",
      processorApiUrl: "http://127.0.0.1:4002",
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
    };

    props.onSettingsSave?.(settings);
    expect(saveSettings).toHaveBeenCalledWith(settings);
    expect(forceRefresh).toHaveBeenCalledTimes(1);

    props.proposalSearch?.onSelect?.({
      id: "P-1",
      title: "Treasury proposal",
      proposer: "B62qsender",
      requestedAmount: "10 MINA",
      stage: "Voting",
      period: "Voting",
      createdAt: "2026-01-01",
      proposalAddress: "B62qproposal",
    });
    expect(push).toHaveBeenCalledWith("/proposals/B62qproposal");

    props.proposalSearch?.onQueryChange("new query");
    expect(setSearchQuery).toHaveBeenCalledWith("new query");

    props.onConnectWalletClick?.();
    expect(connectWallet).toHaveBeenCalledTimes(1);

    props.onDisconnectWalletClick?.();
    expect(disconnectWallet).toHaveBeenCalledTimes(1);

    props.onInstallWalletClick?.();
    expect(openInstallWallet).toHaveBeenCalledTimes(1);

    props.onDraftProposalDelete?.("D-5");
    expect(deleteDraftProposal).toHaveBeenCalledWith("D-5");
  });

  it("keeps proposals navigation active on proposal detail routes", () => {
    const props = buildTreasuryHeaderProps({
      pathname: "/proposals/B62qproposal",
      search: {
        query: "",
        results: [],
        loading: false,
        error: null,
      },
      treasury: {
        paused: false,
        loading: false,
        error: null,
        health: {
          apiStatus: "healthy",
          indexerStatus: "healthy",
          updatedAt: null,
        },
      },
      settings: {
        hydrated: true,
        value: {
          networkId: "MAINNET",
          apiUrl: "http://127.0.0.1:4000",
          indexerApiUrl: "http://127.0.0.1:4001",
          processorApiUrl: "http://127.0.0.1:4002",
          minaNodeUrl: "http://127.0.0.1:8080/graphql",
        },
      },
      wallet: {
        loading: false,
        status: "disconnected",
        accountInfoLoading: false,
        error: null,
      },
      draftProposals: [],
      setSearchQuery: vi.fn(),
      saveSettings: vi.fn(),
      forceRefresh: vi.fn(),
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
      openInstallWallet: vi.fn(),
      push: vi.fn(),
      selectDraftProposal: vi.fn(),
    });

    expect(props.activeNavigationItemId).toBe("proposals");
  });
});
