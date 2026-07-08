import { type JSX, type ReactNode, useState } from "react";
import { TreasuryTransactionFlowDialog } from "../transactions/transaction-flow-dialog";
import {
  TreasuryProposalDetail,
  type TreasuryProposalDetailProposal,
  type TreasuryProposalExecutionRow,
  type TreasuryProposalVoteRow,
} from "./proposal-detail";

const passingProposalContents = `# Zero-knowledge education grants for emerging regions

## Summary

This proposal requests funding for a six-month education program focused on growing high-quality zero-knowledge and Mina governance contributors in underserved regions. The program combines local workshops, translated learning materials, and mentor-led working sessions so participants can progress from fundamentals to practical ecosystem contribution.

## Problem statement

Teams in emerging regions consistently report the same bottlenecks:

- limited access to advanced technical workshops in local time zones
- few translated materials for governance and zkApp development
- weak follow-through after introductory hackathons
- not enough direct pathways into long-term ecosystem contribution

Without a coordinated program, community momentum tends to dissipate after one-off events.

## Proposed work

We will deliver a structured program across three tracks:

### 1. Foundational workshops

- 8 live workshops covering Mina architecture, governance, o1js basics, and proposal flows
- 2 cohort-based study groups with regional facilitators
- recorded sessions published within 72 hours

### 2. Translated curriculum

- translation of core learning modules into 3 target languages
- glossary for governance and zero-knowledge terminology
- lightweight facilitator guides for local organizers

### 3. Delegate and contributor onboarding

- office hours for proposal authors and first-time delegates
- review sessions for draft proposals before submission
- contributor matching with ecosystem teams for follow-up work

> The goal is not only attendance, but a measurable increase in qualified contributors who remain active after the education cycle ends.

## Milestones

### Milestone A: Program setup

- finalize regional partners
- publish curriculum calendar
- onboard translators and facilitators

### Milestone B: Delivery

- run all scheduled workshops
- publish translated materials
- host recurring office hours

### Milestone C: Ecosystem handoff

- identify high-signal contributors
- connect participants to governance and technical teams
- publish final impact report

## Budget breakdown

- 60,000 MINA for facilitator and curriculum contributor compensation
- 25,000 MINA for translation and editorial review
- 20,000 MINA for regional operations and community coordination
- 15,000 MINA for follow-up office hours, reporting, and contributor placement

## Success metrics

- at least 250 total workshop participants
- at least 120 learners completing two or more sessions
- at least 40 delegates or contributors participating in office hours
- at least 15 participants continuing into ongoing ecosystem contribution

## Reporting

Monthly updates will include attendance, material publication status, office-hours participation, and downstream contribution outcomes. A final report will summarize delivery against milestones, lessons learned, and recommendations for future regional programs.
`;

const passingProposal: TreasuryProposalDetailProposal = {
  id: "P-130",
  title: "Zero-knowledge education grants for emerging regions",
  lifecycleId: 12,
  proposalAddress: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
  proposer: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
  recipient: "B62qrecipientPassExample111111111111111111111111111111111",
  requestedAmount: "120,000 MINA",
  stage: "Voting",
  period: "Voting",
  createdAt: "2026-04-01T14:32:00.000Z",
  updatedAt: "2026-04-02T11:10:00.000Z",
  createdAtBlock: 450920,
  createdAtBlockTimestamp: "2026-04-01T14:32:00.000Z",
  zkAppUriHash: "jxd4rzzq0r4x8n88v4c1xv7c1c2kpyz0j9f8v0w9a2n7w6m0k1",
  stakingEpochDataLedgerHash: "jxledgerhash12pass0000000000000000000000000000000000",
  stakingEpochDataLedgerTotalCurrency: "400000",
  requiredParticipationBp: "2000",
  requiredApprovalBp: "5100",
  requiredParticipation: "80000",
  paidOutAmount: "0 MINA",
  contents: passingProposalContents,
  latestVoteTally: {
    blockHeight: 450920,
    yayWeight: "182450",
    nayWeight: "38120",
    abstainWeight: "9200",
    createdByEventType: "proposalVoteDispatched",
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5100",
    requiredParticipation: "80000",
    totalParticipatingVotes: "229770",
    approvalBp: "8270",
    voteResult: "approved",
  },
};

const passingVotes: TreasuryProposalVoteRow[] = [
  {
    id: "vote-1",
    voterPublicKey: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
    vote: "yay",
    voteWeight: "92450",
    blockHeight: 450918,
    status: "Counted",
  },
  {
    id: "vote-2",
    voterPublicKey: "B62qvoter2222222222222222222222222222222222222222222222",
    vote: "nay",
    voteWeight: "38120",
    blockHeight: 450919,
    status: "Counted",
  },
  {
    id: "vote-3",
    voterPublicKey: "B62qvoter3333333333333333333333333333333333333333333333",
    vote: "abstain",
    voteWeight: "9200",
    blockHeight: 450920,
    status: "Counted",
  },
];

