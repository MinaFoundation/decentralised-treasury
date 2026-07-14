import { type JSX, useEffect, useMemo, useState } from "react";
import { TreasuryStatusFooter } from "../footer/treasury-status-footer";
import {
  TreasuryWalletHeader,
  type TreasuryWalletHeaderProps,
} from "../header/treasury-header";
import {
  TreasuryLifecyclePeriodInfo,
  type TreasuryLifecyclePeriodId,
  type TreasuryLifecyclePeriodInfoProps,
} from "../lifecycle/lifecycle-period-info";
import {
  TreasuryCooldownPeriodTable,
  TreasuryExplorationPeriodTable,
  type TreasuryProposalLatestVoteTally,
  TreasuryProposalPeriodTable,
  type TreasuryProposalTableEntry,
  TreasuryVotingPeriodTable,
} from "../proposals/proposals-table";

function createLatestVoteTally(
  voteResult: TreasuryProposalLatestVoteTally["voteResult"],
  createdByEventType: TreasuryProposalLatestVoteTally["createdByEventType"],
  yayWeight: string,
  nayWeight: string,
  abstainWeight: string,
  blockHeight: number,
): TreasuryProposalLatestVoteTally {
  return {
    blockHeight,
    yayWeight,
    nayWeight,
    abstainWeight,
    createdByEventType,
    voteResult,
  };
}

function createProposalVotingRequirements(
  stakingEpochDataLedgerTotalCurrency: string,
  requiredParticipationBp: string,
  requiredApprovalBp: string,
): Pick<
  TreasuryProposalTableEntry,
  | "stakingEpochDataLedgerTotalCurrency"
  | "requiredParticipationBp"
  | "requiredApprovalBp"
> {
  return {
    stakingEpochDataLedgerTotalCurrency,
    requiredParticipationBp,
    requiredApprovalBp,
  };
}

