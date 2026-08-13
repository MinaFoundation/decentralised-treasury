import {
  TreasuryCooldownPeriodTable,
  TreasuryExplorationPeriodTable,
  type TreasuryProposalLatestVoteTally,
  TreasuryProposalPeriodTable,
  TreasuryProposalsTable,
  type TreasuryProposalTableColumnKey,
  type TreasuryProposalTableEntry,
  type TreasuryProposalsTableProps,
  TreasuryVotingPeriodTable,
} from "./proposals-table";

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
    lifecycleId: 12,
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
    lifecycleId: 12,
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
    lifecycleId: 11,
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
    lifecycleId: 11,
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
    lifecycleId: 10,
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
    lifecycleId: 10,
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
    lifecycleId: 10,
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
    lifecycleId: 10,
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
    lifecycleId: 10,
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

const NON_STATUS_COLUMNS: TreasuryProposalTableColumnKey[] = [
  "title",
  "proposer",
  "requestedAmount",
  "createdAt",
];

export default {
  title: "Treasury/ProposalsTable",
  component: TreasuryProposalsTable,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    onCreateProposalClick: {
      action: "create proposal clicked",
    },
    onProposalClick: {
      action: "proposal row clicked",
    },
    onLifecycleChange: {
      action: "lifecycle changed",
    },
  },
};

export const DefaultTable = {
  args: {
    entries: proposalEntries,
    columns: NON_STATUS_COLUMNS,
    largeTitle: true,
    lifecycleOptions: Array.from({ length: 13 }, (_, index) => 12 - index),
    description:
      "Proposal discovery and decision support for the selected lifecycle.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalsTable {...args} />
    </TableFrame>
  ),
};

export const LoadingTable = {
  args: {
    entries: proposalEntries,
    columns: NON_STATUS_COLUMNS,
    loading: true,
    description:
      "Proposal discovery and decision support for the selected lifecycle.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalsTable {...args} />
    </TableFrame>
  ),
};

export const EmptyTable = {
  args: {
    entries: [],
    columns: NON_STATUS_COLUMNS,
    description:
      "Proposal discovery and decision support for the selected lifecycle.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalsTable {...args} />
    </TableFrame>
  ),
};

export const SingleResultTable = {
  args: {
    entries: [proposalEntries[0]!],
    columns: NON_STATUS_COLUMNS,
    description: "Focused result state for a highly filtered lifecycle view.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalsTable {...args} />
    </TableFrame>
  ),
};

export const CompactColumnsTable = {
  args: {
    entries: proposalEntries,
    columns: ["title", "createdAt"],
    description:
      "Compact lifecycle view with only the most important proposal columns.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalsTable {...args} />
    </TableFrame>
  ),
};

export const ProposalPeriodTable = {
  args: {
    entries: proposalPeriodEntries,
    description:
      "Proposal intake focused on submitted drafts and review readiness.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryProposalPeriodTable {...args} />
    </TableFrame>
  ),
};

export const ExplorationPeriodTable = {
  args: {
    entries: proposalEntries.filter((entry) => entry.period === "Exploration"),
    description:
      "Exploration review focused on active candidates before formal voting opens.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryExplorationPeriodTable {...args} />
    </TableFrame>
  ),
};

export const VotingPeriodTable = {
  args: {
    entries: proposalEntries.filter((entry) => entry.period === "Voting"),
    description: "Voting view with a yay, nay, abstain split.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryVotingPeriodTable {...args} />
    </TableFrame>
  ),
};

export const CooldownPeriodTable = {
  args: {
    entries: proposalEntries.filter((entry) => entry.period === "Cooldown"),
    description:
      "Post-vote results view that keeps the final vote split visible.",
  } satisfies TreasuryProposalsTableProps,
  render: (args: TreasuryProposalsTableProps) => (
    <TableFrame>
      <TreasuryCooldownPeriodTable {...args} />
    </TableFrame>
  ),
};

function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[92rem]">{children}</div>
    </div>
  );
}