const passedExecutions: TreasuryProposalExecutionRow[] = [
  {
    id: "execution-1",
    recipient: "B62qrecipientPassExample111111111111111111111111111111111",
    amountToPayOut: "80,000 MINA",
    bondAmount: "5,000 MINA",
    senderPublicKey: "B62qsenderPassExample1111111111111111111111111111111111111",
    paidOutAmount: "80,000 MINA",
    remainingAmount: "40,000 MINA",
    blockHeight: 451010,
    status: "Partially executed",
  },
];

const failedProposal: TreasuryProposalDetailProposal = {
  ...passingProposal,
  id: "P-127",
  title: "Governance mentorship office hours pilot",
  lifecycleId: 10,
  proposalAddress: "B62qvH7f5Jj2mY1gQ4nH8rM6xW2cK9dL5sP3tN7qR4vB8zX6uC1eFa",
  recipient: "B62qrecipientFailExample111111111111111111111111111111111",
  requestedAmount: "40,000 MINA",
  stage: "Voting",
  period: "Cooldown",
  createdAt: "2026-03-26T13:40:00.000Z",
  updatedAt: "2026-03-28T09:15:00.000Z",
  createdAtBlock: 450310,
  createdAtBlockTimestamp: "2026-03-26T13:40:00.000Z",
  paidOutAmount: "0 MINA",
  contents:
    "## Overview\n\nA mentorship and office-hours program for governance contributors.\n\n## Outcome\n\nParticipation remained below the required threshold.",
  stakingEpochDataLedgerTotalCurrency: "250000",
  requiredParticipationBp: "2000",
  requiredApprovalBp: "5500",
  requiredParticipation: "50000",
  latestVoteTally: {
    blockHeight: 450355,
    yayWeight: "0",
    nayWeight: "0",
    abstainWeight: "0",
    createdByEventType: "proposalVotesTallied",
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5500",
    requiredParticipation: "50000",
    totalParticipatingVotes: "0",
    approvalBp: "0",
    voteResult: null,
  },
};

const newProposal: TreasuryProposalDetailProposal = {
  ...passingProposal,
  id: "P-132",
  title: "Treasury participation incentives for delegate onboarding",
  lifecycleId: 12,
  proposalAddress: "B62qnS6u4m8Noy1T3YcJY5sQ8g7vPhHh9YwJm8rW2pQk7vL2e8DmKq1",
  proposer: "B62qnS6u4m8Noy1T3YcJY5sQ8g7vPhHh9YwJm8rW2pQk7vL2e8DmKq1",
  recipient: "B62qrecipientNew1111111111111111111111111111111111111111",
  requestedAmount: "72,000 MINA",
  stage: "Submitted",
  period: "Proposal",
  createdAt: "2026-04-10T16:30:00.000Z",
  updatedAt: "2026-04-10T16:30:00.000Z",
  createdAtBlock: 451804,
  createdAtBlockTimestamp: "2026-04-10T16:30:00.000Z",
  zkAppUriHash: "jxnewproposalhash000000000000000000000000000000000000000",
  stakingEpochDataLedgerHash: "jxledgerhash12new000000000000000000000000000000000000",
  stakingEpochDataLedgerTotalCurrency: "280000",
  requiredParticipationBp: "2000",
  requiredApprovalBp: "5100",
  requiredParticipation: "56000",
  paidOutAmount: "0 MINA",
  contents:
    "# Treasury participation incentives for delegate onboarding\n\n## Summary\n\nThis proposal funds a lightweight program to help new delegates become effective participants earlier in the lifecycle.\n\n## Deliverables\n\n- delegate education sessions\n- coordination support for first-time participants\n- transparent monthly reporting",
  latestVoteTally: undefined,
};

const proposalMissingContent: TreasuryProposalDetailProposal = {
  ...newProposal,
  contents: null,
};

const passedProposalReadyForPayout: TreasuryProposalDetailProposal = {
  ...passingProposal,
  id: "P-128",
  title: "Delegation tooling and wallet UX improvements",
  lifecycleId: 11,
  proposalAddress: "B62qrEhYL7zPNxZ3Srnrw9KoXwJKvt5TF13z5tqofZiqKqp4osbzYXF",
  stage: "Passed",
  period: "Executed",
  requestedAmount: "82,500 MINA",
  paidOutAmount: "22,500 MINA",
  latestVoteTally: {
    ...passingProposal.latestVoteTally!,
    createdByEventType: "proposalVotesTallied",
    voteResult: "approved",
  },
};

