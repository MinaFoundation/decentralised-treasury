import type { IntlShape, MessageDescriptor } from "react-intl";

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WalletConnectMessages {
  loading: string;
  connect: string;
  install: string;
  connecting: string;
  connected: string;
  disconnect: string;
}

export interface WalletAccountInfo {
  minaBalance?: string | null;
  votingWeight?: string | null;
  delegatedTo?: string | null;
  delegatedVotingWeight?: string | null;
}

export interface TreasuryHeaderMessages {
  title: string;
}

export const defaultWalletConnectMessages: WalletConnectMessages = {
  loading: "Checking Auro...",
  connect: "Connect Auro",
  install: "Install Auro",
  connecting: "Connecting...",
  connected: "Connected",
  disconnect: "Disconnect",
};

export const defaultTreasuryHeaderMessages: TreasuryHeaderMessages = {
  title: "Mina Decentralized Treasury",
};

export const walletConnectMessageDescriptors: Record<
  keyof WalletConnectMessages,
  MessageDescriptor
> = {
  connect: {
    id: "ui.wallet.connect",
    defaultMessage: defaultWalletConnectMessages.connect,
  },
  loading: {
    id: "ui.wallet.loading",
    defaultMessage: defaultWalletConnectMessages.loading,
  },
  install: {
    id: "ui.wallet.install",
    defaultMessage: defaultWalletConnectMessages.install,
  },
  connecting: {
    id: "ui.wallet.connecting",
    defaultMessage: defaultWalletConnectMessages.connecting,
  },
  connected: {
    id: "ui.wallet.connected",
    defaultMessage: defaultWalletConnectMessages.connected,
  },
  disconnect: {
    id: "ui.wallet.disconnect",
    defaultMessage: defaultWalletConnectMessages.disconnect,
  },
};

export const treasuryHeaderMessageDescriptors: Record<
  keyof TreasuryHeaderMessages,
  MessageDescriptor
> = {
  title: {
    id: "ui.treasury.header.title",
    defaultMessage: defaultTreasuryHeaderMessages.title,
  },
};

function formatDescriptor(
  intl: IntlShape,
  descriptor: MessageDescriptor,
  fallback: string,
): string {
  const formatted = intl.formatMessage(descriptor);
  return formatted || fallback;
}

export function resolveWalletConnectMessages(
  intl: IntlShape,
  overrides?: Partial<WalletConnectMessages>,
): WalletConnectMessages {
  return {
    loading:
      overrides?.loading ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.loading,
        defaultWalletConnectMessages.loading,
      ),
    connect:
      overrides?.connect ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.connect,
        defaultWalletConnectMessages.connect,
      ),
    install:
      overrides?.install ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.install,
        defaultWalletConnectMessages.install,
      ),
    connecting:
      overrides?.connecting ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.connecting,
        defaultWalletConnectMessages.connecting,
      ),
    connected:
      overrides?.connected ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.connected,
        defaultWalletConnectMessages.connected,
      ),
    disconnect:
      overrides?.disconnect ??
      formatDescriptor(
        intl,
        walletConnectMessageDescriptors.disconnect,
        defaultWalletConnectMessages.disconnect,
      ),
  };
}

export function resolveTreasuryHeaderMessages(
  intl: IntlShape,
  overrides?: Partial<TreasuryHeaderMessages>,
): TreasuryHeaderMessages {
  return {
    title:
      overrides?.title ??
      formatDescriptor(
        intl,
        treasuryHeaderMessageDescriptors.title,
        defaultTreasuryHeaderMessages.title,
      ),
  };
}