const proposalEntries: TreasuryProposalTableEntry[] = [
  {
    id: "P-124",
    title: "Ecosystem grants program for zero-knowledge education",
    proposalAddress: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
    proposer: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
    requestedAmount: "120,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-04-01T14:32:00.000Z",
    createdAtBlock: 450920,
    ...createProposalVotingRequirements("400000", "2000", "5100"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVoteDispatched",
      "182450",
      "38120",
      "9200",
      450920,
    ),
  },
  {
    id: "P-123",
    title: "Core protocol developer residency extension",
    proposalAddress: "B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri",
    proposer: "B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri",
    requestedAmount: "300,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-03-31T09:18:00.000Z",
    createdAtBlock: 450811,
  },
  {
    id: "P-122",
    title: "Delegation tooling and wallet UX improvements",
    proposalAddress: "B62qrEhYL7zPNxZ3Srnrw9KoXwJKvt5TF13z5tqofZiqKqp4osbzYXF",
    proposer: "B62qrEhYL7zPNxZ3Srnrw9KoXwJKvt5TF13z5tqofZiqKqp4osbzYXF",
    requestedAmount: "82,500 MINA",
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-29T18:44:00.000Z",
    createdAtBlock: 450602,
    ...createProposalVotingRequirements("320000", "3000", "6000"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVotesTallied",
      "201104",
      "22890",
      "11880",
      450602,
    ),
  },
  {
    id: "P-121",
    title: "University research partnership for recursive proofs",
    proposalAddress: "B62qnMgZkY7pmyKb8a6rDzsyaNepkrUjrRSnkgaUVizLocD3nyzq6xx",
    proposer: "B62qnMgZkY7pmyKb8a6rDzsyaNepkrUjrRSnkgaUVizLocD3nyzq6xx",
    requestedAmount: "210,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-28T11:06:00.000Z",
    createdAtBlock: 450497,
    ...createProposalVotingRequirements("280000", "2500", "5500"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVoteDispatched",
      "96420",
      "74210",
      "20450",
      450497,
    ),
  },
  {
    id: "P-120",
    title: "Treasury analytics dashboard phase one delivery",
    proposalAddress: "B62qkU7JVGqvYgsYyEJKo7dKjoMtaPxVHmCh9Q5N135MD1a4mQYgQUG",
    proposer: "B62qkU7JVGqvYgsYyEJKo7dKjoMtaPxVHmCh9Q5N135MD1a4mQYgQUG",
    requestedAmount: "64,000 MINA",
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-27T16:27:00.000Z",
    createdAtBlock: 450388,
    ...createProposalVotingRequirements("260000", "2200", "5800"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVotesTallied",
      "154220",
      "30120",
      "9980",
      450388,
    ),
  },
  {
    id: "P-119C",
    title: "Regional validator onboarding stipend program",
    proposalAddress: "B62qrYz9Yw1nWzWbD8wdG4Q4A2gN1mR2tA9o5K5eQq9M8rVfN2pLx7u",
    proposer: "B62qrYz9Yw1nWzWbD8wdG4Q4A2gN1mR2tA9o5K5eQq9M8rVfN2pLx7u",
    requestedAmount: "110,000 MINA",
    stage: "Rejected",
    period: "Cooldown",
    createdAt: "2026-03-27T07:18:00.000Z",
    createdAtBlock: 450355,
    ...createProposalVotingRequirements("295000", "2600", "6200"),
    latestVoteTally: createLatestVoteTally(
      "rejected",
      "proposalVotesTallied",
      "102300",
      "121800",
      "9600",
      450355,
    ),
  },
  {
    id: "P-118C",
    title: "Governance mentorship office hours pilot",
    proposalAddress: "B62qvH7f5Jj2mY1gQ4nH8rM6xW2cK9dL5sP3tN7qR4vB8zX6uC1eFa",
    proposer: "B62qvH7f5Jj2mY1gQ4nH8rM6xW2cK9dL5sP3tN7qR4vB8zX6uC1eFa",
    requestedAmount: "40,000 MINA",
    stage: "Voting",
    period: "Cooldown",
    createdAt: "2026-03-26T13:40:00.000Z",
    createdAtBlock: 450310,
    ...createProposalVotingRequirements("250000", "2000", "5500"),
    latestVoteTally: createLatestVoteTally(
      null,
      "proposalVotesTallied",
      "0",
      "0",
      "0",
      450310,
    ),
  },
  {
    id: "P-119",
    title: "Validator decentralization incentive pilot",
    proposalAddress: "B62qmhjWGhqLzA8aei9DTitL7S2kYNPtN7LWXBK9hsGk8o8F9zMXw6t",
    proposer: "B62qmhjWGhqLzA8aei9DTitL7S2kYNPtN7LWXBK9hsGk8o8F9zMXw6t",
    requestedAmount: "175,000 MINA",
    stage: "Rejected",
    period: "Voting",
    createdAt: "2026-03-26T08:55:00.000Z",
    createdAtBlock: 450271,
    ...createProposalVotingRequirements("300000", "3000", "6500"),
    latestVoteTally: createLatestVoteTally(
      "rejected",
      "proposalVoteDispatched",
      "44200",
      "136500",
      "8100",
      450271,
    ),
  },
  {
    id: "P-118V",
    title: "Protocol education grants for emerging communities",
    proposalAddress: "B62qpoS6jR6Qk2xQmH8kVq7Qy1eJm7J2f6Pz9Lx7mV2nT8wK4cR1sDu",
    proposer: "B62qpoS6jR6Qk2xQmH8kVq7Qy1eJm7J2f6Pz9Lx7mV2nT8wK4cR1sDu",
    requestedAmount: "58,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-25T12:22:00.000Z",
    createdAtBlock: 450180,
    ...createProposalVotingRequirements("285000", "2400", "5700"),
    latestVoteTally: createLatestVoteTally(
      null,
      "proposalVoteDispatched",
      "0",
      "0",
      "0",
      450180,
    ),
  },
  {
    id: "P-118",
    title: "Community regional events and ambassador funding",
    proposalAddress: "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB",
    proposer: "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB",
    requestedAmount: "95,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-03-24T20:14:00.000Z",
    createdAtBlock: 450062,
  },
  {
    id: "P-117",
    title: "Open source security review for treasury contracts",
    proposalAddress: "B62qq1miZzh8QMumJ2dhJSvPxdeShGQ2G2cH4YXwxNLpPSvKdRVTb3q",
    proposer: "B62qq1miZzh8QMumJ2dhJSvPxdeShGQ2G2cH4YXwxNLpPSvKdRVTb3q",
    requestedAmount: "48,000 MINA",
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-22T13:09:00.000Z",
    createdAtBlock: 449841,
    ...createProposalVotingRequirements("340000", "1800", "5400"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVotesTallied",
      "221300",
      "10980",
      "4900",
      449841,
    ),
  },
  {
    id: "P-116",
    title: "ZK app onboarding templates for builders",
    proposalAddress: "B62qq6f3enRpmGsWBaJMstwQjQiRdAnyAZ6CbKrcJFgFidRnWZyJkje",
    proposer: "B62qq6f3enRpmGsWBaJMstwQjQiRdAnyAZ6CbKrcJFgFidRnWZyJkje",
    requestedAmount: "88,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-21T10:41:00.000Z",
    createdAtBlock: 449730,
    ...createProposalVotingRequirements("310000", "2800", "6000"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVoteDispatched",
      "71200",
      "41220",
      "18200",
      449730,
    ),
  },
  {
    id: "P-115",
    title: "Localized governance documentation rollout",
    proposalAddress: "B62qkBw74e5D3yZLAFTCK3yktG4TZtq4wSfjPrxKr9Psxu29oEZWpvw",
    proposer: "B62qkBw74e5D3yZLAFTCK3yktG4TZtq4wSfjPrxKr9Psxu29oEZWpvw",
    requestedAmount: "36,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-03-20T07:52:00.000Z",
    createdAtBlock: 449618,
  },
  {
    id: "P-114",
    title: "Treasury archival indexer scaling improvements",
    proposalAddress: "B62qrDMuC4Vu3x6Kcr6YpBYsFsrshpyyH6MWX4cs5UNN2b9syT3rHNX",
    proposer: "B62qrDMuC4Vu3x6Kcr6YpBYsFsrshpyyH6MWX4cs5UNN2b9syT3rHNX",
    requestedAmount: "132,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-18T15:26:00.000Z",
    createdAtBlock: 449401,
    ...createProposalVotingRequirements("330000", "2400", "5600"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVoteDispatched",
      "143500",
      "58440",
      "11500",
      449401,
    ),
  },
  {
    id: "P-113",
    title: "Protocol translation program for high-growth regions",
    proposalAddress: "B62qo2C5mvFGtmTdHVAynh2ZgD3kG6QbN6pMqnoCYsaFyCsxHuskFVe",
    proposer: "B62qo2C5mvFGtmTdHVAynh2ZgD3kG6QbN6pMqnoCYsaFyCsxHuskFVe",
    requestedAmount: "52,000 MINA",
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-16T12:03:00.000Z",
    createdAtBlock: 449176,
    ...createProposalVotingRequirements("315000", "2000", "5100"),
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVotesTallied",
      "188220",
      "15240",
      "6320",
      449176,
    ),
  },
];

