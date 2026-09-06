"use client";

import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import { useWalletSessionController } from "../../wallet/containers/wallet-session-provider";

export function useWalletSession() {
  const wallet = useTreasuryHeaderStore((state) => state.wallet);
  const controller = useWalletSessionController();

  return {
    wallet,
    connectWallet: controller.connectWallet,
    disconnectWallet: controller.disconnectWallet,
    signAndSubmitZkapp: controller.signAndSubmitZkapp,
  };
}
