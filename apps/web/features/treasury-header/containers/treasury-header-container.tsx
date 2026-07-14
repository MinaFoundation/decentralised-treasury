"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TreasuryWalletHeader } from "@repo/ui/treasury-header";
import { buildTreasuryHeaderProps } from "./treasury-header-view-model";
import { useEndpointSettings } from "../../endpoint-settings/hooks/use-endpoint-settings";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import { useHeaderSearch } from "../hooks/use-header-search";
import { useTreasuryHeaderBalance } from "../hooks/use-treasury-header-balance";
import { useTreasuryStatus } from "../hooks/use-treasury-status";
import { useWalletAccountInfo } from "../hooks/use-wallet-account-info";
import { useWalletSession } from "../hooks/use-wallet-session";
import { useHeaderSearchState } from "../store/treasury-header-store.selectors";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useProposalDrafts } from "../../proposals/hooks/use-proposal-drafts";

const AURO_INSTALL_URL = "https://www.aurowallet.com/";

export function TreasuryHeaderContainer() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useHeaderSearchState();
  const treasury = useTreasuryState();
  const settings = useEndpointSettingsState();
  const setSearchQuery = useTreasuryHeaderStore(
    (state) => state.setSearchQuery,
  );
  const { wallet, connectWallet, disconnectWallet } = useWalletSession();
  const { saveSettings } = useEndpointSettings();
  const forceRefresh = useMinaBlockStore((state) => state.forceRefresh);
  const { headerDraftProposals, removeDraft } = useProposalDrafts();

  useHeaderSearch();
  useTreasuryStatus();
  useTreasuryHeaderBalance();
  useWalletAccountInfo();

  const headerProps = useMemo(
    () =>
      buildTreasuryHeaderProps({
        pathname,
        search,
        treasury,
        settings,
        wallet,
        draftProposals: headerDraftProposals,
        setSearchQuery,
        saveSettings,
        forceRefresh,
        connectWallet,
        disconnectWallet,
        openInstallWallet: () => {
          window.open(AURO_INSTALL_URL, "_blank", "noopener,noreferrer");
        },
        push: router.push,
        selectDraftProposal: (draftId) => {
          const from = pathname === "/" ? "dashboard" : "proposals";
          router.push(
            `/proposals/create?draftId=${encodeURIComponent(draftId)}&from=${from}`,
          );
        },
        deleteDraftProposal: (draftId) => {
          removeDraft(draftId);
        },
      }),
    [
      connectWallet,
      headerDraftProposals,
      removeDraft,
      disconnectWallet,
      forceRefresh,
      pathname,
      router.push,
      saveSettings,
      search,
      setSearchQuery,
      settings,
      treasury,
      wallet,
    ],
  );

  return <TreasuryWalletHeader {...headerProps} />;
}