const proposalPeriodEntries: TreasuryProposalTableEntry[] = [
  {
    id: "P-130",
    title: "Treasury design system accessibility pass",
    proposalAddress: "B62qmYHbjp4oDCNRNgHf1YLPQWQkVZ49Q6DLXmA9UdoERa9q29piAAo",
    proposer: "B62qmYHbjp4oDCNRNgHf1YLPQWQkVZ49Q6DLXmA9UdoERa9q29piAAo",
    requestedAmount: "42,000 MINA",
    stage: "Submitted",
    period: "Proposal",
    createdAt: "2026-04-10T09:12:00.000Z",
    createdAtBlock: 451731,
  },
  {
    id: "P-129",
    title: "Regional builder workshops for zkApp onboarding",
    proposalAddress: "B62qiYg67MzbxgsHv9EPxANUk9EyKWLdPFVc6sdvECF2ktZoguHRRbg",
    proposer: "B62qiYg67MzbxgsHv9EPxANUk9EyKWLdPFVc6sdvECF2ktZoguHRRbg",
    requestedAmount: "65,000 MINA",
    stage: "Draft",
    period: "Proposal",
    createdAt: "2026-04-09T17:48:00.000Z",
    createdAtBlock: 451642,
  },
  {
    id: "P-128",
    title: "Treasury reporting pipeline hardening",
    proposalAddress: "B62qmKLqCjz7j4Wj1yodmsr9xDtGaiMz538NMY39D9dpukZJtEmsSFr",
    proposer: "B62qmKLqCjz7j4Wj1yodmsr9xDtGaiMz538NMY39D9dpukZJtEmsSFr",
    requestedAmount: "98,000 MINA",
    stage: "Ready for review",
    period: "Proposal",
    createdAt: "2026-04-08T11:25:00.000Z",
    createdAtBlock: 451517,
  },
];