const pausedProposal: TreasuryProposalDetailProposal = {
  ...passedProposalReadyForPayout,
  isPaused: true,
};

const onLifecycleClick = () => {};

export default {
  title: "Treasury/ProposalDetail",
  component: TreasuryProposalDetail,
  parameters: {
    layout: "fullscreen",
  },
};

export const VotingDetail = {
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passingProposal}
        votes={passingVotes}
        executions={passedExecutions}
        contentVerificationStatus="verified"
        onLifecycleClick={onLifecycleClick}
        onVoteYayClick={() => {}}
        onVoteNayClick={() => {}}
        onVoteAbstainClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const FailedDetail = {
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={failedProposal}
        votes={[]}
        executions={[]}
        onLifecycleClick={onLifecycleClick}
      />
    </StoryFrame>
  ),
};

export const NewProposalDetail = {
  name: "New Proposal Detail",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={newProposal}
        votes={[]}
        executions={[]}
        contentVerificationStatus="loading"
        hasConnectedWallet={false}
        onLifecycleClick={onLifecycleClick}
        onConnectWalletClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const MissingContentRetryAvailable = {
  name: "New Proposal Detail / Content Retry Available",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={proposalMissingContent}
        votes={[]}
        executions={[]}
        contentVerificationStatus="retryable"
        canRetryContentSubmission
        onLifecycleClick={onLifecycleClick}
        onRetryContentSubmission={() => {}}
      />
    </StoryFrame>
  ),
};

export const MissingContentRetrying = {
  name: "New Proposal Detail / Content Retrying",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={proposalMissingContent}
        votes={[]}
        executions={[]}
        contentVerificationStatus="retryable"
        canRetryContentSubmission
        isRetryingContentSubmission
        contentRetryLastAttemptAt="2026-04-10T16:42:00.000Z"
        onLifecycleClick={onLifecycleClick}
        onRetryContentSubmission={() => {}}
      />
    </StoryFrame>
  ),
};

export const MissingContentRetryFailed = {
  name: "New Proposal Detail / Content Retry Failed",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={proposalMissingContent}
        votes={[]}
        executions={[]}
        contentVerificationStatus="retryable"
        canRetryContentSubmission
        contentRetryLastAttemptAt="2026-04-10T16:42:00.000Z"
        contentRetryError="Timed out submitting proposal contents while waiting for the proposal to be indexed."
        onLifecycleClick={onLifecycleClick}
        onRetryContentSubmission={() => {}}
      />
    </StoryFrame>
  ),
};

export const VotingDetailDisconnectedWallet = {
  name: "Voting Detail / Connect Wallet",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passingProposal}
        votes={passingVotes}
        executions={passedExecutions}
        contentVerificationStatus="verified"
        hasConnectedWallet={false}
        onLifecycleClick={onLifecycleClick}
        onConnectWalletClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const VotingDetailZeroVotingWeight = {
  name: "Voting Detail / Zero Voting Weight",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passingProposal}
        votes={passingVotes}
        executions={passedExecutions}
        contentVerificationStatus="verified"
        hasConnectedWallet
        connectedWalletVotingWeight="0"
        onLifecycleClick={onLifecycleClick}
        onVoteYayClick={() => {}}
        onVoteNayClick={() => {}}
        onVoteAbstainClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const PassedDetailReadyForPayout = {
  name: "Passed Detail / Ready For Payout",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passedProposalReadyForPayout}
        votes={passingVotes}
        executions={[]}
        contentVerificationStatus="verified"
        onLifecycleClick={onLifecycleClick}
        onExecutePayoutClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const PassedDetailConnectWalletForPayout = {
  name: "Passed Detail / Connect Wallet For Payout",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passedProposalReadyForPayout}
        votes={passingVotes}
        executions={[]}
        contentVerificationStatus="verified"
        hasConnectedProposerWallet={false}
        onLifecycleClick={onLifecycleClick}
        onConnectProposerWalletClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const PausedDetail = {
  name: "Paused Detail",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={pausedProposal}
        votes={passingVotes}
        executions={[]}
        contentVerificationStatus="verified"
        onLifecycleClick={onLifecycleClick}
        onExecutePayoutClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const VotingDetailContentVerifying = {
  name: "Voting Detail / Content Verifying",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passingProposal}
        votes={passingVotes}
        executions={passedExecutions}
        contentVerificationStatus="loading"
        onLifecycleClick={onLifecycleClick}
        onVoteYayClick={() => {}}
        onVoteNayClick={() => {}}
        onVoteAbstainClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const VotingDetailContentMismatch = {
  name: "Voting Detail / Content Mismatch",
  render: () => (
    <StoryFrame>
      <TreasuryProposalDetail
        proposal={passingProposal}
        votes={passingVotes}
        executions={passedExecutions}
        contentVerificationStatus="mismatch"
        onLifecycleClick={onLifecycleClick}
        onVoteYayClick={() => {}}
        onVoteNayClick={() => {}}
        onVoteAbstainClick={() => {}}
      />
    </StoryFrame>
  ),
};

export const VotingDetailWithTransactionFlow = {
  name: "Voting Detail / Transaction Flow",
  render: () => <VoteTransactionStory />,
};

export const PassedDetailWithTransactionFlow = {
  name: "Passed Detail / Execution Transaction Flow",
  render: () => <ExecuteTransactionStory />,
};

function StoryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[92rem]">{children}</div>
    </div>
  );
}

