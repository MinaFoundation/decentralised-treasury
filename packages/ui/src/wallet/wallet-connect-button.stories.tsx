import { useEffect, useRef } from "react";
import {
  WalletConnectButton,
  type WalletConnectButtonProps,
} from "./wallet-connect-button";

export default {
  title: "Wallet/WalletConnectButton",
  component: WalletConnectButton,
  parameters: {
    layout: "padded",
  },
  argTypes: {
    onClick: {
      action: "connect wallet clicked",
    },
    onInstallClick: {
      action: "install wallet clicked",
    },
    onDisconnectClick: {
      action: "disconnect wallet clicked",
    },
  },
};

export const Connect = {
  args: {
    status: "disconnected",
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const Install = {
  args: {
    status: "disconnected",
    isAuroInstalled: false,
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const Connecting = {
  args: {
    status: "connecting",
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const InitialLoading = {
  args: {
    status: "disconnected",
    loading: true,
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const Connected = {
  args: {
    status: "connected",
    address: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
    accountInfo: {
      minaBalance: "284,120 MINA",
      delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
      votingWeight: "264,800 MINA",
    },
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const DisconnectOnHover = {
  args: {
    status: "connected",
    address: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
    accountInfo: {
      minaBalance: "284,120 MINA",
      delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
      votingWeight: "264,800 MINA",
    },
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => (
    <StoryFrame>
      <FocusedWalletButtonStory {...args} />
    </StoryFrame>
  ),
};

export const LoadingAccountDetails = {
  args: {
    status: "connected",
    address: "B62qq7vvHBQvVfkkcWqn7pGWFUvyVdkxA8UfWPhiNKiDBaExc4AWr4z",
    accountInfoLoading: true,
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

export const ErrorFallsBackToConnect = {
  args: {
    status: "error",
  } satisfies WalletConnectButtonProps,
  render: (args: WalletConnectButtonProps) => <StoryFrame><WalletConnectButton {...args} /></StoryFrame>,
};

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[20rem] w-full items-start justify-center overflow-visible rounded-2xl border bg-card p-8 sm:p-10">
      {children}
    </div>
  );
}

function FocusedWalletButtonStory(args: WalletConnectButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return <WalletConnectButton {...args} ref={ref} />;
}