const connectedWalletAccountInfo = {
  minaBalance: "284,120 MINA",
  delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
  votingWeight: "264,800 MINA",
} satisfies NonNullable<TreasuryWalletHeaderProps["walletAccountInfo"]>;

function DashboardWithFullHeader({
  treasuryPaused = false,
  loading = false,
  proposalsEmpty = false,
  proposalEntriesOverride,
  walletConnectStatus = "disconnected",
  walletAddress,
  walletAccountInfo,
  isAuroInstalled = true,
  activeNavigationItemId = "dashboard",
  lifecycleInfo,
  onCreateProposalClick,
  onConnectWalletClick,
  onInstallWalletClick,
  onDisconnectWalletClick,
  onSettingsSave,
  onProposalClick,
}: {
  treasuryPaused?: boolean;
  loading?: boolean;
  proposalsEmpty?: boolean;
  proposalEntriesOverride?: TreasuryProposalTableEntry[];
  walletConnectStatus?: TreasuryWalletHeaderProps["walletConnectStatus"];
  walletAddress?: string;
  walletAccountInfo?: TreasuryWalletHeaderProps["walletAccountInfo"];
  isAuroInstalled?: boolean;
  activeNavigationItemId?: TreasuryWalletHeaderProps["activeNavigationItemId"];
  lifecycleInfo?: TreasuryLifecyclePeriodInfoProps;
  onCreateProposalClick?: TreasuryWalletHeaderProps["onCreateProposalClick"];
  onConnectWalletClick?: TreasuryWalletHeaderProps["onConnectWalletClick"];
  onInstallWalletClick?: TreasuryWalletHeaderProps["onInstallWalletClick"];
  onDisconnectWalletClick?: TreasuryWalletHeaderProps["onDisconnectWalletClick"];
  onSettingsSave?: TreasuryWalletHeaderProps["onSettingsSave"];
  onProposalClick?: (entry: TreasuryProposalTableEntry) => void;
} = {}): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const sourceEntries = proposalEntriesOverride ?? proposalEntries;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return sourceEntries.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.proposer.toLowerCase().includes(q) ||
        (p.proposalAddress ?? "").toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [searchQuery, sourceEntries]);

  useEffect(() => {
    if (!searchQuery.trim() || loading) {
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const id = window.setTimeout(() => {
      setSearchLoading(false);
    }, 400);
    return () => window.clearTimeout(id);
  }, [loading, searchQuery]);

  const displayedEntries = proposalsEmpty ? [] : sourceEntries;
  const resolvedProposalPeriod = lifecycleInfo?.currentPeriod ?? "voting";
  const ProposalsTableComponent =
    resolvedProposalPeriod === "proposal"
      ? TreasuryProposalPeriodTable
      : resolvedProposalPeriod === "exploration"
        ? TreasuryExplorationPeriodTable
        : resolvedProposalPeriod === "cooldown"
          ? TreasuryCooldownPeriodTable
          : TreasuryVotingPeriodTable;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[92rem] px-3 sm:px-5 lg:px-6">
        <TreasuryWalletHeader
          activeNavigationItemId={activeNavigationItemId}
          treasuryPaused={treasuryPaused}
          className="max-w-none px-0"
          defaultSettings={{
            networkId: "MAINNET",
            apiUrl: "https://api.mina-treasury.example",
            indexerApiUrl: "https://treasury.example/indexer",
            processorApiUrl: "https://treasury.example/processor",
            minaNodeUrl: "https://mina-mainnet-node.example/graphql",
          }}
          walletConnectStatus={walletConnectStatus}
          walletAddress={walletAddress}
          walletAccountInfo={walletAccountInfo}
          treasuryBalance="12400000"
          isAuroInstalled={isAuroInstalled}
          onCreateProposalClick={onCreateProposalClick}
          onConnectWalletClick={onConnectWalletClick}
          onInstallWalletClick={onInstallWalletClick}
          onDisconnectWalletClick={onDisconnectWalletClick}
          onSettingsSave={onSettingsSave}
          proposalSearch={{
            query: searchQuery,
            onQueryChange: setSearchQuery,
            results: searchResults,
            loading: loading || searchLoading,
          }}
        />

        <main className="flex w-full flex-col gap-6 py-6">
          <TreasuryLifecyclePeriodInfo
            loading={loading}
            {...(lifecycleInfo ??
              buildLifecycleArgs({
                lifecycleId: 12,
                currentPeriod: "voting",
                currentPeriodProgress: 68,
                currentSlot: 18460115,
                periodEndsIn: "1 day 4 hours",
              }))}
          />

          <div className="h-px w-full bg-border/60" aria-hidden="true" />

          <ProposalsTableComponent
            entries={displayedEntries}
            loading={loading}
            description="Proposal discovery and decision support for the selected lifecycle."
            onCreateProposalClick={onCreateProposalClick}
            onProposalClick={onProposalClick}
          />
        </main>

        <TreasuryStatusFooter
          className="max-w-none px-0"
          networkId="MAINNET"
          health={{
            apiStatus: "healthy",
            indexerStatus: "healthy",
            latestLiveSlot: 18459301,
            latestLiveBlock: 450920,
            latestIndexedSlot: 18459298,
            latestIndexedBlock: 450919,
            slotLag: 3,
            updatedAt: "just now",
          }}
        />
      </div>
    </div>
  );
}