function VoteTransactionStory(): JSX.Element {
  const [selectedVote, setSelectedVote] = useState<"Yay" | "Nay" | "Abstain" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openVoteDialog = (vote: "Yay" | "Nay" | "Abstain"): void => {
    setSelectedVote(vote);
    setDialogOpen(true);
  };

  return (
    <StoryFrame>
      <>
        <TreasuryProposalDetail
          proposal={passingProposal}
          votes={passingVotes}
          executions={passedExecutions}
          contentVerificationStatus="verified"
          connectedWalletVotingWeight="182450"
          onLifecycleClick={onLifecycleClick}
          onVoteYayClick={() => openVoteDialog("Yay")}
          onVoteNayClick={() => openVoteDialog("Nay")}
          onVoteAbstainClick={() => openVoteDialog("Abstain")}
        />

        <TreasuryTransactionFlowDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kind="vote"
          senderAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
          transactionDetailsCode={`{
  feePayer: {
    body: {
      publicKey: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      fee: "100000000",
      nonce: "34"
    }
  },
  accountUpdates: [
    {
      publicKey: "${passingProposal.proposalAddress ?? "-"}",
      update: { voteState: ["${selectedVote ?? "-"}", "182450000000"] },
      authorizationKind: "proof"
    }
  ]
}`}
          submitLabel="Cast vote transaction"
          summaryItems={[
            { label: "Proposal", value: passingProposal.id },
            { label: "Vote", value: selectedVote ?? "-" },
            { label: "Voting weight", value: "182,450 MINA" },
            { label: "Proposal address", value: passingProposal.proposalAddress ?? "-", mono: true },
          ]}
          onCompile={() => delay(1400)}
          onProve={() => delay(1500)}
          onSignAndSend={async () => {
            await delay(1200);
            return {
              hash: "5JuDvoteHash111111111111111111111111111111111111111111111",
            };
          }}
          onWaitForInclusion={async ({ hash }) => {
            await delay(3200);
            return {
              hash,
              blockHeight: 452042,
            };
          }}
        />
      </>
    </StoryFrame>
  );
}

function ExecuteTransactionStory(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  const payoutAmount = "132000";

  return (
    <StoryFrame>
      <>
        <TreasuryProposalDetail
          proposal={passedProposalReadyForPayout}
          votes={passingVotes}
          executions={[]}
          contentVerificationStatus="verified"
          onLifecycleClick={onLifecycleClick}
          onExecutePayoutClick={() => setDialogOpen(true)}
        />

        <TreasuryTransactionFlowDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kind="executeProposal"
          senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
          transactionDetailsCode={`{
  feePayer: {
    body: {
      publicKey: "B62qrecipientPassExample111111111111111111111111111111111",
      fee: "100000000",
      nonce: "21"
    }
  },
  accountUpdates: [
    {
      publicKey: "${passedProposalReadyForPayout.proposalAddress ?? "-"}",
      update: { actionState: ["execute"] },
      authorizationKind: "proof"
    },
    {
      publicKey: "${passedProposalReadyForPayout.recipient ?? "-"}",
      update: { balanceChange: "132000000000" },
      authorizationKind: "none"
    }
  ]
}`}
          submitLabel="Execute payout transaction"
          summaryItems={[
            { label: "Proposal", value: passedProposalReadyForPayout.id },
            { label: "Recipient", value: passedProposalReadyForPayout.recipient ?? "-", mono: true },
            { label: "Amount to pay out", value: `${formatAmount(payoutAmount)} MINA` },
            { label: "Remaining after payout", value: "0 MINA" },
          ]}
          onCompile={() => delay(1400)}
          onProve={() => delay(1500)}
          onSignAndSend={async () => {
            await delay(1200);
            return {
              hash: "5JuDexecuteHash11111111111111111111111111111111111111111",
            };
          }}
          onWaitForInclusion={async ({ hash }) => {
            await delay(3200);
            return {
              hash,
              blockHeight: 452043,
            };
          }}
        />
      </>
    </StoryFrame>
  );
}

function formatAmount(value: string): string {
  const numericValue = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(numericValue)) {
    return value;
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(numericValue);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
