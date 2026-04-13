import type { TreasuryWalletHeaderProps } from "@repo/ui/treasury-header";
import type { TreasuryProposalTableEntry } from "@repo/ui/treasury-proposals-table";
import type { TreasuryHeaderSearchState } from "../store/treasury-header-store.types";
import type { TreasuryHeaderWalletState } from "../store/treasury-header-store.types";
import type { EndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.types";
import type { TreasuryState } from "../../treasury/store/treasury-store.types";

interface BuildTreasuryHeaderPropsInput {
  pathname: string;
  selectedLifecycleId?: number;
  search: TreasuryHeaderSearchState;
  treasury: TreasuryState;
  settings: EndpointSettingsState;
  wallet: TreasuryHeaderWalletState;
  draftProposals: TreasuryWalletHeaderProps["draftProposals"];
  setSearchQuery: (query: string) => void;
  saveSettings: (settings: EndpointSettingsState["value"]) => void;
  forceRefresh: () => void;
  connectWallet: () => void | Promise<void>;
  disconnectWallet: () => void;
  openInstallWallet: () => void;
  push: (href: string) => void;
  selectDraftProposal: (draftId: string) => void;
  deleteDraftProposal?: (draftId: string) => void;
}

function buildProposalSearchHref(entry: TreasuryProposalTableEntry): string {
  return `/proposals/${encodeURIComponent(entry.proposalAddress ?? entry.id)}`;
}

export function buildTreasuryHeaderProps(
  input: BuildTreasuryHeaderPropsInput,
): TreasuryWalletHeaderProps {
  const createProposalLifecycleId = input.selectedLifecycleId ?? input.treasury.currentLifecycleId;
  const createProposalFrom = input.pathname === "/" ? "dashboard" : "proposals";
  const createProposalHref =
    createProposalLifecycleId !== undefined
      ? `/proposals/create?lifecycleId=${createProposalLifecycleId}&from=${createProposalFrom}`
      : `/proposals/create?from=${createProposalFrom}`;

  return {
    className: "max-w-none",
    activeNavigationItemId: input.pathname.startsWith("/proposals") ? "proposals" : "dashboard",
    treasuryPaused: input.treasury.paused,
    treasuryBalance: input.treasury.balance,
    treasuryBalanceLoading: input.treasury.loading,
    treasuryBalanceFailed: Boolean(input.treasury.error),
    walletLoading: input.wallet.loading,
    walletConnectStatus: input.wallet.status,
    walletAddress: input.wallet.address,
    walletAccountInfo: input.wallet.accountInfo,
    walletAccountInfoLoading: input.wallet.accountInfoLoading,
    isAuroInstalled: input.wallet.isAuroInstalled,
    onConnectWalletClick: () => {
      void input.connectWallet();
    },
    onInstallWalletClick: input.openInstallWallet,
    onDisconnectWalletClick: input.disconnectWallet,
    onCreateProposalClick: () => input.push(createProposalHref),
    draftProposals: input.draftProposals,
    onDraftProposalSelect: input.selectDraftProposal,
    onDraftProposalDelete: input.deleteDraftProposal,
    onDashboardClick: () => input.push("/"),
    onProposalsClick: () => input.push("/proposals"),
    settings: input.settings.value,
    onSettingsSave: (nextSettings) => {
      input.saveSettings(nextSettings);
      input.forceRefresh();
    },
    proposalSearch: {
      query: input.search.query,
      onQueryChange: input.setSearchQuery,
      results: input.search.results,
      loading: input.search.loading,
      onSelect: (entry) => {
        input.push(buildProposalSearchHref(entry));
      },
    },
  };
}