export default {
  title: "Treasury/Dashboard",
  component: TreasuryVotingPeriodTable,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    onCreateProposalClick: {
      action: "create proposal clicked",
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
    onProposalClick: {
      action: "proposal row clicked",
    },
  },
};

/** Full shell: wallet header with centered proposal search, lifecycle hero, table, footer. */
export const LifecycleDashboard = {
  render: (args: DashboardStoryArgs) => <DashboardWithFullHeader {...args} />,
};

export const ProposalPeriodDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      lifecycleInfo={buildLifecycleArgs({
        lifecycleId: 13,
        currentPeriod: "proposal",
        currentPeriodProgress: 24,
        currentSlot: 18462512,
        periodEndsIn: "3 days 10 hours",
      })}
      proposalEntriesOverride={proposalPeriodEntries}
    />
  ),
};

export const ExplorationPeriodDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      lifecycleInfo={buildLifecycleArgs({
        lifecycleId: 14,
        currentPeriod: "exploration",
        currentPeriodProgress: 41,
        periodEndsIn: "1 day 18 hours",
      })}
      proposalEntriesOverride={proposalEntries.filter(
        (entry) => entry.period === "Exploration",
      )}
    />
  ),
};

export const VotingPeriodDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      lifecycleInfo={buildLifecycleArgs({
        lifecycleId: 12,
        currentPeriod: "voting",
        currentPeriodProgress: 68,
        currentSlot: 18460115,
        periodEndsIn: "1 day 4 hours",
      })}
      proposalEntriesOverride={proposalEntries.filter(
        (entry) => entry.period === "Voting",
      )}
    />
  ),
};

export const CooldownPeriodDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      lifecycleInfo={buildLifecycleArgs({
        lifecycleId: 15,
        currentPeriod: "cooldown",
        currentPeriodProgress: 84,
        periodEndsIn: "7 hours 12 minutes",
      })}
      proposalEntriesOverride={proposalEntries.filter(
        (entry) => entry.period === "Cooldown",
      )}
    />
  ),
};

