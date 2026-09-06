import { useEffect, useMemo, useState } from "react";
import type { TreasuryProposalTableEntry } from "../proposals/proposals-table";
import {
  TreasuryHeader,
  TreasuryWalletHeader,
  type TreasuryWalletHeaderProps,
} from "./treasury-header";

export default {
  title: "Treasury/TreasuryHeader",
  component: TreasuryWalletHeader,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    onCreateProposalClick: {
      action: "create proposal clicked",
    },
    onDraftProposalSelect: {
      action: "draft proposal selected",
    },
    onDraftProposalDelete: {
      action: "draft proposal deleted",
    },
    onConnectWalletClick: {
      action: "connect wallet clicked",
    },
    onInstallWalletClick: {
      action: "install wallet clicked",
    },
    onDisconnectWalletClick: {
      action: "disconnect wallet clicked",
    },
    onSettingsSave: {
      action: "treasury settings saved",
    },
  },
};

const defaultWalletArgs = {
  defaultSettings: {
    networkId: "MAINNET" as const,
    apiUrl: "https://api.treasury.local",
    indexerApiUrl: "https://treasury.local/indexer",
    processorApiUrl: "https://treasury.local/processor",
    minaNodeUrl: "https://berkeley.minascan.io/graphql",
  },
} satisfies Partial<TreasuryWalletHeaderProps>;

const connectedWalletArgs = {
  walletConnectStatus: "connected" as const,
  walletAddress: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
} satisfies Pick<
  TreasuryWalletHeaderProps,
  "walletConnectStatus" | "walletAddress"
>;

const connectedWalletAccountInfo = {
  minaBalance: "284,120 MINA",
  delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
  votingWeight: "264,800 MINA",
} satisfies NonNullable<TreasuryWalletHeaderProps["walletAccountInfo"]>;

const proposalEntries: TreasuryProposalTableEntry[] = [
  {
    id: "P-124",
    title: "Ecosystem grants program for zero-knowledge education",
    proposer: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
    requestedAmount: "120,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-04-01",
  },
  {
    id: "P-123",
    title: "Core protocol developer residency extension",
    proposer: "B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri",
    requestedAmount: "300,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-03-31",
  },
  {
    id: "P-122",
    title: "Delegation tooling and wallet UX improvements",
    proposer: "B62qrEhYL7zPNxZ3Srnrw9KoXwJKvt5TF13z5tqofZiqKqp4osbzYXF",
    requestedAmount: "82,500 MINA",
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-29",
  },
];

function HeaderFrame({ children }: { children: React.ReactNode }) {
  return <div className="w-full bg-background p-3 sm:p-6">{children}</div>;
}

function SearchableWalletHeaderStory(args: TreasuryWalletHeaderProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    return proposalEntries.filter(
      (entry) =>
        entry.id.toLowerCase().includes(normalized) ||
        entry.title.toLowerCase().includes(normalized) ||
        entry.proposer.toLowerCase().includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const id = window.setTimeout(() => setLoading(false), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  return (
    <HeaderFrame>
      <TreasuryWalletHeader
        {...args}
        proposalSearch={{
          query,
          onQueryChange: setQuery,
          results,
          loading,
        }}
      />
    </HeaderFrame>
  );
}

/** Canonical wallet header: logo, title, nav, new proposal, settings. Full layout lives in the Dashboard story. */
export const WalletHeader = {
  args: defaultWalletArgs,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const ConnectedWalletHeader = {
  args: {
    ...defaultWalletArgs,
    activeNavigationItemId: "my-wallet",
    ...connectedWalletArgs,
    walletAccountInfo: connectedWalletAccountInfo,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const HeaderWithDrafts = {
  args: {
    ...defaultWalletArgs,
    ...connectedWalletArgs,
    walletAccountInfo: connectedWalletAccountInfo,
    draftProposals: [
      {
        id: "D-134",
        title: "Governance office-hours expansion",
        lifecycleId: 12,
        updatedAt: "Updated 2h ago",
      },
      {
        id: "D-135",
        title: "Regional delegate onboarding program",
        lifecycleId: 13,
        updatedAt: "Updated yesterday",
      },
    ],
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const ConnectingWalletHeader = {
  args: {
    ...defaultWalletArgs,
    walletConnectStatus: "connecting" as const,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const InitialLoadingWalletHeader = {
  args: {
    ...defaultWalletArgs,
    walletLoading: true,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const ErrorWalletHeader = {
  args: {
    ...defaultWalletArgs,
    walletConnectStatus: "error" as const,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const LoadingAccountWalletHeader = {
  args: {
    ...defaultWalletArgs,
    ...connectedWalletArgs,
    walletAccountInfoLoading: true,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const LoadingTreasuryBalanceHeader = {
  args: {
    ...defaultWalletArgs,
    treasuryBalanceLoading: true,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const FailedTreasuryBalanceHeader = {
  args: {
    ...defaultWalletArgs,
    treasuryBalanceFailed: true,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const InstallWalletHeader = {
  args: {
    ...defaultWalletArgs,
    walletConnectStatus: "disconnected" as const,
    isWalletAvailable: false,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const SearchableWalletHeader = {
  args: {
    ...defaultWalletArgs,
    activeNavigationItemId: "proposals",
    ...connectedWalletArgs,
    walletAccountInfo: connectedWalletAccountInfo,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <SearchableWalletHeaderStory {...args} />
  ),
};

export const PausedWalletHeader = {
  args: {
    ...defaultWalletArgs,
    treasuryPaused: true,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader {...args} />
    </HeaderFrame>
  ),
};

export const CustomWalletRenderHeader = {
  args: {
    ...defaultWalletArgs,
  } satisfies Partial<TreasuryWalletHeaderProps>,
  render: (args: TreasuryWalletHeaderProps) => (
    <HeaderFrame>
      <TreasuryWalletHeader
        {...args}
        renderWalletButton={({ isCompact }) => (
          <button type="button" className="rounded-sm border px-3 py-2 text-sm">
            {isCompact ? "Compact wallet action" : "Custom wallet action"}
          </button>
        )}
      />
    </HeaderFrame>
  ),
};

/** `TreasuryHeader` with a custom trailing action (no wallet chrome). */
export const HeaderWithSlot = {
  render: () => (
    <HeaderFrame>
      <TreasuryHeader>
        <button type="button" className="rounded-sm border px-3 py-2 text-sm">
          Custom action
        </button>
      </TreasuryHeader>
    </HeaderFrame>
  ),
};
