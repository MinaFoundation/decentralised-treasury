import { type JSX, type ReactNode } from "react";
import type { WalletAccountInfo, WalletConnectionStatus } from "./wallet-types";
import {
  WalletConnectButton,
  type WalletConnectButtonProps,
} from "./wallet-connect-button";

export interface WalletButtonRenderContext {
  loading?: boolean;
  status: WalletConnectionStatus;
  address?: string | null;
  accountInfo?: WalletAccountInfo;
  accountInfoLoading?: boolean;
  isWalletAvailable?: boolean;
}

export interface WalletButtonProps extends WalletConnectButtonProps {
  children?:
    | ReactNode
    | ((context: WalletButtonRenderContext) => ReactNode);
}

export function WalletButton({
  children,
  variant,
  status,
  address,
  accountInfo,
  accountInfoLoading = false,
  isWalletAvailable = true,
  ...walletButtonProps
}: WalletButtonProps): JSX.Element {
  const renderContext: WalletButtonRenderContext = {
    loading: walletButtonProps.loading,
    status,
    address,
    accountInfo,
    accountInfoLoading,
    isWalletAvailable,
  };
  const connectedContent =
    typeof children === "function" ? children(renderContext) : children;

  if (status === "connected" && connectedContent) {
    return <>{connectedContent}</>;
  }

  return (
    <WalletConnectButton
      {...walletButtonProps}
      loading={walletButtonProps.loading}
      status={status}
      address={address}
      accountInfo={accountInfo}
      accountInfoLoading={accountInfoLoading}
      isWalletAvailable={isWalletAvailable}
      variant={variant ?? (children ? "default" : undefined)}
    />
  );
}