export const CompletedLifecycleDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      lifecycleInfo={buildLifecycleArgs({
        lifecycleId: 11,
        currentPeriod: "cooldown",
        currentPeriodProgress: 100,
        isHistoricalLifecycle: true,
      })}
      proposalEntriesOverride={proposalEntries.filter(
        (entry) => entry.period === "Cooldown",
      )}
    />
  ),
};

export const ConnectedWalletDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      activeNavigationItemId="my-wallet"
      walletConnectStatus="connected"
      walletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
      walletAccountInfo={connectedWalletAccountInfo}
    />
  ),
};

export const InstallWalletDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader
      {...args}
      walletConnectStatus="disconnected"
      isAuroInstalled={false}
    />
  ),
};

export const LoadingDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader {...args} loading />
  ),
};

export const EmptyDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader {...args} proposalsEmpty />
  ),
};

export const PausedTreasuryDashboard = {
  render: (args: DashboardStoryArgs) => (
    <DashboardWithFullHeader {...args} treasuryPaused />
  ),
};

interface DashboardStoryArgs {
  onCreateProposalClick?: TreasuryWalletHeaderProps["onCreateProposalClick"];
  onConnectWalletClick?: TreasuryWalletHeaderProps["onConnectWalletClick"];
  onInstallWalletClick?: TreasuryWalletHeaderProps["onInstallWalletClick"];
  onDisconnectWalletClick?: TreasuryWalletHeaderProps["onDisconnectWalletClick"];
  onSettingsSave?: TreasuryWalletHeaderProps["onSettingsSave"];
  onProposalClick?: (entry: TreasuryProposalTableEntry) => void;
}

function buildLifecycleArgs({
  lifecycleId,
  currentPeriod,
  currentPeriodProgress,
  currentSlot,
  periodEndsIn,
  isHistoricalLifecycle,
}: LifecycleStoryArgs): TreasuryLifecyclePeriodInfoProps {
  const periodIndexById: Record<TreasuryLifecyclePeriodId, number> = {
    proposal: 0,
    exploration: 1,
    voting: 2,
    cooldown: 3,
  };
  const proposalStart = 18462144 + (lifecycleId - 13) * 6144;
  const periodLength = 1536;
  const lifecycleStartDate = new Date("2026-04-09T13:00:00.000Z");
  const lifecycleDateOffsetMs = (lifecycleId - 13) * 8 * 24 * 60 * 60 * 1000;
  const periodDurationMs = 2 * 24 * 60 * 60 * 1000;
  const currentPeriodIndex = periodIndexById[currentPeriod];
  const currentPeriodStart = proposalStart + currentPeriodIndex * periodLength;
  const currentPeriodWidth = periodLength - 1;
  const resolvedCurrentSlot =
    currentSlot ??
    Math.min(
      currentPeriodStart + currentPeriodWidth,
      currentPeriodStart +
        Math.round((currentPeriodWidth * currentPeriodProgress) / 100),
    );

  return {
    lifecycleId,
    currentPeriod,
    currentPeriodProgress,
    currentSlot: resolvedCurrentSlot,
    isHistoricalLifecycle,
    periodEndsIn,
    periodMetadata: [
      {
        period: "proposal",
        slotRange: `${proposalStart} - ${proposalStart + periodLength - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs,
        ).toISOString(),
      },
      {
        period: "exploration",
        slotRange: `${proposalStart + periodLength} - ${proposalStart + periodLength * 2 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs * 2,
        ).toISOString(),
      },
      {
        period: "voting",
        slotRange: `${proposalStart + periodLength * 2} - ${proposalStart + periodLength * 3 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs * 2,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs * 3,
        ).toISOString(),
      },
      {
        period: "cooldown",
        slotRange: `${proposalStart + periodLength * 3} - ${proposalStart + periodLength * 4 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs * 3,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() +
            lifecycleDateOffsetMs +
            periodDurationMs * 4,
        ).toISOString(),
      },
    ],
  };
}

interface LifecycleStoryArgs {
  lifecycleId: number;
  currentPeriod: TreasuryLifecyclePeriodId;
  currentPeriodProgress: number;
  currentSlot?: number;
  periodEndsIn?: string;
  isHistoricalLifecycle?: boolean;
}
