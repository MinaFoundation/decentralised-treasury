import type { ReactNode } from "react";
import { WalletButton, type WalletButtonProps } from "./wallet-button";

export default {
  title: "Wallet/WalletButton",
  component: WalletButton,
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

const connectedWalletArgs = {
  status: "connected" as const,
  address: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
  accountInfo: {
    minaBalance: "284,120 MINA",
    delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
    votingWeight: "264,800 MINA",
  },
} satisfies WalletButtonProps;

export const ConnectToContinue = {
  args: {
    status: "disconnected",
  } satisfies WalletButtonProps,
  render: (args: WalletButtonProps) => (
    <StoryFrame>
      <WalletButton {...args}>
        <button type="button" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          New proposal
        </button>
      </WalletButton>
    </StoryFrame>
  ),
};

export const ConnectedAction = {
  args: connectedWalletArgs,
  render: (args: WalletButtonProps) => (
    <StoryFrame>
      <WalletButton {...args}>
        <button type="button" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          New proposal
        </button>
      </WalletButton>
    </StoryFrame>
  ),
};

export const InstallToContinue = {
  args: {
    status: "disconnected",
    isWalletAvailable: false,
  } satisfies WalletButtonProps,
  render: (args: WalletButtonProps) => (
    <StoryFrame>
      <WalletButton {...args}>
        <button type="button" className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          New proposal
        </button>
      </WalletButton>
    </StoryFrame>
  ),
};

export const ConnectedWalletOnly = {
  args: connectedWalletArgs,
  render: (args: WalletButtonProps) => (
    <StoryFrame>
      <WalletButton {...args} />
    </StoryFrame>
  ),
};

export const ConnectedWithoutDropdown = {
  args: {
    ...connectedWalletArgs,
    showAccountDropdown: false,
  } satisfies WalletButtonProps,
  render: (args: WalletButtonProps) => (
    <StoryFrame>
      <WalletButton {...args} />
    </StoryFrame>
  ),
};

function StoryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[20rem] w-full items-start justify-center overflow-visible rounded-2xl border bg-card p-8 sm:p-10">
      {children}
    </div>
  );
}
