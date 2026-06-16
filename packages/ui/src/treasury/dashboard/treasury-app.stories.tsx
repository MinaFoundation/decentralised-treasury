import { type JSX, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import automatedDemoCursorPngUrl from "./automated-demo-cursor.png";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
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
  TreasuryVotingPeriodTable,
  TreasuryCooldownPeriodTable,
  TreasuryExplorationPeriodTable,
  TreasuryProposalPeriodTable,
  TreasuryProposalsTable,
  type TreasuryProposalLatestVoteTally,
  type TreasuryProposalTableEntry,
} from "../proposals/proposals-table";
import {
  TreasuryProposalDetail,
  type TreasuryProposalDetailProposal,
  type TreasuryProposalDetailProps,
  type TreasuryProposalExecutionRow,
  type TreasuryProposalVoteRow,
} from "../proposals/proposal-detail";
import {
  TreasuryProposalCreationForm,
  type TreasuryProposalCreationDraft,
} from "../proposals/proposal-creation-form";
import {
  TreasuryTransactionFlowDialog,
  type TreasuryTransactionSummaryItem,
} from "../transactions/transaction-flow-dialog";

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
  "stakingEpochDataLedgerTotalCurrency" | "requiredParticipationBp" | "requiredApprovalBp"
> {
  return {
    stakingEpochDataLedgerTotalCurrency,
    requiredParticipationBp,
    requiredApprovalBp,
  };
}

const allProposalEntries: TreasuryProposalTableEntry[] = [
  {
    id: "P-126",
    title: "Regional governance ambassadors and office-hours expansion",
    lifecycleId: 12,
    proposalAddress: "B62qg8Aw7sX4mQ2kHy5rP9vJ3nWd6cF1tL8yR2uK6pN4bV7zC3dMx2",
    proposer: "B62qg8Aw7sX4mQ2kHy5rP9vJ3nWd6cF1tL8yR2uK6pN4bV7zC3dMx2",
    requestedAmount: "96,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-30T12:05:00.000Z",
    createdAtBlock: 450700,
    ...createProposalVotingRequirements("360000", "2200", "5600"),
    requiredParticipation: "79200",
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVoteDispatched",
      "154880",
      "28420",
      "6160",
      450700,
    ),
  },
  {
    id: "P-132",
    title: "Treasury participation incentives for delegate onboarding",
    lifecycleId: 12,
    proposalAddress: "B62qnS6u4m8Noy1T3YcJY5sQ8g7vPhHh9YwJm8rW2pQk7vL2e8DmKq1",
    proposer: "B62qnS6u4m8Noy1T3YcJY5sQ8g7vPhHh9YwJm8rW2pQk7vL2e8DmKq1",
    requestedAmount: "72,000 MINA",
    stage: "Submitted",
    period: "Proposal",
    createdAt: "2026-04-10T16:30:00.000Z",
    createdAtBlock: 451804,
    ...createProposalVotingRequirements("280000", "2000", "5100"),
    requiredParticipation: "56000",
  },
  {
    id: "P-131",
    title: "Protocol explainer series for governance delegates",
    lifecycleId: 12,
    proposalAddress: "B62qjM7v4aQf8pR2kHy6oL5vN2xWm3sC7dF9qT4uK8pY1mB5rV6cLh9",
    proposer: "B62qjM7v4aQf8pR2kHy6oL5vN2xWm3sC7dF9qT4uK8pY1mB5rV6cLh9",
    requestedAmount: "54,000 MINA",
    stage: "Active review",
    period: "Exploration",
    createdAt: "2026-04-09T09:45:00.000Z",
    createdAtBlock: 451690,
    ...createProposalVotingRequirements("300000", "2000", "5500"),
    requiredParticipation: "60000",
  },
  {
    id: "P-130",
    title: "Zero-knowledge education grants for emerging regions",
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
    id: "P-129",
    title: "Core protocol developer residency extension",
    lifecycleId: 12,
    proposalAddress: "B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri",
    proposer: "B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri",
    requestedAmount: "300,000 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-31T09:18:00.000Z",
    createdAtBlock: 450811,
    ...createProposalVotingRequirements("420000", "2500", "6000"),
    latestVoteTally: createLatestVoteTally(
      "rejected",
      "proposalVoteDispatched",
      "120400",
      "149100",
      "6400",
      450811,
    ),
  },
  {
    id: "P-134",
    title: "Treasury design system accessibility pass",
    lifecycleId: 13,
    proposalAddress: "B62qmYHbjp4oDCNRNgHf1YLPQWQkVZ49Q6DLXmA9UdoERa9q29piAAo",
    proposer: "B62qmYHbjp4oDCNRNgHf1YLPQWQkVZ49Q6DLXmA9UdoERa9q29piAAo",
    requestedAmount: "42,000 MINA",
    stage: "Submitted",
    period: "Proposal",
    createdAt: "2026-04-10T09:12:00.000Z",
    createdAtBlock: 451731,
  },
  {
    id: "P-133",
    title: "Regional builder workshops for zkApp onboarding",
    lifecycleId: 13,
    proposalAddress: "B62qiYg67MzbxgsHv9EPxANUk9EyKWLdPFVc6sdvECF2ktZoguHRRbg",
    proposer: "B62qiYg67MzbxgsHv9EPxANUk9EyKWLdPFVc6sdvECF2ktZoguHRRbg",
    requestedAmount: "65,000 MINA",
    stage: "Draft",
    period: "Proposal",
    createdAt: "2026-04-09T17:48:00.000Z",
    createdAtBlock: 451642,
  },
  {
    id: "P-135",
    title: "Treasury reporting pipeline hardening",
    lifecycleId: 13,
    proposalAddress: "B62qmKLqCjz7j4Wj1yodmsr9xDtGaiMz538NMY39D9dpukZJtEmsSFr",
    proposer: "B62qmKLqCjz7j4Wj1yodmsr9xDtGaiMz538NMY39D9dpukZJtEmsSFr",
    requestedAmount: "98,000 MINA",
    stage: "Ready for review",
    period: "Proposal",
    createdAt: "2026-04-08T11:25:00.000Z",
    createdAtBlock: 451517,
  },
  {
    id: "P-136",
    title: "Community regional events and ambassador funding",
    lifecycleId: 14,
    proposalAddress: "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB",
    proposer: "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB",
    requestedAmount: "95,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-04-13T20:14:00.000Z",
    createdAtBlock: 452062,
  },
  {
    id: "P-137",
    title: "Localized governance documentation rollout",
    lifecycleId: 14,
    proposalAddress: "B62qkBw74e5D3yZLAFTCK3yktG4TZtq4wSfjPrxKr9Psxu29oEZWpvw",
    proposer: "B62qkBw74e5D3yZLAFTCK3yktG4TZtq4wSfjPrxKr9Psxu29oEZWpvw",
    requestedAmount: "36,000 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-04-12T07:52:00.000Z",
    createdAtBlock: 451918,
  },
  {
    id: "P-128",
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
    id: "P-127",
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
    id: "P-139",
    title: "Historical community grants tranche payout",
    lifecycleId: 9,
    proposalAddress: "B62qhistoricalPayout111111111111111111111111111111111111",
    proposer: "B62qhistoricalPayout111111111111111111111111111111111111",
    requestedAmount: "65,000 MINA",
    stage: "Approved",
    period: "Historical",
    createdAt: "2026-03-18T09:10:00.000Z",
    createdAtBlock: 449390,
    ...createProposalVotingRequirements("300000", "2000", "5100"),
    requiredParticipation: "60000",
    latestVoteTally: createLatestVoteTally(
      "approved",
      "proposalVotesTallied",
      "175000",
      "42200",
      "6400",
      449430,
    ),
  },
];

const connectedWalletAccountInfo = {
  minaBalance: "284,120 MINA",
  delegatedTo: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
  votingWeight: "264,800 MINA",
} satisfies NonNullable<TreasuryWalletHeaderProps["walletAccountInfo"]>;
const AUTOMATED_DEMO_CONNECTED_VOTE_WEIGHT = "54,000 MINA";

const richEducationProposalContents = `# Zero-knowledge education grants for emerging regions

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

const proposalContentsById: Record<string, string> = {
  "P-126":
    "## Overview\n\nExpand regional governance ambassador coverage with weekly office hours.\n\n## Deliverables\n\n- ambassador stipends\n- recurring public office hours\n- contributor follow-up and reporting",
  "P-134":
    "## Overview\n\nAccessibility-focused UI polish across treasury dashboards and proposal details.\n\n## Deliverables\n\n- audit current gaps\n- improve keyboard navigation\n- document follow-up fixes",
  "P-133":
    "## Overview\n\nRegional builder workshops for onboarding first-time zkApp developers.\n\n## Deliverables\n\n- live workshops\n- starter repos\n- cohort follow-up",
  "P-135":
    "## Overview\n\nImprove treasury reporting ingestion, monitoring, and reconciliation.\n\n## Deliverables\n\n- pipeline hardening\n- alerting\n- reporting runbooks",
  "P-136":
    "## Overview\n\nExpand regional event support and ambassador-led community programming.\n\n## Deliverables\n\n- regional events\n- ambassador stipends\n- reporting cadence",
  "P-137":
    "## Overview\n\nLocalized governance documentation for high-growth regions.\n\n## Deliverables\n\n- translation updates\n- review workshops\n- published guides",
  "P-132":
    "## Overview\n\nTreasury participation incentives for delegate onboarding.\n\n## Deliverables\n\n- Coordinator grants\n- Delegate education sessions\n- Reporting and transparency updates",
  "P-131":
    "## Overview\n\nA protocol explainer series tailored for delegates.\n\n## Deliverables\n\n- Long-form articles\n- Short video explainers\n- Structured review sessions",
  "P-130": richEducationProposalContents,
  "P-129":
    "## Overview\n\nExtend the core protocol residency and delivery cadence.\n\n## Scope\n\n- Full-time engineering support\n- Governance reporting\n- Public milestone tracking",
  "P-128":
    "## Overview\n\nImprove delegation tooling and wallet UX.\n\n## Deliverables\n\n- Wallet integrations\n- Better delegation flows\n- Documentation and support",
  "P-127":
    "## Overview\n\nA mentorship and office-hours program for governance contributors.\n\n## Outcome\n\nParticipation remained below the required threshold.",
  "P-139":
    "## Overview\n\nFinal payout tranche for a historical community grants allocation.\n\n## Deliverables\n\n- final grantee disbursement\n- closeout reporting\n- archive publication",
};

const proposalRecipientsById: Record<string, string> = {
  "P-126": "B62qrecipientAmbassador1111111111111111111111111111111111",
  "P-134": "B62qrecipientA1111111111111111111111111111111111111111111",
  "P-133": "B62qrecipientB1111111111111111111111111111111111111111111",
  "P-135": "B62qrecipientC1111111111111111111111111111111111111111111",
  "P-136": "B62qrecipientD1111111111111111111111111111111111111111111",
  "P-137": "B62qrecipientE1111111111111111111111111111111111111111111",
  "P-132": "B62qrecipientNew1111111111111111111111111111111111111111",
  "P-131": "B62qrecipientExplore11111111111111111111111111111111111111",
  "P-130": "B62qrecipientPassExample111111111111111111111111111111111",
  "P-129": "B62qrecipientFailing11111111111111111111111111111111111111",
  "P-128": "B62qrecipientPassed111111111111111111111111111111111111111",
  "P-127": "B62qrecipientAbandoned111111111111111111111111111111111111",
  "P-139": "B62qrecipientHistorical11111111111111111111111111111111111",
};

const proposalVotesById: Record<string, TreasuryProposalVoteRow[]> = {
  "P-126": [
    {
      id: "P-126-v1",
      voterPublicKey: "B62qwalletless111111111111111111111111111111111111111111",
      vote: "yay",
      voteWeight: "88200",
      blockHeight: 450698,
      status: "Counted",
    },
    {
      id: "P-126-v2",
      voterPublicKey: "B62qwalletless222222222222222222222222222222222222222222",
      vote: "nay",
      voteWeight: "28420",
      blockHeight: 450699,
      status: "Counted",
    },
    {
      id: "P-126-v3",
      voterPublicKey: "B62qwalletless333333333333333333333333333333333333333333",
      vote: "yay",
      voteWeight: "66680",
      blockHeight: 450700,
      status: "Counted",
    },
  ],
  "P-130": [
    {
      id: "P-130-v1",
      voterPublicKey: "B62qoY1SU63CQR2kyU3ra38s9AD66hyLsxRx91gkpEm3Y9sUcer5x5k",
      vote: "yay",
      voteWeight: "92450",
      blockHeight: 450918,
      status: "Counted",
    },
    {
      id: "P-130-v2",
      voterPublicKey: "B62qvoter2222222222222222222222222222222222222222222222",
      vote: "yay",
      voteWeight: "90000",
      blockHeight: 450919,
      status: "Counted",
    },
    {
      id: "P-130-v3",
      voterPublicKey: "B62qvoter3333333333333333333333333333333333333333333333",
      vote: "nay",
      voteWeight: "38120",
      blockHeight: 450920,
      status: "Counted",
    },
  ],
  "P-129": [
    {
      id: "P-129-v1",
      voterPublicKey: "B62qfailing11111111111111111111111111111111111111111111",
      vote: "yay",
      voteWeight: "120400",
      blockHeight: 450810,
      status: "Counted",
    },
    {
      id: "P-129-v2",
      voterPublicKey: "B62qfailing22222222222222222222222222222222222222222222",
      vote: "nay",
      voteWeight: "149100",
      blockHeight: 450811,
      status: "Counted",
    },
  ],
  "P-128": [
    {
      id: "P-128-v1",
      voterPublicKey: "B62qpassed111111111111111111111111111111111111111111111",
      vote: "yay",
      voteWeight: "201104",
      blockHeight: 450601,
      status: "Counted",
    },
    {
      id: "P-128-v2",
      voterPublicKey: "B62qpassed222222222222222222222222222222222222222222222",
      vote: "nay",
      voteWeight: "22890",
      blockHeight: 450602,
      status: "Counted",
    },
  ],
  "P-127": [],
  "P-139": [
    {
      id: "P-139-v1",
      voterPublicKey: "B62qhistoricalvoter11111111111111111111111111111111111111",
      vote: "yay",
      voteWeight: "175000",
      blockHeight: 449429,
      status: "Counted",
    },
    {
      id: "P-139-v2",
      voterPublicKey: "B62qhistoricalvoter22222222222222222222222222222222222222",
      vote: "nay",
      voteWeight: "42200",
      blockHeight: 449430,
      status: "Counted",
    },
  ],
};

const proposalExecutionsById: Record<string, TreasuryProposalExecutionRow[]> = {
  "P-128": [
    {
      id: "P-128-e1",
      recipient: "B62qrecipientPassed111111111111111111111111111111111111111",
      amountToPayOut: "82,500 MINA",
      bondAmount: "6,000 MINA",
      paidOutAmount: "82,500 MINA",
      remainingAmount: "0 MINA",
      blockHeight: 450710,
      status: "Executed",
    },
  ],
  "P-139": [],
};

type MockProposalDetailVariant = Pick<
  TreasuryProposalDetailProps,
  "contentVerificationStatus" | "hasConnectedWallet" | "connectedWalletVotingWeight"
>;

const proposalDetailVariantById: Record<string, MockProposalDetailVariant> = {
  "P-126": {
    contentVerificationStatus: "verified",
    hasConnectedWallet: false,
  },
  "P-134": {
    contentVerificationStatus: "verified",
  },
  "P-133": {
    contentVerificationStatus: "loading",
  },
  "P-135": {
    contentVerificationStatus: "verified",
  },
  "P-136": {
    contentVerificationStatus: "verified",
  },
  "P-137": {
    contentVerificationStatus: "mismatch",
  },
  "P-132": {
    contentVerificationStatus: "loading",
    hasConnectedWallet: false,
  },
  "P-131": {
    contentVerificationStatus: "mismatch",
  },
  "P-130": {
    contentVerificationStatus: "verified",
    hasConnectedWallet: true,
    connectedWalletVotingWeight: "182450",
  },
  "P-129": {
    contentVerificationStatus: "verified",
    hasConnectedWallet: true,
    connectedWalletVotingWeight: "0",
  },
  "P-128": {
    contentVerificationStatus: "verified",
  },
  "P-127": {
    contentVerificationStatus: "verified",
  },
  "P-139": {
    contentVerificationStatus: "verified",
  },
};

export default {
  title: "Treasury/App",
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    dashboardPeriod: {
      control: "select",
      options: ["proposal", "exploration", "voting", "cooldown"],
    },
    createProposalFlowState: {
      control: "select",
      options: [
        "success",
        "compiling",
        "compileError",
        "proving",
        "proveError",
        "awaitingSignature",
        "signAndSendError",
        "waitForInclusion",
        "postContent",
        "postContentError",
      ],
    },
    voteFlowState: {
      control: "select",
      options: [
        "success",
        "compiling",
        "compileError",
        "proving",
        "proveError",
        "awaitingSignature",
        "signAndSendError",
        "waitForInclusion",
      ],
    },
    executeFlowState: {
      control: "select",
      options: [
        "success",
        "compiling",
        "compileError",
        "proving",
        "proveError",
        "awaitingSignature",
        "signAndSendError",
        "waitForInclusion",
      ],
    },
    walletConnectStatus: {
      control: "select",
      options: ["disconnected", "connecting", "connected", "error"],
    },
    walletAccountInfoLoading: {
      control: "boolean",
    },
    isAuroInstalled: {
      control: "boolean",
    },
  },
};

const defaultMockAppArgs = {
  createProposalFlowState: "success",
  voteFlowState: "success",
  executeFlowState: "success",
} satisfies Pick<
  MockTreasuryAppProps,
  "createProposalFlowState" | "voteFlowState" | "executeFlowState"
>;

export const ProposalsPage = {
  render: (): JSX.Element => (
    <StoryScaffold>
      <AppChrome
        activeNavigationItemId="proposals"
        searchResults={allProposalEntries}
        onSearchSelect={() => {}}
      >
        <div className="space-y-6 py-6">
          <TreasuryProposalsTable
            entries={allProposalEntries}
            largeTitle
            description="Cross-lifecycle proposals list with lifecycle context and derived statuses."
          />
        </div>
      </AppChrome>
    </StoryScaffold>
  ),
};

export const ClickableMockApp = {
  args: {
    dashboardPeriod: "proposal",
    scenario: "happyPath",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const Demo = {
  args: {
    dashboardPeriod: "proposal",
    scenario: "happyPath",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  parameters: {
    docs: {
      description: {
        story:
          "Interactive Demo story that starts on the dashboard and supports a full click-through from proposal creation to vote and execution.",
      },
    },
  },
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const AutomatedProposalCreationDemo = {
  args: {
    dashboardPeriod: "proposal",
    scenario: "automatedProposalDemo",
    createProposalLabel: "Create proposal",
    treasuryBalance: "24000000",
    headerTreasuryBalance: "24000000000000000",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Automated recording story that waits five seconds, creates a zkApp lending proposal, casts a Yay vote, executes payout, and ends on the paid-out proposal detail.",
      },
    },
  },
  render: (args: MockTreasuryAppProps): JSX.Element => (
    <AutomatedProposalCreationDemoStory args={args} />
  ),
};

export const ProposalPeriodApp = {
  args: {
    dashboardPeriod: "proposal",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const ExplorationPeriodApp = {
  args: {
    dashboardPeriod: "exploration",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const VotingPeriodApp = {
  args: {
    dashboardPeriod: "voting",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const CooldownPeriodApp = {
  args: {
    dashboardPeriod: "cooldown",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const DisconnectedWalletApp = {
  args: {
    dashboardPeriod: "proposal",
    walletConnectStatus: "disconnected",
    walletAddress: undefined,
    walletAccountInfo: undefined,
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const ConnectingWalletApp = {
  args: {
    dashboardPeriod: "proposal",
    walletConnectStatus: "connecting",
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const ErrorWalletApp = {
  args: {
    dashboardPeriod: "proposal",
    walletConnectStatus: "error",
    walletAddress: undefined,
    walletAccountInfo: undefined,
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const LoadingWalletAccountApp = {
  args: {
    dashboardPeriod: "proposal",
    walletConnectStatus: "connected",
    walletAccountInfoLoading: true,
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

export const InstallWalletApp = {
  args: {
    dashboardPeriod: "proposal",
    walletConnectStatus: "disconnected",
    walletAddress: undefined,
    walletAccountInfo: undefined,
    isAuroInstalled: false,
    ...defaultMockAppArgs,
  } satisfies MockTreasuryAppProps,
  render: (args: MockTreasuryAppProps): JSX.Element => <MockTreasuryApp {...args} />,
};

type MockDashboardPeriod = TreasuryLifecyclePeriodId;
type MockCreateProposalFlowState =
  | "success"
  | "compiling"
  | "compileError"
  | "proving"
  | "proveError"
  | "awaitingSignature"
  | "signAndSendError"
  | "waitForInclusion"
  | "postContent"
  | "postContentError";

type MockActionFlowState =
  | "success"
  | "compiling"
  | "compileError"
  | "proving"
  | "proveError"
  | "awaitingSignature"
  | "signAndSendError"
  | "waitForInclusion";

type MockStoryScenario = "default" | "happyPath";
type MockAutomatedStoryScenario = MockStoryScenario | "automatedProposalDemo";
type PrototypeJourneyPhase =
  | "proposal"
  | "exploration"
  | "voting"
  | "cooldown"
  | "postCooldown"
  | "executed";
type PrototypeDashboardPreviewPhase = Exclude<PrototypeJourneyPhase, "executed">;

const PROTOTYPE_DASHBOARD_PREVIEW_PHASES: PrototypeDashboardPreviewPhase[] = [
  "proposal",
  "exploration",
  "voting",
  "cooldown",
  "postCooldown",
];

type MockTransactionStageDelayMs = {
  compile: number;
  prove: number;
  signAndSend: number;
  waitForInclusion: number;
  postContent: number;
};

function resolveMockTransactionStageDelayMs(
  scenario: MockAutomatedStoryScenario,
): MockTransactionStageDelayMs {
  if (scenario === "automatedProposalDemo") {
    return {
      compile: 10800,
      prove: 11900,
      signAndSend: 3200,
      waitForInclusion: 10600,
      postContent: 5200,
    };
  }

  const delayMs = scenario === "happyPath" ? 1200 : 20;
  return {
    compile: delayMs,
    prove: delayMs,
    signAndSend: delayMs,
    waitForInclusion: delayMs,
    postContent: delayMs,
  };
}

interface MockTreasuryAppProps {
  dashboardPeriod?: MockDashboardPeriod;
  scenario?: MockAutomatedStoryScenario;
  createProposalFlowState?: MockCreateProposalFlowState;
  voteFlowState?: MockActionFlowState;
  executeFlowState?: MockActionFlowState;
  walletConnectStatus?: TreasuryWalletHeaderProps["walletConnectStatus"];
  walletAddress?: TreasuryWalletHeaderProps["walletAddress"];
  walletAccountInfo?: TreasuryWalletHeaderProps["walletAccountInfo"];
  walletAccountInfoLoading?: boolean;
  isAuroInstalled?: boolean;
  createProposalLabel?: string;
  treasuryBalance?: string;
  headerTreasuryBalance?: string;
}

const DASHBOARD_LIFECYCLE_ID_BY_PERIOD: Record<MockDashboardPeriod, number> = {
  proposal: 13,
  exploration: 14,
  voting: 12,
  cooldown: 11,
};

const DASHBOARD_LIFECYCLE_OPTIONS = Object.values(DASHBOARD_LIFECYCLE_ID_BY_PERIOD).sort(
  (left, right) => left - right,
);

function resolveDashboardLifecycleOptions(currentLifecycleId: number): number[] {
  return DASHBOARD_LIFECYCLE_OPTIONS.filter((lifecycleId) => lifecycleId <= currentLifecycleId);
}

type StoryRoute =
  | { page: "dashboard"; lifecycleId?: number }
  | { page: "proposals" }
  | {
      page: "proposal-create";
      previousPage: "dashboard" | "proposals";
      lifecycleId: number;
      draftId?: string;
    }
  | { page: "proposal-detail"; proposalId: string; previousPage: "dashboard" | "proposals" };

type SavedProposalDraft = {
  id: string;
  updatedAt: string;
  draft: TreasuryProposalCreationDraft;
};

type DemoCursorState = {
  x: number;
  y: number;
  clicking: boolean;
  moving: boolean;
  visible: boolean;
  clickKind: DemoClickKind;
};

type DemoPoint = {
  x: number;
  y: number;
};

type DemoClickKind = "button" | "input";

type DemoCursorPointRef = {
  current: DemoPoint;
};

type DemoClickOptions = {
  scrollIntoView?: boolean;
  hideCursorAfterClick?: boolean;
  clickKind?: DemoClickKind;
  onActivated?: (point: DemoPoint) => void | Promise<void>;
};

type DemoMoveOptions = {
  scrollIntoView?: boolean;
};

const AUTOMATED_DEMO_CURSOR_MIN_TRAVEL_MS = 360;
const AUTOMATED_DEMO_CURSOR_MAX_TRAVEL_MS = 980;
const AUTOMATED_DEMO_PRE_CLICK_PAUSE_MS = 520;
const AUTOMATED_DEMO_CLICK_HOLD_MS = 360;
const AUTOMATED_DEMO_INPUT_POST_CLICK_VISIBLE_MS = 170;
const AUTOMATED_DEMO_BUTTON_POST_CLICK_VISIBLE_MS = 680;
const AUTOMATED_DEMO_POST_CLICK_SETTLE_MS = 520;
const AUTOMATED_DEMO_CLICK_TOLERANCE_PX = 3;
const AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_X = 160;
const AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_Y = 120;
const AUTOMATED_DEMO_SCROLL_SETTLE_PAUSE_MS = 320;
const AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS = 1200;
const AUTOMATED_DEMO_FINAL_HOLD_MS = 3600;

const AUTOMATED_DEMO_CURSOR_PNG_URL = automatedDemoCursorPngUrl;

const AUTOMATED_ZKAPP_LENDING_PROPOSAL_CONTENT = `## Summary

This proposal requests treasury funding to build a Mina-native zkApp for collateralized lending and borrowing. The application will let users deposit supported assets as collateral, open transparent credit positions, and repay loans through account updates whose risk checks are enforced by o1js circuits instead of a centralized backend.

The first version will focus on a conservative lending market for MINA-backed borrowing. It will include provable collateral accounting, position health checks, liquidation eligibility proofs, borrower and lender dashboards, and processor-backed indexing for proposal-grade auditability.

## Motivation

Lending is one of the core primitives that made Ethereum DeFi useful: it gives builders access to working capital, lets long-term holders put idle assets to work, and creates price-discovery pressure around risk. Mina can offer a different version of this primitive by making important parts of the risk model verifiable and compact.

The goal is not to launch a high-risk money market on day one. The goal is to deliver a carefully scoped zkApp foundation that the ecosystem can review, test, and extend into additional collateral types after the initial market proves stable.

## Scope

- o1js SmartContracts for collateral deposits, borrow positions, repayments, withdrawals, and liquidation eligibility
- ZkProgram helpers for position health calculations and risk threshold checks
- a web interface for opening, monitoring, and closing lending positions
- processor integration for indexed positions, events, and user history
- testnet deployment, public demo, and operator documentation
- security review preparation with circuit notes, invariants, and threat-model documentation

## Timeline

The project is planned as a 16-week delivery cycle. The first 3 weeks cover protocol design, risk parameter modeling, and circuit architecture. Weeks 4 through 9 cover SmartContract and ZkProgram implementation, including local proving flows and integration tests. Weeks 10 through 12 cover the web app, processor indexing, and wallet transaction UX. Weeks 13 through 15 are reserved for testnet hardening, documentation, and external review preparation. Week 16 is for launch coordination, public demos, and handoff to ecosystem reviewers.

## Deliverables

- audited-ready zkApp contracts and circuit test suite
- testnet deployment with sample lending and repayment flows
- borrower and lender dashboards with clear position status
- liquidation eligibility proof flow and operator guide
- public documentation covering assumptions, limitations, and future governance hooks

## Budget

**Total requested budget:** 200,000 MINA

The budget covers protocol engineering, o1js circuit development, frontend implementation, processor integration, testing infrastructure, documentation, and external review preparation. Funds will be paid out against delivery milestones so the treasury can verify progress before the full amount is released.`;

function AutomatedProposalCreationDemoStory({
  args,
}: {
  args: MockTreasuryAppProps;
}): JSX.Element {
  const initialCursorPosition = {
    x: typeof window === "undefined" ? 520 : window.innerWidth * 0.48,
    y: typeof window === "undefined" ? 330 : window.innerHeight * 0.46,
  };
  const [showLoading, setShowLoading] = useState(true);
  const [cursorState, setCursorState] = useState<DemoCursorState>({
    x: initialCursorPosition.x,
    y: initialCursorPosition.y,
    clicking: false,
    moving: false,
    visible: false,
    clickKind: "button",
  });
  const cursorPointRef = useRef<DemoPoint>(initialCursorPosition);
  const automationStartedRef = useRef(false);

  useEffect(() => {
    document.body.classList.add("automated-proposal-demo-active");
    const loadingTimerId = window.setTimeout(() => {
      setShowLoading(false);
    }, 2600);

    return () => {
      window.clearTimeout(loadingTimerId);
      document.body.classList.remove("automated-proposal-demo-active");
    };
  }, []);

  useEffect(() => {
    if (automationStartedRef.current) {
      return;
    }
    automationStartedRef.current = true;

    let cancelled = false;
    void runAutomatedProposalDemo({
      setCursorState,
      cursorPointRef,
      isCancelled: () => cancelled,
    }).catch((error) => {
      console.error("[automated-proposal-demo] automation failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="automated-proposal-demo-root">
      <style>{AUTOMATED_PROPOSAL_DEMO_STYLES}</style>
      <div className="automated-demo-content">
        {showLoading ? (
          <AutomatedProposalDemoLoadingDashboard args={args} />
        ) : (
          <MockTreasuryApp {...args} />
        )}
      </div>
      <AutomatedDemoCursor state={cursorState} />
    </div>
  );
}

function AutomatedProposalDemoLoadingDashboard({
  args,
}: {
  args: MockTreasuryAppProps;
}): JSX.Element {
  return (
    <StoryScaffold>
      <AppChrome
        activeNavigationItemId="dashboard"
        searchResults={[]}
        createProposalLabel={args.createProposalLabel}
        treasuryBalance={args.headerTreasuryBalance}
        walletConnectStatus="connected"
        walletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        walletAccountInfo={connectedWalletAccountInfo}
        onCreateProposalClick={() => {}}
        onDashboardClick={() => {}}
        onProposalsClick={() => {}}
        onSearchSelect={() => {}}
      >
        <div className="space-y-4 py-6">
          <TreasuryLifecyclePeriodInfo
            loading
            {...buildLifecycleArgs({
              lifecycleId: 13,
              currentPeriod: "proposal",
              currentPeriodProgress: 24,
              currentSlot: 18462512,
              periodEndsIn: "1 day 18 hours",
            })}
          />
          <div className="h-px w-full bg-border/60" aria-hidden="true" />
          <TreasuryProposalPeriodTable
            entries={[]}
            loading
            description="Current lifecycle proposal period snapshot. Click a row to inspect proposal details."
          />
        </div>
      </AppChrome>
    </StoryScaffold>
  );
}

function AutomatedDemoCursor({ state }: { state: DemoCursorState }): JSX.Element {
  return (
    <div
      className="automated-demo-cursor"
      data-clicking={state.clicking ? "true" : "false"}
      data-click-kind={state.clickKind}
      data-moving={state.moving ? "true" : "false"}
      style={{
        transform: `translate3d(${state.x}px, ${state.y}px, 0)`,
        opacity: state.visible ? 1 : 0,
      }}
      aria-hidden="true"
    >
      <img
        className="automated-demo-cursor-pointer"
        src={AUTOMATED_DEMO_CURSOR_PNG_URL}
        alt=""
        draggable={false}
      />
      <div className="automated-demo-cursor-ring" />
    </div>
  );
}

async function runAutomatedProposalDemo({
  setCursorState,
  cursorPointRef,
  isCancelled,
}: {
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void;
  cursorPointRef: DemoCursorPointRef;
  isCancelled: () => boolean;
}): Promise<void> {
  await delay(5000);
  if (isCancelled()) {
    return;
  }

  await delay(AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS);
  await clickDemoElement(
    await waitForDemoElement(() => findButtonByText("Create proposal")),
    setCursorState,
    cursorPointRef,
    isCancelled,
  );

  await delay(650);
  const titleInput = await waitForDemoElement(() => findLabeledControl<HTMLInputElement>("Title"));
  await fillDemoControl(
    titleInput,
    "zkApp Lending Market",
    setCursorState,
    cursorPointRef,
    isCancelled,
    {
      cursorTarget: { xRatio: 0.06, yRatio: 0.5 },
    },
  );

  const amountInput = await waitForDemoElement(() => findLabeledControl<HTMLInputElement>("Amount"));
  await fillDemoControl(
    amountInput,
    "100000",
    setCursorState,
    cursorPointRef,
    isCancelled,
    {
      cursorTarget: { xRatio: 0.1, yRatio: 0.5 },
    },
  );
  await delay(700);

  const recipientInput = await waitForDemoElement(() => findLabeledControl<HTMLInputElement>("Recipient"));
  await fillDemoControl(
    recipientInput,
    "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
    setCursorState,
    cursorPointRef,
    isCancelled,
    {
      cursorTarget: { xRatio: 0.06, yRatio: 0.5 },
    },
  );

  const contentTextarea = await waitForDemoElement(() => findLabeledControl<HTMLTextAreaElement>("Content"));
  await waitForDemoElement(() =>
    document.querySelector<HTMLElement>(
      '[data-component="proposal-creation-markdown-write"][data-state="active"]',
    ),
  );
  await fillDemoControl(
    contentTextarea,
    AUTOMATED_ZKAPP_LENDING_PROPOSAL_CONTENT,
    setCursorState,
    cursorPointRef,
    isCancelled,
    {
      cursorTarget: { xRatio: 0.06, yRatio: 0.08 },
      inputMode: "paste",
      hideCursorAfterClick: false,
    },
  );
  await delay(250);

  await clickDemoElement(
    await waitForDemoElement(() => findButtonByText("Preview")),
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  await waitForDemoElement(() =>
    document.querySelector<HTMLElement>(
      '[data-component="proposal-creation-markdown-preview-panel"][data-state="active"] [data-component="proposal-creation-markdown-preview"]',
    ),
  );
  await delay(550);

  const createButton = await waitForDemoElement(() => {
    const form = document.querySelector("form");
    if (!form) {
      return null;
    }
    return form.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)');
  });
  await delay(180);
  await clickDemoElement(
    createButton,
    setCursorState,
    cursorPointRef,
    isCancelled,
  );

  await delay(600);
  await clickDemoModalStartButton(
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  setCursorState((current) => ({ ...current, visible: false }));
  await focusTransactionProgressForDemo(isCancelled);
  await waitForTransactionProgress(isCancelled, true);

  const votingArea = await waitForDemoElement(
    () => document.querySelector<HTMLElement>('[data-component="proposal-vote-action-area"]'),
    12000,
  );
  await scrollDemoElementIntoViewport(votingArea, isCancelled);
  await delay(AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS + 1200);

  await clickDemoElement(
    await waitForDemoElement(() => findButtonByText("Yay", votingArea)),
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  await clickDemoModalStartButton(
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  setCursorState((current) => ({ ...current, visible: false }));
  await focusTransactionProgressForDemo(isCancelled);
  await waitForTransactionProgress(isCancelled, false);
  await delay(AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS);

  const executeButton = await waitForDemoElement(() => findButtonByText("Execute proposal"), 12000);
  await delay(AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS + 1000);
  await clickDemoElement(
    executeButton,
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  await clickDemoModalStartButton(
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  setCursorState((current) => ({ ...current, visible: false }));
  await focusTransactionProgressForDemo(isCancelled);
  await waitForTransactionProgress(isCancelled, false);
  const fullyPaidOutButton = await waitForDemoElement(
    () => findButtonByText("Fully paid out", document, { includeDisabled: true }),
    12000,
  );
  await moveDemoCursorToElement(
    fullyPaidOutButton,
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
  await delay(AUTOMATED_DEMO_STORY_BEAT_PAUSE_MS);
  await delay(AUTOMATED_DEMO_FINAL_HOLD_MS);
}

function findLabeledControl<T extends HTMLElement>(label: string): T | null {
  const ariaLabeledControl = document.querySelector<T>(`[aria-label="${label}"]`);
  if (ariaLabeledControl) {
    return ariaLabeledControl;
  }

  const normalizedLabel = normalizeDemoText(label);
  const matchingLabel = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
    (labelElement) => normalizeDemoText(labelElement.textContent ?? "") === normalizedLabel,
  );
  if (!matchingLabel?.htmlFor) {
    return null;
  }

  return document.getElementById(matchingLabel.htmlFor) as T | null;
}

function findButtonByText(
  text: string,
  root: ParentNode = document,
  options: { includeDisabled?: boolean } = {},
): HTMLButtonElement | null {
  const normalizedText = text.trim().toLowerCase();
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find(
      (button) =>
        button.textContent?.trim().toLowerCase() === normalizedText &&
        (options.includeDisabled || !button.disabled),
    ) ??
    null
  );
}

async function waitForDemoElement<T extends HTMLElement>(
  resolveElement: () => T | null,
  timeoutMs = 8000,
): Promise<T> {
  const startedAt = window.performance.now();
  while (window.performance.now() - startedAt < timeoutMs) {
    const element = resolveElement();
    if (element) {
      return element;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for automated demo element.");
}

async function fillDemoControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
  isCancelled: () => boolean,
  options: {
    cursorTarget?: { xRatio?: number; yRatio?: number };
    hideCursorAfterClick?: boolean;
    inputMode?: "paste" | "type";
    scrollIntoView?: boolean;
  } = {},
): Promise<DemoPoint> {
  let inputApplied = false;
  const point = await clickDemoElement(
    element,
    setCursorState,
    cursorPointRef,
    isCancelled,
    options.cursorTarget,
    {
      ...options,
      clickKind: "input",
      hideCursorAfterClick: options.hideCursorAfterClick ?? true,
      onActivated:
        options.inputMode === "paste"
          ? () => {
              setNativeControlValue(element, "");
              element.dispatchEvent(new Event("input", { bubbles: true }));
              pasteDemoControlValue(element, value);
              inputApplied = true;
            }
          : undefined,
    },
  );
  if (isCancelled()) {
    return point;
  }
  if (!inputApplied) {
    setNativeControlValue(element, "");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await typeDemoControlValue(element, value, isCancelled);
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await delay(350);
  return point;
}

async function clickDemoElement(
  element: HTMLElement,
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
  isCancelled: () => boolean,
  cursorTarget: { xRatio?: number; yRatio?: number } = {},
  options: DemoClickOptions = {},
): Promise<DemoPoint> {
  const point = await moveDemoCursorToElement(
    element,
    setCursorState,
    cursorPointRef,
    isCancelled,
    cursorTarget,
    options,
  );
  if (isCancelled()) {
    return point;
  }
  await waitForAnimationFrames(2);
  if (!isDemoPointInsideElement(element, point)) {
    throw new Error("Automated demo cursor target drifted outside the clicked element.");
  }
  const clickKind = options.clickKind ?? "button";
  setCursorState((current) => ({ ...current, clickKind, moving: false, visible: true }));
  await delay(AUTOMATED_DEMO_PRE_CLICK_PAUSE_MS);
  setCursorState((current) => ({ ...current, clicking: true }));
  dispatchDemoPointerSequence(element, point);
  focusDemoElementWithoutScroll(element);
  await options.onActivated?.(point);
  await delay(AUTOMATED_DEMO_CLICK_HOLD_MS);
  setCursorState((current) => ({ ...current, clicking: false }));
  await delay(
    clickKind === "input"
      ? AUTOMATED_DEMO_INPUT_POST_CLICK_VISIBLE_MS
      : AUTOMATED_DEMO_BUTTON_POST_CLICK_VISIBLE_MS,
  );
  if (options.hideCursorAfterClick) {
    setCursorState((current) => ({ ...current, visible: false }));
  }
  await delay(
    options.hideCursorAfterClick
      ? Math.floor(AUTOMATED_DEMO_POST_CLICK_SETTLE_MS * 0.65)
      : AUTOMATED_DEMO_POST_CLICK_SETTLE_MS,
  );
  return point;
}

async function moveDemoCursorToElement(
  element: HTMLElement,
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
  isCancelled: () => boolean,
  cursorTarget: { xRatio?: number; yRatio?: number } = {},
  options: DemoMoveOptions = {},
): Promise<DemoPoint> {
  if (isCancelled()) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  let didScroll = false;
  if (options.scrollIntoView !== false) {
    if (!isDemoElementTargetInViewport(element)) {
      showDemoCursorAtStoredPoint(setCursorState, cursorPointRef);
      await waitForAnimationFrames(2);
    }
    didScroll = await scrollDemoElementIntoViewport(element, isCancelled);
  }
  if (didScroll && !isCancelled()) {
    await delay(AUTOMATED_DEMO_SCROLL_SETTLE_PAUSE_MS);
  }
  const elementPoint = resolveDemoElementPoint(element, cursorTarget);
  await animateDemoCursorToPoint(elementPoint, setCursorState, cursorPointRef, isCancelled);
  return elementPoint;
}

function showDemoCursorAtStoredPoint(
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
): void {
  setCursorState((current) => ({
    ...current,
    moving: false,
    visible: true,
    x: cursorPointRef.current.x,
    y: cursorPointRef.current.y,
  }));
}

async function animateDemoCursorToPoint(
  targetPoint: DemoPoint,
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
  isCancelled: () => boolean,
): Promise<void> {
  const startPoint = cursorPointRef.current;
  const distance = getDemoPointDistance(startPoint, targetPoint);
  const travelMs = resolveDemoCursorTravelMs(distance);
  const startedAt = window.performance.now();

  setCursorState((current) => ({
    ...current,
    moving: true,
    visible: true,
    x: startPoint.x,
    y: startPoint.y,
  }));

  await new Promise<void>((resolve) => {
    const tick = (now: number): void => {
      if (isCancelled()) {
        resolve();
        return;
      }

      const progress = clampDemoValue((now - startedAt) / travelMs, 0, 1);
      const easedProgress = easeInOutDemoCursor(progress);
      const nextPoint = getLinearDemoPoint(startPoint, targetPoint, easedProgress);
      cursorPointRef.current = nextPoint;

      setCursorState((current) => ({
        ...current,
        moving: true,
        visible: true,
        x: nextPoint.x,
        y: nextPoint.y,
      }));

      if (progress >= 1) {
        resolve();
        return;
      }

      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  });

  cursorPointRef.current = targetPoint;
  setCursorState((current) => ({
    ...current,
    moving: false,
    x: targetPoint.x,
    y: targetPoint.y,
  }));
}

function getDemoPointDistance(startPoint: DemoPoint, endPoint: DemoPoint): number {
  return Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
}

function resolveDemoCursorTravelMs(distance: number): number {
  return Math.round(
    clampDemoValue(
      260 + distance * 0.58,
      AUTOMATED_DEMO_CURSOR_MIN_TRAVEL_MS,
      AUTOMATED_DEMO_CURSOR_MAX_TRAVEL_MS,
    ),
  );
}

function getLinearDemoPoint(
  startPoint: DemoPoint,
  endPoint: DemoPoint,
  progress: number,
): DemoPoint {
  return {
    x: startPoint.x + (endPoint.x - startPoint.x) * progress,
    y: startPoint.y + (endPoint.y - startPoint.y) * progress,
  };
}

function easeInOutDemoCursor(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function clampDemoValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function scrollDemoElementIntoViewport(
  element: HTMLElement,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isDemoElementTargetInViewport(element)) {
    return false;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  await waitForDemoScrollToSettle(element, isCancelled);
  return true;
}

async function clickDemoModalStartButton(
  setCursorState: (updater: DemoCursorState | ((current: DemoCursorState) => DemoCursorState)) => void,
  cursorPointRef: DemoCursorPointRef,
  isCancelled: () => boolean,
): Promise<void> {
  const startButton = await waitForDemoElement(() =>
    document.querySelector<HTMLButtonElement>('[data-component="transaction-flow-start-button"]'),
  );
  await waitForAnimationFrames(2);
  await clickDemoElement(
    startButton,
    setCursorState,
    cursorPointRef,
    isCancelled,
  );
}

async function focusTransactionProgressForDemo(isCancelled: () => boolean): Promise<void> {
  const progressRow = await waitForDemoElement(
    () => document.querySelector<HTMLElement>('[data-component="transaction-flow-progress-row"]'),
    8000,
  );
  await scrollDemoElementIntoViewport(progressRow, isCancelled);
  await delay(AUTOMATED_DEMO_SCROLL_SETTLE_PAUSE_MS + 220);
}

async function waitForTransactionProgress(
  isCancelled: () => boolean,
  includesPostContentStep: boolean,
): Promise<void> {
  const steps = includesPostContentStep
    ? ["compiling", "proving", "awaitingSignature", "awaitingInclusion", "postingContent"]
    : ["compiling", "proving", "awaitingSignature", "awaitingInclusion"];

  for (const step of steps) {
    if (isCancelled()) {
      return;
    }
    const runningIcon = await waitForTransactionProgressIcon(step, isCancelled);
    if (!runningIcon) {
      return;
    }
    if (runningIcon.dataset.stepStatus === "running") {
      const completedIcon = await waitForTransactionProgressIcon(
        step,
        isCancelled,
        "completed",
      );
      if (!completedIcon) {
        return;
      }
    }
    await delay(260);
  }
}

async function waitForTransactionProgressIcon(
  step: string,
  isCancelled: () => boolean,
  status: "running-or-completed" | "completed" = "running-or-completed",
  timeoutMs = 20000,
): Promise<HTMLElement | null> {
  const startedAt = window.performance.now();
  const selector =
    status === "completed"
      ? `[data-component="transaction-flow-progress-icon"][data-step-id="${step}"][data-step-status="completed"]`
      : `[data-component="transaction-flow-progress-icon"][data-step-id="${step}"][data-step-status="running"], [data-component="transaction-flow-progress-icon"][data-step-id="${step}"][data-step-status="completed"]`;

  while (window.performance.now() - startedAt < timeoutMs) {
    if (isCancelled()) {
      return null;
    }

    const icon = document.querySelector<HTMLElement>(selector);
    if (icon) {
      return icon;
    }

    if (!document.querySelector('[role="dialog"]')) {
      return null;
    }

    await delay(100);
  }

  return null;
}

function focusDemoElementWithoutScroll(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function resolveDemoElementPoint(
  element: HTMLElement,
  cursorTarget: { xRatio?: number; yRatio?: number } = {},
): DemoPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width * (cursorTarget.xRatio ?? 0.5),
    y: rect.top + rect.height * (cursorTarget.yRatio ?? 0.5),
  };
}

function normalizeDemoText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isDemoPointInsideElement(element: HTMLElement, point: DemoPoint): boolean {
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left - AUTOMATED_DEMO_CLICK_TOLERANCE_PX &&
    point.x <= rect.right + AUTOMATED_DEMO_CLICK_TOLERANCE_PX &&
    point.y >= rect.top - AUTOMATED_DEMO_CLICK_TOLERANCE_PX &&
    point.y <= rect.bottom + AUTOMATED_DEMO_CLICK_TOLERANCE_PX
  );
}

function isDemoElementTargetInViewport(element: HTMLElement): boolean {
  const point = resolveDemoElementPoint(element);
  return (
    point.x >= AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_X &&
    point.x <= window.innerWidth - AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_X &&
    point.y >= AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_Y &&
    point.y <= window.innerHeight - AUTOMATED_DEMO_VIEWPORT_FOLLOW_MARGIN_Y
  );
}

async function waitForDemoScrollToSettle(
  element: HTMLElement,
  isCancelled: () => boolean,
  timeoutMs = 1400,
): Promise<void> {
  const startedAt = window.performance.now();
  let lastSignature = readDemoScrollSignature(element);
  let stableFrames = 0;

  while (window.performance.now() - startedAt < timeoutMs) {
    if (isCancelled()) {
      return;
    }

    await waitForAnimationFrames(1);
    const nextSignature = readDemoScrollSignature(element);
    if (nextSignature === lastSignature) {
      stableFrames += 1;
      if (stableFrames >= 6 && isDemoElementTargetInViewport(element)) {
        return;
      }
    } else {
      stableFrames = 0;
      lastSignature = nextSignature;
    }
  }
}

function readDemoScrollSignature(element: HTMLElement): string {
  const scrollableAncestors = collectDemoScrollableAncestors(element);
  return [
    `${window.scrollX}:${window.scrollY}`,
    ...scrollableAncestors.map((ancestor) => `${ancestor.scrollLeft}:${ancestor.scrollTop}`),
  ].join("|");
}

function collectDemoScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current = element.parentElement;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScrollY =
      /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
    const canScrollX =
      /(auto|scroll|overlay)/.test(style.overflowX) && current.scrollWidth > current.clientWidth;
    if (canScrollY || canScrollX) {
      ancestors.push(current);
    }
    current = current.parentElement;
  }

  return ancestors;
}

async function waitForDemoMotionToSettle(delayMs = 0): Promise<void> {
  if (delayMs > 0) {
    await delay(delayMs);
  }
  await waitForAnimationFrames(2);
}

async function waitForAnimationFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}

function setNativeControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  valueSetter?.call(element, value);
}

async function typeDemoControlValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  isCancelled: () => boolean,
): Promise<void> {
  const delayMs = element instanceof HTMLTextAreaElement ? 6 : 24;
  let currentValue = "";

  for (const character of value) {
    if (isCancelled()) {
      return;
    }
    currentValue += character;
    setNativeControlValue(element, currentValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(delayMs);
  }
}

function pasteDemoControlValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  setNativeControlValue(element, value);
  element.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    }),
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchDemoPointerSequence(element: HTMLElement, point: DemoPoint): void {
  const pointerEventInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
  };
  const mouseEventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons: 1,
    view: window,
  };

  element.dispatchEvent(new PointerEvent("pointerdown", pointerEventInit));
  element.dispatchEvent(new MouseEvent("mousedown", mouseEventInit));
  element.dispatchEvent(new PointerEvent("pointerup", { ...pointerEventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { ...mouseEventInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent("click", { ...mouseEventInit, buttons: 0 }));
}

function createAutomatedDemoVotes(proposalId: string): TreasuryProposalVoteRow[] {
  return [
    {
      id: `${proposalId}-v1`,
      voterPublicKey: "B62qdemoVoter111111111111111111111111111111111111111111",
      vote: "yay",
      voteWeight: "154000 MINA",
      blockHeight: 452101,
      status: "Counted",
    },
    {
      id: `${proposalId}-v2`,
      voterPublicKey: "B62qdemoVoter222222222222222222222222222222222222222222",
      vote: "nay",
      voteWeight: "22000 MINA",
      blockHeight: 452102,
      status: "Counted",
    },
    {
      id: `${proposalId}-v3`,
      voterPublicKey: "B62qdemoVoter333333333333333333333333333333333333333333",
      vote: "abstain",
      voteWeight: "8500 MINA",
      blockHeight: 452103,
      status: "Counted",
    },
  ];
}

const AUTOMATED_PROPOSAL_DEMO_STYLES = `
body.automated-proposal-demo-active {
  overflow-x: hidden;
  background: hsl(var(--background));
}

.automated-proposal-demo-root,
.automated-proposal-demo-root * {
  cursor: none !important;
}

.automated-proposal-demo-root {
  min-height: 100vh;
  background:
    radial-gradient(circle at 16% 8%, hsl(var(--primary) / 0.08), transparent 28rem),
    hsl(var(--background));
}

.automated-demo-content {
  box-sizing: border-box;
  min-height: 100vh;
}

.automated-proposal-demo-root main {
  gap: 1rem !important;
}

.automated-proposal-demo-root footer {
  display: none !important;
}

.automated-proposal-demo-root [data-component="treasury-header"] {
  position: static !important;
  top: auto !important;
}

.automated-proposal-demo-root [data-component="treasury-header"] > div {
  margin-top: 0 !important;
  border-color: transparent !important;
  background: hsl(var(--background)) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

.automated-proposal-demo-root form button[type="button"]:not([role="tab"]) {
  display: none !important;
}

.automated-proposal-demo-root form [aria-invalid="true"] {
  border-color: hsl(var(--input)) !important;
  box-shadow: none !important;
}

.automated-proposal-demo-root form p.text-destructive {
  display: none !important;
}

.automated-proposal-demo-root form [class*="text-muted-foreground"] {
  line-height: 1.35;
}

.automated-proposal-demo-root [data-component="proposal-creation-markdown-preview"] {
  max-height: min(42vh, 30rem);
  overflow: auto;
}

.automated-proposal-demo-active * {
  cursor: none !important;
}

.automated-proposal-demo-root *:focus,
.automated-proposal-demo-root *:focus-visible,
.automated-proposal-demo-active *:focus,
.automated-proposal-demo-active *:focus-visible,
.automated-proposal-demo-active [data-focus],
.automated-proposal-demo-active [data-state]:focus,
.automated-proposal-demo-active [data-state]:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  --tw-ring-offset-shadow: 0 0 #0000 !important;
  --tw-ring-shadow: 0 0 #0000 !important;
}

.automated-demo-cursor {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483647;
  pointer-events: none;
  transition: opacity 220ms ease;
  will-change: transform, opacity;
}

.automated-demo-cursor-pointer {
  --automated-demo-cursor-hotspot-x: 14px;
  --automated-demo-cursor-hotspot-y: 5px;
  --automated-demo-cursor-hotspot-offset-x: -14px;
  --automated-demo-cursor-hotspot-offset-y: -5px;
  position: relative;
  z-index: 2;
  display: block;
  width: 39px;
  height: 39px;
  object-fit: contain;
  filter:
    drop-shadow(1px 0 0 rgb(0 0 0 / 0.95))
    drop-shadow(-1px 0 0 rgb(0 0 0 / 0.95))
    drop-shadow(0 1px 0 rgb(0 0 0 / 0.95))
    drop-shadow(0 -1px 0 rgb(0 0 0 / 0.95))
    drop-shadow(1px 1px 0 rgb(0 0 0 / 0.9))
    drop-shadow(-1px -1px 0 rgb(0 0 0 / 0.9))
    drop-shadow(0 4px 9px rgb(0 0 0 / 0.28));
  image-rendering: auto;
  transform: translate(
    var(--automated-demo-cursor-hotspot-offset-x),
    var(--automated-demo-cursor-hotspot-offset-y)
  );
  transform-origin:
    var(--automated-demo-cursor-hotspot-x)
    var(--automated-demo-cursor-hotspot-y);
  backface-visibility: hidden;
  transition: transform 180ms ease;
  user-select: none;
}

.automated-demo-cursor-ring {
  position: absolute;
  z-index: 1;
  left: -18px;
  top: -18px;
  width: 36px;
  height: 36px;
  background: transparent;
  border: 1.5px solid rgb(15 23 42 / 0.36);
  border-radius: 999px;
  opacity: 0;
  transform: scale(0.44);
  transform-origin: center;
  box-shadow:
    0 0 0 3px rgb(255 255 255 / 0.5),
    0 8px 18px rgb(15 23 42 / 0.1);
}

.automated-demo-cursor[data-moving="true"] .automated-demo-cursor-pointer {
  transform:
    translate(
      var(--automated-demo-cursor-hotspot-offset-x),
      var(--automated-demo-cursor-hotspot-offset-y)
    )
    scale(1.1);
}

.automated-demo-cursor[data-clicking="true"] .automated-demo-cursor-pointer {
  transform:
    translate(
      var(--automated-demo-cursor-hotspot-offset-x),
      var(--automated-demo-cursor-hotspot-offset-y)
    )
    scale(0.92);
}

.automated-demo-cursor[data-clicking="true"] .automated-demo-cursor-ring {
  animation: automated-demo-click-ring 520ms ease-out;
}

.automated-demo-cursor[data-click-kind="input"][data-clicking="true"] .automated-demo-cursor-ring {
  animation-duration: 420ms;
}

@keyframes automated-demo-click-ring {
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  22% {
    opacity: 0.58;
    transform: scale(0.78);
  }
  100% {
    opacity: 0;
    transform: scale(1.16);
  }
}
`;

function MockTreasuryApp({
  dashboardPeriod = "proposal",
  scenario = "default",
  createProposalFlowState = "success",
  voteFlowState = "success",
  executeFlowState = "success",
  walletConnectStatus,
  walletAddress,
  walletAccountInfo,
  walletAccountInfoLoading = false,
  isAuroInstalled = true,
  createProposalLabel,
  treasuryBalance = "12400000",
  headerTreasuryBalance = formatWholeMinaAsNanoMinaAmount(treasuryBalance),
}: MockTreasuryAppProps): JSX.Element {
  const isHappyPathScenario = scenario === "happyPath" || scenario === "automatedProposalDemo";
  const showPrototypeJourneyControls = scenario === "happyPath";
  const transactionStageDelayMs = resolveMockTransactionStageDelayMs(scenario);
  const currentDashboardLifecycleId = DASHBOARD_LIFECYCLE_ID_BY_PERIOD[dashboardPeriod];
  const stalledStepPromiseRef = useRef<Promise<void>>(new Promise(() => {}));
  const [route, setRoute] = useState<StoryRoute>({
    page: "dashboard",
    lifecycleId: currentDashboardLifecycleId,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [createdEntries, setCreatedEntries] = useState<TreasuryProposalTableEntry[]>([]);
  const [entryOverridesById, setEntryOverridesById] = useState<
    Record<string, Partial<TreasuryProposalTableEntry>>
  >({});
  const [createdContentsById, setCreatedContentsById] = useState<Record<string, string>>({});
  const [createdRecipientsById, setCreatedRecipientsById] = useState<Record<string, string>>({});
  const [createdVotesById, setCreatedVotesById] = useState<Record<string, TreasuryProposalVoteRow[]>>({});
  const [createdExecutionsById, setCreatedExecutionsById] = useState<
    Record<string, TreasuryProposalExecutionRow[]>
  >({});
  const [savedDrafts, setSavedDrafts] = useState<SavedProposalDraft[]>([]);
  const [submissionDraft, setSubmissionDraft] = useState<TreasuryProposalCreationDraft | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [voteRequest, setVoteRequest] = useState<{
    proposalId: string;
    vote: "yay" | "nay" | "abstain";
  } | null>(null);
  const [executeRequest, setExecuteRequest] = useState<{
    proposalId: string;
    amount: string;
  } | null>(null);
  const [prototypeJourneyPhase, setPrototypeJourneyPhase] =
    useState<PrototypeJourneyPhase>("proposal");
  const [dashboardPreviewPhase, setDashboardPreviewPhase] =
    useState<PrototypeDashboardPreviewPhase>("proposal");

  useEffect(() => {
    setRoute({
      page: "dashboard",
      lifecycleId: currentDashboardLifecycleId,
    });
    setSearchQuery("");
    setCreatedContentsById({});
    setCreatedRecipientsById({});
    setEntryOverridesById({});
    setCreatedVotesById({});
    setCreatedExecutionsById({});
    setSubmissionDraft(null);
    setCreateDialogOpen(false);
    setVoteDialogOpen(false);
    setExecuteDialogOpen(false);
    setVoteRequest(null);
    setExecuteRequest(null);
    setPrototypeJourneyPhase("proposal");
    setDashboardPreviewPhase("proposal");
  }, [currentDashboardLifecycleId]);

  const proposalVotes = useMemo(
    () => ({ ...proposalVotesById, ...createdVotesById }),
    [createdVotesById],
  );
  const proposalExecutions = useMemo(
    () => ({ ...proposalExecutionsById, ...createdExecutionsById }),
    [createdExecutionsById],
  );
  const prototypeProposalId = isHappyPathScenario ? createdEntries[0]?.id ?? null : null;
  const prototypeProposalBaseEntry =
    prototypeProposalId !== null
      ? createdEntries.find((entry) => entry.id === prototypeProposalId) ?? null
      : null;
  const prototypeProposalVotes =
    prototypeProposalId !== null ? proposalVotes[prototypeProposalId] ?? [] : [];
  const prototypeProposalDisplayOverride =
    prototypeProposalBaseEntry && isHappyPathScenario
      ? buildPrototypeProposalDisplayEntry({
          entry: prototypeProposalBaseEntry,
          dashboardPreviewPhase,
          proposalJourneyPhase: prototypeJourneyPhase,
          votes: prototypeProposalVotes,
        })
      : null;
  const proposalEntries = useMemo(() => {
    const baseEntries = isHappyPathScenario
      ? allProposalEntries.filter((entry) => entry.lifecycleId !== currentDashboardLifecycleId)
      : allProposalEntries;
    return [...createdEntries, ...baseEntries].map((entry) => ({
      ...entry,
      ...(entryOverridesById[entry.id] ?? {}),
      ...(prototypeProposalDisplayOverride && entry.id === prototypeProposalDisplayOverride.id
        ? prototypeProposalDisplayOverride
        : {}),
    }));
  }, [
    createdEntries,
    currentDashboardLifecycleId,
    entryOverridesById,
    isHappyPathScenario,
    prototypeProposalDisplayOverride,
  ]);
  const proposalContents = useMemo(
    () => ({ ...proposalContentsById, ...createdContentsById }),
    [createdContentsById],
  );
  const proposalRecipients = useMemo(
    () => ({ ...proposalRecipientsById, ...createdRecipientsById }),
    [createdRecipientsById],
  );

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    return proposalEntries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(normalizedQuery) ||
        entry.proposer.toLowerCase().includes(normalizedQuery) ||
        entry.id.toLowerCase().includes(normalizedQuery) ||
        (entry.proposalAddress ?? "").toLowerCase().includes(normalizedQuery),
    );
  }, [proposalEntries, searchQuery]);

  const selectedEntry =
    route.page === "proposal-detail"
      ? proposalEntries.find((entry) => entry.id === route.proposalId) ?? null
      : null;
  const selectedDraft =
    route.page === "proposal-create" && route.draftId
      ? savedDrafts.find((draft) => draft.id === route.draftId) ?? null
      : null;
  const selectedDetailVariant: MockProposalDetailVariant = selectedEntry
    ? selectedEntry.id === prototypeProposalId && isHappyPathScenario
      ? {
          contentVerificationStatus: "verified",
          hasConnectedWallet: true,
          connectedWalletVotingWeight:
            scenario === "automatedProposalDemo"
              ? AUTOMATED_DEMO_CONNECTED_VOTE_WEIGHT
              : connectedWalletAccountInfo.votingWeight,
        }
      : proposalDetailVariantById[selectedEntry.id] ??
      (selectedEntry.id in createdContentsById
        ? {
            contentVerificationStatus: "loading",
            hasConnectedWallet: true,
          }
        : {})
    : {};
  const selectedVotes = selectedEntry ? proposalVotes[selectedEntry.id] ?? [] : [];
  const selectedExecutions = selectedEntry ? proposalExecutions[selectedEntry.id] ?? [] : [];
  const currentLifecycleId =
    route.page === "dashboard"
      ? route.lifecycleId ?? currentDashboardLifecycleId
      : route.page === "proposal-create"
        ? route.lifecycleId
        : currentDashboardLifecycleId;
  const dashboardSelectedLifecycleId = isHappyPathScenario
    ? resolveDashboardPreviewLifecycleId(dashboardPreviewPhase, currentDashboardLifecycleId)
    : currentDashboardLifecycleId;
  const currentLifecyclePeriodOverride =
    isHappyPathScenario && currentLifecycleId === dashboardSelectedLifecycleId
      ? resolveDashboardPreviewCurrentPeriod(dashboardPreviewPhase)
      : undefined;
  const currentLifecycleEntries = proposalEntries.filter((entry) => entry.lifecycleId === currentLifecycleId);
  const currentLifecyclePeriod =
    currentLifecyclePeriodOverride ?? resolveMockLifecyclePeriod(currentLifecycleEntries);
  const proposalCreationPeriod =
    isHappyPathScenario && prototypeProposalId !== null ? "exploration" : currentLifecyclePeriod;
  const prototypeUnlockedDashboardPreviewPhases = resolvePrototypeUnlockedDashboardPreviewPhases(
    prototypeProposalId !== null,
    prototypeJourneyPhase,
  );
  const canAdvancePrototypeJourney =
    isHappyPathScenario &&
    prototypeProposalId !== null &&
    resolveNextPrototypeJourneyPhase(prototypeJourneyPhase) !== null;
  const selectedDetailPrototypePhase =
    selectedEntry?.id === prototypeProposalId && isHappyPathScenario
      ? route.page === "proposal-detail" && route.previousPage === "dashboard"
        ? dashboardPreviewPhase
        : prototypeJourneyPhase === "executed"
          ? "postCooldown"
          : prototypeJourneyPhase
      : null;
  const selectedDetailStatusDerivationPeriod =
    selectedDetailPrototypePhase
      ? resolvePrototypeDetailStatusDerivationPeriod(selectedDetailPrototypePhase)
      : undefined;
  const selectedDetailEntry =
    selectedEntry?.id === prototypeProposalId && isHappyPathScenario && selectedDetailPrototypePhase
      ? buildPrototypeProposalDisplayEntry({
          entry: selectedEntry,
          dashboardPreviewPhase: selectedDetailPrototypePhase,
          proposalJourneyPhase: prototypeJourneyPhase,
          votes: selectedVotes,
        })
      : selectedEntry;
  const resolvedWalletConnectStatus =
    walletConnectStatus ??
    (selectedDetailVariant.hasConnectedWallet === false ? "disconnected" : "connected");
  const resolvedWalletAddress =
    walletAddress !== undefined
      ? walletAddress
      : resolvedWalletConnectStatus === "connected"
        ? "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        : undefined;
  const resolvedWalletAccountInfo =
    walletAccountInfo !== undefined
      ? walletAccountInfo
      : resolvedWalletConnectStatus !== "connected"
        ? undefined
        : selectedDetailVariant.hasConnectedWallet === false
          ? undefined
          : selectedDetailVariant.connectedWalletVotingWeight != null
            ? {
                ...connectedWalletAccountInfo,
                votingWeight: selectedDetailVariant.connectedWalletVotingWeight,
              }
            : connectedWalletAccountInfo;
  const dashboardCarryoverEntries =
    isHappyPathScenario &&
    dashboardPreviewPhase === "postCooldown" &&
    prototypeProposalDisplayOverride
      ? [prototypeProposalDisplayOverride]
      : [];
  const headerDraftProposals = savedDrafts.map((savedDraft) => ({
    id: savedDraft.id,
    title: extractProposalTitle(savedDraft.draft.content),
    lifecycleId: savedDraft.draft.lifecycleId,
    updatedAt: formatRelativeDraftTimestamp(savedDraft.updatedAt),
  }));
  const navigate = (nextRoute: StoryRoute): void => {
    setRoute(nextRoute);
    setSearchQuery("");
    setCreateDialogOpen(false);
    setVoteDialogOpen(false);
    setExecuteDialogOpen(false);
  };

  const openProposal = (
    entry: TreasuryProposalTableEntry,
    previousPage: "dashboard" | "proposals",
  ): void => {
    navigate({ page: "proposal-detail", proposalId: entry.id, previousPage });
  };
  const openProposalCreate = (
    previousPage: "dashboard" | "proposals",
    lifecycleId: number,
    draftId?: string,
  ): void => {
    navigate({ page: "proposal-create", previousPage, lifecycleId, draftId });
  };
  const completeCreateProposal = (draft: TreasuryProposalCreationDraft): void => {
    const createdCount = createdEntries.length;
    const nextNumericId = 200 + createdCount;
    const id = `P-${nextNumericId}`;
    const createdAt = new Date(Date.UTC(2026, 3, 11, 10, createdCount, 0)).toISOString();
    const nextCreatedAtBlock = 452000 + createdCount;
    const newEntry: TreasuryProposalTableEntry = {
      id,
      title: extractProposalTitle(draft.content),
      lifecycleId: draft.lifecycleId ?? currentDashboardLifecycleId,
      proposalAddress: `B62qdraftProposal${String(nextNumericId).padStart(4, "0")}11111111111111111111111`,
      proposer:
        draft.proposerAddress ??
        "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      requestedAmount: `${draft.amount} MINA`,
      stage: "Submitted",
      period: "Proposal",
      createdAt,
      createdAtBlock: nextCreatedAtBlock,
      ...resolveCreatedProposalVotingRequirements(draft.amount),
    };

    setCreatedEntries((current) => [newEntry, ...current]);
    if (isHappyPathScenario) {
      setPrototypeJourneyPhase(scenario === "automatedProposalDemo" ? "voting" : "proposal");
      setDashboardPreviewPhase(scenario === "automatedProposalDemo" ? "voting" : "proposal");
    }
    if (scenario === "automatedProposalDemo") {
      setCreatedVotesById((current) => ({
        ...current,
        [id]: createAutomatedDemoVotes(id),
      }));
    }
    if (route.page === "proposal-create" && route.draftId) {
      setSavedDrafts((current) => current.filter((entry) => entry.id !== route.draftId));
    }
    setCreatedContentsById((current) => ({ ...current, [id]: draft.content }));
    setCreatedRecipientsById((current) => ({ ...current, [id]: draft.recipient }));
    navigate({
      page: "proposal-detail",
      proposalId: id,
      previousPage: route.page === "proposal-create" ? route.previousPage : "proposals",
    });
  };
  const handleCreateProposalSubmit = (draft: TreasuryProposalCreationDraft): void => {
    setSubmissionDraft(draft);
    setCreateDialogOpen(true);
  };
  const handleSaveProposalDraft = (draft: TreasuryProposalCreationDraft): void => {
    const existingDraftId = route.page === "proposal-create" ? route.draftId : undefined;
    const nextDraftId =
      existingDraftId ?? `D-${200 + createdEntries.length + savedDrafts.length}`;
    const updatedAt = new Date(Date.UTC(2026, 3, 11, 10, savedDrafts.length, 0)).toISOString();

    setSavedDrafts((current) => {
      const nextSavedDraft = {
        id: nextDraftId,
        updatedAt,
        draft,
      };
      const existingIndex = current.findIndex((entry) => entry.id === nextDraftId);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = nextSavedDraft;
        return next;
      }
      return [nextSavedDraft, ...current];
    });
    navigate(
      route.page === "proposal-create" && route.previousPage === "dashboard"
        ? { page: "dashboard", lifecycleId: route.lifecycleId }
        : { page: "proposals" },
    );
  };
  const handleVoteStart = (vote: "yay" | "nay" | "abstain"): void => {
    if (!selectedEntry) {
      return;
    }
    setVoteRequest({ proposalId: selectedEntry.id, vote });
    setVoteDialogOpen(true);
  };
  const handleVoteComplete = (): void => {
    if (!selectedEntry || !voteRequest || voteRequest.proposalId !== selectedEntry.id) {
      return;
    }
    const baseVotes = createdVotesById[selectedEntry.id] ?? proposalVotesById[selectedEntry.id] ?? [];
    const nextBlockHeight = resolveNextBlockHeight(baseVotes.map((vote) => vote.blockHeight ?? null), 452100);
    const connectedVoteWeight =
      selectedDetailVariant.connectedWalletVotingWeight ?? connectedWalletAccountInfo.votingWeight;
    const nextVote: TreasuryProposalVoteRow = {
      id: `${selectedEntry.id}-v${baseVotes.length + 1}`,
      voterPublicKey: MOCK_CONNECTED_WALLET_ADDRESS,
      vote: voteRequest.vote,
      voteWeight: connectedVoteWeight,
      blockHeight: nextBlockHeight,
      status: "Counted",
    };
    const nextVotes = [...baseVotes, nextVote];
    setCreatedVotesById((current) => ({
      ...current,
      [selectedEntry.id]: nextVotes,
    }));
    if (isHappyPathScenario && selectedEntry.id === prototypeProposalId) {
      const nextPhase = scenario === "automatedProposalDemo" ? "postCooldown" : "cooldown";
      setPrototypeJourneyPhase(nextPhase);
      setDashboardPreviewPhase(nextPhase);
    } else {
      const nextVoteTally = buildVoteTallyFromVotes(selectedEntry, nextVotes, nextBlockHeight);
      setEntryOverridesById((current) => ({
        ...current,
        [selectedEntry.id]: {
          latestVoteTally: nextVoteTally,
        },
      }));
    }
    setVoteDialogOpen(false);
    setVoteRequest(null);
  };
  const handleExecuteStart = (amount: string): void => {
    if (!selectedEntry) {
      return;
    }
    setExecuteRequest({ proposalId: selectedEntry.id, amount });
    setExecuteDialogOpen(true);
  };
  const handleExecuteComplete = (): void => {
    if (!selectedEntry || !executeRequest || executeRequest.proposalId !== selectedEntry.id) {
      return;
    }
    const baseExecutions =
      createdExecutionsById[selectedEntry.id] ?? proposalExecutionsById[selectedEntry.id] ?? [];
    const requestedAmount = parseMinaDisplayValue(selectedEntry.requestedAmount) ?? 0;
    const totalPaidOut = baseExecutions.reduce((sum, execution) => {
      return sum + (parseMinaDisplayValue(execution.paidOutAmount) ?? 0);
    }, 0);
    const nextPayoutAmount = parseMinaDisplayValue(executeRequest.amount) ?? 0;
    const nextPaidOutTotal = totalPaidOut + nextPayoutAmount;
    const nextRemainingAmount = Math.max(requestedAmount - nextPaidOutTotal, 0);
    const nextBlockHeight = resolveNextBlockHeight(
      baseExecutions.map((execution) => execution.blockHeight ?? null),
      452200,
    );
    const nextExecution: TreasuryProposalExecutionRow = {
      id: `${selectedEntry.id}-e${baseExecutions.length + 1}`,
      recipient: proposalRecipients[selectedEntry.id] ?? "B62qrecipientUnknown",
      amountToPayOut: `${Number(nextPayoutAmount).toLocaleString("en-US")} MINA`,
      bondAmount: `${formatBondAmountFromNumber(requestedAmount)} MINA`,
      paidOutAmount: `${Number(nextPaidOutTotal).toLocaleString("en-US")} MINA`,
      remainingAmount: `${Number(nextRemainingAmount).toLocaleString("en-US")} MINA`,
      blockHeight: nextBlockHeight,
      status: nextRemainingAmount > 0 ? "Partially executed" : "Executed",
    };
    const nextExecutions = [nextExecution, ...baseExecutions];
    setCreatedExecutionsById((current) => ({
      ...current,
      [selectedEntry.id]: nextExecutions,
    }));
    if (isHappyPathScenario && selectedEntry.id === prototypeProposalId) {
      setPrototypeJourneyPhase("executed");
      setDashboardPreviewPhase("postCooldown");
    }
    setExecuteDialogOpen(false);
    setExecuteRequest(null);
  };
  const handleCreateDialogOpenChange = (open: boolean): void => {
    setCreateDialogOpen(open);
  };
  const handleVoteDialogOpenChange = (open: boolean): void => {
    setVoteDialogOpen(open);
  };
  const handleExecuteDialogOpenChange = (open: boolean): void => {
    setExecuteDialogOpen(open);
  };

  return (
    <StoryScaffold>
      <AppChrome
        activeNavigationItemId={route.page === "dashboard" ? "dashboard" : "proposals"}
        searchQuery={searchQuery}
        searchResults={searchResults}
        walletConnectStatus={resolvedWalletConnectStatus}
        walletAddress={resolvedWalletAddress}
        walletAccountInfo={resolvedWalletAccountInfo}
        walletAccountInfoLoading={walletAccountInfoLoading}
        isAuroInstalled={isAuroInstalled}
        createProposalLabel={createProposalLabel}
        treasuryBalance={headerTreasuryBalance}
        onDashboardClick={() =>
          navigate({ page: "dashboard", lifecycleId: dashboardSelectedLifecycleId })
        }
        onProposalsClick={() => navigate({ page: "proposals" })}
        onSearchQueryChange={setSearchQuery}
        onSearchSelect={(entry) => {
          openProposal(entry, route.page === "dashboard" ? "dashboard" : "proposals");
        }}
        onCreateProposalClick={() =>
          openProposalCreate(
            route.page === "dashboard"
              ? "dashboard"
              : route.page === "proposal-detail"
                ? route.previousPage
                : "proposals",
            currentLifecycleId,
          )
        }
        draftProposals={headerDraftProposals}
        onDraftProposalSelect={(draftId) => {
          const savedDraft = savedDrafts.find((entry) => entry.id === draftId);
          if (!savedDraft) {
            return;
          }
          openProposalCreate(
            route.page === "dashboard"
              ? "dashboard"
              : route.page === "proposal-detail"
                ? route.previousPage
                : "proposals",
            savedDraft.draft.lifecycleId ?? currentLifecycleId,
            draftId,
          );
        }}
      >
        <div className="space-y-6 py-6">
          {showPrototypeJourneyControls ? (
            <PrototypeJourneyControls
              proposalCreated={prototypeProposalId !== null}
              proposalJourneyPhase={prototypeJourneyPhase}
              dashboardPreviewPhase={dashboardPreviewPhase}
              unlockedDashboardPreviewPhases={prototypeUnlockedDashboardPreviewPhases}
              canAdvanceJourney={canAdvancePrototypeJourney}
              onAdvanceJourney={() => {
                const nextPhase = resolveNextPrototypeJourneyPhase(prototypeJourneyPhase);
                if (!nextPhase) {
                  return;
                }
                setPrototypeJourneyPhase(nextPhase);
                setDashboardPreviewPhase(nextPhase);
                if (route.page === "dashboard") {
                  navigate({
                    page: "dashboard",
                    lifecycleId: resolveDashboardPreviewLifecycleId(
                      nextPhase,
                      currentDashboardLifecycleId,
                    ),
                  });
                }
              }}
              onDashboardPreviewPhaseChange={(phase) => {
                setDashboardPreviewPhase(phase);
                if (route.page === "dashboard") {
                  navigate({
                    page: "dashboard",
                    lifecycleId: resolveDashboardPreviewLifecycleId(
                      phase,
                      currentDashboardLifecycleId,
                    ),
                  });
                }
              }}
              onResetJourney={() => {
                setRoute({ page: "dashboard", lifecycleId: currentDashboardLifecycleId });
                setSearchQuery("");
                setCreatedEntries([]);
                setEntryOverridesById({});
                setCreatedContentsById({});
                setCreatedRecipientsById({});
                setCreatedVotesById({});
                setCreatedExecutionsById({});
                setSavedDrafts([]);
                setSubmissionDraft(null);
                setCreateDialogOpen(false);
                setVoteDialogOpen(false);
                setExecuteDialogOpen(false);
                setVoteRequest(null);
                setExecuteRequest(null);
                setPrototypeJourneyPhase("proposal");
                setDashboardPreviewPhase("proposal");
              }}
            />
          ) : null}
          {route.page === "dashboard" ? (
            <div className="space-y-4">
              <DashboardPage
                lifecycleId={route.lifecycleId ?? dashboardSelectedLifecycleId}
                currentLifecycleId={dashboardSelectedLifecycleId}
                currentPeriodOverride={
                  (route.lifecycleId ?? dashboardSelectedLifecycleId) === dashboardSelectedLifecycleId
                    ? currentLifecyclePeriodOverride
                    : undefined
                }
                forceHistoricalLifecycle={
                  isHappyPathScenario &&
                  (route.lifecycleId ?? dashboardSelectedLifecycleId) < dashboardSelectedLifecycleId
                }
                carryoverEntries={
                  (route.lifecycleId ?? dashboardSelectedLifecycleId) === dashboardSelectedLifecycleId
                    ? dashboardCarryoverEntries
                    : []
                }
                entries={proposalEntries}
                onLifecycleChange={(lifecycleId) => {
                  navigate({ page: "dashboard", lifecycleId });
                }}
                onProposalClick={(entry) => {
                  openProposal(entry, "dashboard");
                }}
              />
            </div>
          ) : route.page === "proposals" ? (
            <div className="space-y-4">
              <TreasuryProposalsTable
                entries={proposalEntries}
                largeTitle
                description="Browse all proposals across lifecycles, then click through to inspect each proposal."
                onProposalClick={(entry) => {
                  openProposal(entry, "proposals");
                }}
              />
            </div>
          ) : route.page === "proposal-create" ? (
            <div className="space-y-4">
              <TreasuryProposalCreationForm
                lifecycleId={route.lifecycleId}
                currentPeriod={proposalCreationPeriod}
                connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
                treasuryBalance={treasuryBalance}
                eligibleVotingWeight="360000"
                initialContent={selectedDraft?.draft.content}
                initialAmount={selectedDraft?.draft.amount}
                initialRecipient={selectedDraft?.draft.recipient}
                onCancel={() => {
                  navigate(
                    route.previousPage === "dashboard"
                      ? { page: "dashboard", lifecycleId: route.lifecycleId }
                      : { page: "proposals" },
                  );
                }}
                onSubmit={handleCreateProposalSubmit}
                onSaveDraft={handleSaveProposalDraft}
              />
              {submissionDraft ? (
                <TreasuryTransactionFlowDialog
                  open={createDialogOpen}
                  onOpenChange={handleCreateDialogOpenChange}
                  kind="createProposal"
                  senderAddress={submissionDraft.proposerAddress ?? null}
                  transactionDetailsCode={getMockCreateProposalTransactionDetails(submissionDraft)}
                  submitLabel="Create proposal transaction"
                  preventCloseWhileRunning
                  summaryItems={buildCreateProposalSummaryItems(submissionDraft)}
                  onCompile={async () => {
                    if (createProposalFlowState === "compileError") {
                      throw new Error("Contract compilation failed.");
                    }
                    if (createProposalFlowState === "compiling") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.compile);
                  }}
                  onProve={async () => {
                    if (createProposalFlowState === "proveError") {
                      throw new Error("Proof generation failed.");
                    }
                    if (createProposalFlowState === "proving") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.prove);
                  }}
                  onSignAndSend={async () => {
                    if (createProposalFlowState === "signAndSendError") {
                      throw new Error("Auro rejected the transaction request.");
                    }
                    if (createProposalFlowState === "awaitingSignature") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.signAndSend);
                    return {
                      hash: "5JuDcreateProposalAppStoryHash11111111111111111111111111111111111",
                    };
                  }}
                  onWaitForInclusion={async ({ hash }) => {
                    if (createProposalFlowState === "waitForInclusion") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.waitForInclusion);
                    return {
                      hash,
                      blockHeight: 452041,
                    };
                  }}
                  onPostInclusion={async () => {
                    if (createProposalFlowState === "postContentError") {
                      throw new Error("Proposal content post failed.");
                    }
                    if (createProposalFlowState === "postContent") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.postContent);
                  }}
                  onComplete={() => {
                    completeCreateProposal(submissionDraft);
                    setCreateDialogOpen(false);
                    setSubmissionDraft(null);
                  }}
                />
              ) : null}
            </div>
          ) : selectedEntry ? (
            <div className="space-y-6">
              <TreasuryProposalDetail
                proposal={createDetailProposal(
                  selectedDetailEntry ?? selectedEntry,
                  proposalRecipients,
                  proposalContents,
                  proposalExecutions,
                )}
                votes={selectedVotes}
                executions={selectedExecutions}
                contentVerificationStatus={selectedDetailVariant.contentVerificationStatus}
                hasConnectedWallet={selectedDetailVariant.hasConnectedWallet}
                connectedWalletVotingWeight={selectedDetailVariant.connectedWalletVotingWeight}
                statusDerivationPeriod={selectedDetailStatusDerivationPeriod}
                onConnectWalletClick={() => {}}
                onVoteYayClick={() => {
                  handleVoteStart("yay");
                }}
                onVoteNayClick={() => {
                  handleVoteStart("nay");
                }}
                onVoteAbstainClick={() => {
                  handleVoteStart("abstain");
                }}
                onLifecycleClick={(lifecycleId) => {
                  navigate({ page: "dashboard", lifecycleId });
                }}
                onExecutePayoutClick={(amount) => {
                  handleExecuteStart(amount);
                }}
              />
              {voteRequest && voteRequest.proposalId === selectedEntry.id ? (
                <TreasuryTransactionFlowDialog
                  open={voteDialogOpen}
                  onOpenChange={handleVoteDialogOpenChange}
                  kind="vote"
                  senderAddress={MOCK_CONNECTED_WALLET_ADDRESS}
                  transactionDetailsCode={getMockVoteTransactionDetails(
                    selectedEntry,
                    voteRequest.vote,
                    selectedDetailVariant.connectedWalletVotingWeight ?? connectedWalletAccountInfo.votingWeight,
                  )}
                  submitLabel="Cast vote transaction"
                  summaryItems={buildVoteSummaryItems(
                    selectedEntry,
                    voteRequest.vote,
                    selectedDetailVariant.connectedWalletVotingWeight ?? connectedWalletAccountInfo.votingWeight,
                  )}
                  onCompile={async () => {
                    if (voteFlowState === "compileError") {
                      throw new Error("Contract compilation failed.");
                    }
                    if (voteFlowState === "compiling") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.compile);
                  }}
                  onProve={async () => {
                    if (voteFlowState === "proveError") {
                      throw new Error("Proof generation failed.");
                    }
                    if (voteFlowState === "proving") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.prove);
                  }}
                  onSignAndSend={async () => {
                    if (voteFlowState === "signAndSendError") {
                      throw new Error("Auro rejected the transaction request.");
                    }
                    if (voteFlowState === "awaitingSignature") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.signAndSend);
                    return {
                      hash: "5JuDvoteZkAppLendingMarketHash1111111111111111111111111111111",
                    };
                  }}
                  onWaitForInclusion={async ({ hash }) => {
                    if (voteFlowState === "waitForInclusion") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.waitForInclusion);
                    return {
                      hash,
                      blockHeight: 452142,
                    };
                  }}
                  onComplete={() => {
                    handleVoteComplete();
                  }}
                />
              ) : null}
              {executeRequest && executeRequest.proposalId === selectedEntry.id ? (
                <TreasuryTransactionFlowDialog
                  open={executeDialogOpen}
                  onOpenChange={handleExecuteDialogOpenChange}
                  kind="executeProposal"
                  senderAddress={selectedEntry.proposer}
                  transactionDetailsCode={getMockExecuteTransactionDetails(
                    selectedEntry,
                    executeRequest.amount,
                    proposalRecipients[selectedEntry.id] ?? "B62qrecipientUnknown",
                  )}
                  submitLabel="Execute payout transaction"
                  summaryItems={buildExecuteSummaryItems(
                    selectedEntry,
                    proposalRecipients[selectedEntry.id] ?? "B62qrecipientUnknown",
                    executeRequest.amount,
                  )}
                  onCompile={async () => {
                    if (executeFlowState === "compileError") {
                      throw new Error("Contract compilation failed.");
                    }
                    if (executeFlowState === "compiling") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.compile);
                  }}
                  onProve={async () => {
                    if (executeFlowState === "proveError") {
                      throw new Error("Proof generation failed.");
                    }
                    if (executeFlowState === "proving") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.prove);
                  }}
                  onSignAndSend={async () => {
                    if (executeFlowState === "signAndSendError") {
                      throw new Error("Auro rejected the transaction request.");
                    }
                    if (executeFlowState === "awaitingSignature") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.signAndSend);
                    return {
                      hash: "5JuDexecuteZkAppLendingMarketHash11111111111111111111111111111",
                    };
                  }}
                  onWaitForInclusion={async ({ hash }) => {
                    if (executeFlowState === "waitForInclusion") {
                      await stalledStepPromiseRef.current;
                    }
                    await delay(transactionStageDelayMs.waitForInclusion);
                    return {
                      hash,
                      blockHeight: 452243,
                    };
                  }}
                  onComplete={() => {
                    handleExecuteComplete();
                  }}
                />
              ) : null}
            </div>
          ) : (
            <MissingProposalState
              onViewAllProposals={() => navigate({ page: "proposals" })}
            />
          )}
        </div>
      </AppChrome>
    </StoryScaffold>
  );
}

function StoryScaffold({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-h-screen bg-background">{children}</div>;
}

function PrototypeJourneyControls({
  proposalCreated,
  proposalJourneyPhase,
  dashboardPreviewPhase,
  unlockedDashboardPreviewPhases,
  canAdvanceJourney,
  onAdvanceJourney,
  onDashboardPreviewPhaseChange,
  onResetJourney,
}: {
  proposalCreated: boolean;
  proposalJourneyPhase: PrototypeJourneyPhase;
  dashboardPreviewPhase: PrototypeDashboardPreviewPhase;
  unlockedDashboardPreviewPhases: PrototypeDashboardPreviewPhase[];
  canAdvanceJourney: boolean;
  onAdvanceJourney: () => void;
  onDashboardPreviewPhaseChange: (phase: PrototypeDashboardPreviewPhase) => void;
  onResetJourney: () => void;
}): JSX.Element {
  const nextJourneyPhase = resolveNextPrototypeJourneyPhase(proposalJourneyPhase);

  return (
    <Card className="border-primary/20 bg-primary/[0.03] shadow-none">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">Demo controls</CardTitle>
            <CardDescription className="max-w-3xl text-[15px] leading-6 text-foreground/70">
              Click through the full treasury prototype flow, then preview how the dashboard looks
              across the lifecycle stages without introducing any extra proposals.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onResetJourney}>
            Reset demo
          </Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-foreground/85">
            Proposal journey:{" "}
            <span className="font-medium">{resolvePrototypeJourneyPhaseLabel(proposalJourneyPhase)}</span>
          </p>
          {!proposalCreated ? (
            <p className="text-sm text-muted-foreground">
              Start by creating a proposal from the dashboard.
            </p>
          ) : canAdvanceJourney && nextJourneyPhase ? (
            <Button type="button" size="sm" onClick={onAdvanceJourney}>
              Advance to {resolvePrototypeJourneyPhaseLabel(nextJourneyPhase)}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Continue with vote or execute directly from the proposal detail page.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Dashboard preview
          </p>
          <div className="flex flex-wrap gap-2">
            {unlockedDashboardPreviewPhases.map((phase) => (
              <Button
                key={phase}
                type="button"
                size="sm"
                variant={dashboardPreviewPhase === phase ? "default" : "outline"}
                onClick={() => {
                  onDashboardPreviewPhaseChange(phase);
                }}
              >
                {resolvePrototypeJourneyPhaseLabel(phase)}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AppChrome({
  activeNavigationItemId,
  children,
  draftProposals = [],
  searchQuery = "",
  searchResults,
  createProposalLabel,
  treasuryBalance = "12400000",
  walletConnectStatus = "connected",
  walletAddress = "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
  walletAccountInfo = connectedWalletAccountInfo,
  walletAccountInfoLoading = false,
  isAuroInstalled = true,
  onCreateProposalClick,
  onDashboardClick,
  onDraftProposalSelect,
  onProposalsClick,
  onSearchQueryChange,
  onSearchSelect,
}: {
  activeNavigationItemId: string;
  children: ReactNode;
  draftProposals?: TreasuryWalletHeaderProps["draftProposals"];
  searchQuery?: string;
  searchResults: TreasuryProposalTableEntry[];
  createProposalLabel?: TreasuryWalletHeaderProps["createProposalLabel"];
  treasuryBalance?: TreasuryWalletHeaderProps["treasuryBalance"];
  walletConnectStatus?: TreasuryWalletHeaderProps["walletConnectStatus"];
  walletAddress?: TreasuryWalletHeaderProps["walletAddress"];
  walletAccountInfo?: TreasuryWalletHeaderProps["walletAccountInfo"];
  walletAccountInfoLoading?: boolean;
  isAuroInstalled?: boolean;
  onCreateProposalClick?: TreasuryWalletHeaderProps["onCreateProposalClick"];
  onDashboardClick?: () => void;
  onDraftProposalSelect?: TreasuryWalletHeaderProps["onDraftProposalSelect"];
  onProposalsClick?: () => void;
  onSearchQueryChange?: (query: string) => void;
  onSearchSelect: (entry: TreasuryProposalTableEntry) => void;
}): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-3 sm:px-5 lg:px-6">
      <TreasuryWalletHeader
        activeNavigationItemId={activeNavigationItemId}
        className="max-w-none px-0"
        defaultSettings={{
          networkId: "MAINNET",
          apiUrl: "https://api.mina-treasury.example",
          minaNodeUrl: "https://mina-mainnet-node.example/graphql",
        }}
        walletConnectStatus={walletConnectStatus}
        walletAddress={walletAddress}
        walletAccountInfo={walletAccountInfo}
        walletAccountInfoLoading={walletAccountInfoLoading}
        isAuroInstalled={isAuroInstalled}
        createProposalLabel={createProposalLabel}
        treasuryBalance={treasuryBalance}
        draftProposals={draftProposals}
        onCreateProposalClick={onCreateProposalClick}
        onDashboardClick={onDashboardClick}
        onDraftProposalSelect={onDraftProposalSelect}
        onProposalsClick={onProposalsClick}
        proposalSearch={{
          query: searchQuery,
          onQueryChange: onSearchQueryChange ?? (() => {}),
          results: searchResults,
          onSelect: onSearchSelect,
        }}
      />

      <main className="flex w-full flex-col gap-6">{children}</main>

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
  );
}

function DashboardPage({
  lifecycleId,
  currentLifecycleId,
  currentPeriodOverride,
  forceHistoricalLifecycle = false,
  carryoverEntries = [],
  entries,
  onLifecycleChange,
  onProposalClick,
}: {
  lifecycleId: number;
  currentLifecycleId: number;
  currentPeriodOverride?: TreasuryLifecyclePeriodId;
  forceHistoricalLifecycle?: boolean;
  carryoverEntries?: TreasuryProposalTableEntry[];
  entries: TreasuryProposalTableEntry[];
  onLifecycleChange?: (lifecycleId: number) => void;
  onProposalClick: (entry: TreasuryProposalTableEntry) => void;
}): JSX.Element {
  const lifecycleEntries = entries.filter((entry) => entry.lifecycleId === lifecycleId);
  const currentPeriod = currentPeriodOverride ?? resolveMockLifecyclePeriod(lifecycleEntries);
  const isHistoricalLifecycle = forceHistoricalLifecycle || lifecycleId < currentLifecycleId;
  const currentPeriodEntries = lifecycleEntries.filter((entry) => {
    const normalizedPeriod = entry.period.toLowerCase();
    if (normalizedPeriod === currentPeriod) {
      return true;
    }
    // Keep happy-path proposals visible on the dashboard after cooldown has elapsed.
    return currentPeriod === "cooldown" && normalizedPeriod === "historical";
  });
  const displayedEntries = [...carryoverEntries, ...currentPeriodEntries];
  const lifecycleInfo = buildLifecycleArgs({
    lifecycleId,
    currentPeriod,
    currentPeriodProgress: resolveMockLifecycleProgress(currentPeriod),
    currentSlot: resolveMockLifecycleCurrentSlot(lifecycleId, currentPeriod),
    periodEndsIn: resolveMockLifecyclePeriodEndsIn(currentPeriod),
    isHistoricalLifecycle,
  });
  const TableComponent =
    currentPeriod === "proposal"
      ? TreasuryProposalPeriodTable
      : currentPeriod === "exploration"
        ? TreasuryExplorationPeriodTable
        : currentPeriod === "cooldown"
          ? TreasuryCooldownPeriodTable
          : TreasuryVotingPeriodTable;

  return (
    <>
      <TreasuryLifecyclePeriodInfo
        {...lifecycleInfo}
        lifecycleOptions={resolveDashboardLifecycleOptions(currentLifecycleId)}
        onLifecycleChange={onLifecycleChange}
      />
      <div className="h-px w-full bg-border/60" aria-hidden="true" />
      <TableComponent
        entries={displayedEntries}
        description={`Current lifecycle ${currentPeriod} period snapshot. Click a row to inspect proposal details.`}
        onProposalClick={onProposalClick}
      />
    </>
  );
}

function resolveMockLifecyclePeriod(
  entries: TreasuryProposalTableEntry[],
): TreasuryLifecyclePeriodId {
  const periodPriority: Record<TreasuryLifecyclePeriodId, number> = {
    proposal: 0,
    exploration: 1,
    voting: 2,
    cooldown: 3,
  };
  const periods = entries
    .map((entry) => entry.period.toLowerCase())
    .filter(
      (period): period is TreasuryLifecyclePeriodId =>
        period === "proposal" ||
        period === "exploration" ||
        period === "voting" ||
        period === "cooldown",
    );

  return periods.sort((left, right) => periodPriority[right] - periodPriority[left])[0] ?? "voting";
}

function resolveMockLifecycleProgress(currentPeriod: TreasuryLifecyclePeriodId): number {
  const progressByPeriod: Record<TreasuryLifecyclePeriodId, number> = {
    proposal: 24,
    exploration: 46,
    voting: 68,
    cooldown: 92,
  };

  return progressByPeriod[currentPeriod];
}

function resolveMockLifecyclePeriodEndsIn(currentPeriod: TreasuryLifecyclePeriodId): string {
  const endsInByPeriod: Record<TreasuryLifecyclePeriodId, string> = {
    proposal: "1 day 18 hours",
    exploration: "1 day 11 hours",
    voting: "1 day 4 hours",
    cooldown: "9 hours",
  };

  return endsInByPeriod[currentPeriod];
}

function resolveMockLifecycleCurrentSlot(
  lifecycleId: number,
  currentPeriod: TreasuryLifecyclePeriodId,
): number {
  const periodIndexById: Record<TreasuryLifecyclePeriodId, number> = {
    proposal: 0,
    exploration: 1,
    voting: 2,
    cooldown: 3,
  };
  const proposalStart = 18462144 + (lifecycleId - 13) * 6144;
  const periodLength = 1536;

  return proposalStart + periodLength * periodIndexById[currentPeriod] + 1044;
}

function capitalizePeriodLabel(period: TreasuryLifecyclePeriodId): "Proposal" | "Exploration" | "Voting" | "Cooldown" {
  if (period === "proposal") {
    return "Proposal";
  }
  if (period === "exploration") {
    return "Exploration";
  }
  if (period === "voting") {
    return "Voting";
  }
  return "Cooldown";
}

function formatRelativeDraftTimestamp(updatedAt: string): string {
  const updatedDate = new Date(updatedAt);
  const now = new Date(Date.UTC(2026, 3, 11, 12, 0, 0));
  const diffHours = Math.max(0, Math.round((now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60)));
  if (diffHours < 1) {
    return "Updated just now";
  }
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

function buildCreateProposalSummaryItems(
  draft: TreasuryProposalCreationDraft,
): TreasuryTransactionSummaryItem[] {
  return [
    { label: "Lifecycle", value: `Lifecycle ${draft.lifecycleId ?? "-"}` },
    { label: "Title", value: extractProposalTitle(draft.content) },
    { label: "Recipient", value: draft.recipient, mono: true },
    { label: "Amount", value: `${draft.amount} MINA` },
    { label: "Derived bond", value: `${formatBondAmount(draft.amount)} MINA` },
  ];
}

function extractProposalTitle(contents: string): string {
  const match = contents.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  return match?.[1]?.trim() || "Untitled proposal";
}

function buildVoteSummaryItems(
  entry: TreasuryProposalTableEntry,
  vote: "yay" | "nay" | "abstain",
  votingWeight: string | null | undefined,
): TreasuryTransactionSummaryItem[] {
  return [
    { label: "Proposal", value: entry.title },
    { label: "Vote", value: capitalizeVoteLabel(vote) },
    { label: "Proposal address", value: entry.proposalAddress ?? entry.id, mono: true },
    { label: "Voting weight", value: votingWeight ?? "-" },
  ];
}

function buildExecuteSummaryItems(
  entry: TreasuryProposalTableEntry,
  recipient: string,
  amount: string,
): TreasuryTransactionSummaryItem[] {
  return [
    { label: "Proposal", value: entry.title },
    { label: "Proposal address", value: entry.proposalAddress ?? entry.id, mono: true },
    { label: "Recipient wallet", value: recipient, mono: true },
    { label: "Amount to pay out", value: amount },
    { label: "Remaining after execution", value: formatRemainingAfterExecution(entry, amount) },
  ];
}

function getMockCreateProposalTransactionDetails(draft: TreasuryProposalCreationDraft): string {
  return `{
  feePayer: {
    body: {
      publicKey: "${draft.proposerAddress}",
      fee: "100000000",
      nonce: "12"
    }
  },
  accountUpdates: [
    {
      publicKey: "B62qproposalzkapp111111111111111111111111111111111111",
      update: { appState: ["${draft.lifecycleId ?? "-"}", "${draft.recipient}", "${draft.amount}"] },
      authorizationKind: "proof"
    }
  ]
}`;
}

function getMockVoteTransactionDetails(
  entry: TreasuryProposalTableEntry,
  vote: "yay" | "nay" | "abstain",
  votingWeight: string,
): string {
  return `{
  feePayer: {
    body: {
      publicKey: "${MOCK_CONNECTED_WALLET_ADDRESS}",
      fee: "100000000",
      nonce: "34"
    }
  },
  accountUpdates: [
    {
      publicKey: "${entry.proposalAddress ?? entry.id}",
      update: { voteState: ["${vote}", "${votingWeight}"] },
      authorizationKind: "proof"
    }
  ]
}`;
}

function getMockExecuteTransactionDetails(
  entry: TreasuryProposalTableEntry,
  amount: string,
  recipient: string,
): string {
  return `{
  feePayer: {
    body: {
      publicKey: "${entry.proposer}",
      fee: "100000000",
      nonce: "21"
    }
  },
  accountUpdates: [
    {
      publicKey: "${entry.proposalAddress ?? entry.id}",
      update: { actionState: ["execute", "${amount}"] },
      authorizationKind: "proof"
    },
    {
      publicKey: "${recipient}",
      update: { balanceChange: "${amount}" },
      authorizationKind: "none"
    }
  ]
}`;
}

function formatBondAmount(amount: string): string {
  const normalized = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(normalized)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.floor(normalized / 10));
}

function resolveCreatedProposalVotingRequirements(
  amount: string,
): Pick<
  TreasuryProposalTableEntry,
  | "stakingEpochDataLedgerTotalCurrency"
  | "requiredParticipationBp"
  | "requiredApprovalBp"
  | "requiredParticipation"
> {
  const proposalAmount = parseMinaDisplayValue(amount) ?? 0;
  const treasuryBalance = 24_000_000;
  const eligibleVotingWeight = 360_000;
  const basisPoints = 10_000;
  const ratioBp = Math.min((proposalAmount * basisPoints) / treasuryBalance, basisPoints);
  const participationCurveDenominator =
    ratioBp + (500 * (basisPoints - ratioBp)) / basisPoints;
  const participationCurveBp = (ratioBp * basisPoints) / participationCurveDenominator;
  const approvalCurveDenominator = ratioBp + (1000 * (basisPoints - ratioBp)) / basisPoints;
  const approvalCurveBp = (ratioBp * basisPoints) / approvalCurveDenominator;
  const requiredParticipationBp =
    2_000 + ((5_000 - 2_000) * participationCurveBp) / basisPoints;
  const requiredApprovalBp = 5_100 + ((7_000 - 5_100) * approvalCurveBp) / basisPoints;
  const requiredParticipationWeight =
    (eligibleVotingWeight * requiredParticipationBp) / basisPoints;

  return {
    stakingEpochDataLedgerTotalCurrency: `${eligibleVotingWeight} MINA`,
    requiredParticipationBp: String(requiredParticipationBp),
    requiredApprovalBp: String(requiredApprovalBp),
    requiredParticipation: `${requiredParticipationWeight} MINA`,
  };
}

function formatWholeMinaAsNanoMinaAmount(value: string): string {
  const normalized = value.replace(/[^0-9]/g, "");
  if (!normalized) {
    return value;
  }
  return (BigInt(normalized) * 1_000_000_000n).toString();
}

function formatBondAmountFromNumber(amount: number): string {
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
      }).format(Math.floor(amount / 10))
    : "-";
}

function parseMinaDisplayValue(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveNextBlockHeight(
  blockHeights: Array<number | null | undefined>,
  fallback: number,
): number {
  const maxBlockHeight = blockHeights.reduce<number>((currentMax, value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return currentMax;
    }
    return Math.max(currentMax, value);
  }, fallback - 1);
  return maxBlockHeight + 1;
}

function resolvePrototypeJourneyPhaseLabel(
  phase: PrototypeJourneyPhase | PrototypeDashboardPreviewPhase,
): string {
  if (phase === "postCooldown") {
    return "Post-cooldown";
  }
  if (phase === "executed") {
    return "Executed";
  }
  return capitalizePeriodLabel(phase);
}

function resolveNextPrototypeJourneyPhase(
  phase: PrototypeJourneyPhase,
): PrototypeDashboardPreviewPhase | null {
  if (phase === "proposal") {
    return "exploration";
  }
  if (phase === "exploration") {
    return "voting";
  }
  if (phase === "voting") {
    return "cooldown";
  }
  if (phase === "cooldown") {
    return "postCooldown";
  }
  return null;
}

function resolvePrototypeUnlockedDashboardPreviewPhases(
  proposalCreated: boolean,
  proposalJourneyPhase: PrototypeJourneyPhase,
): PrototypeDashboardPreviewPhase[] {
  if (!proposalCreated) {
    return ["proposal"];
  }

  const maxPreviewPhase: PrototypeDashboardPreviewPhase =
    proposalJourneyPhase === "proposal" ||
    proposalJourneyPhase === "exploration" ||
    proposalJourneyPhase === "voting"
      ? "voting"
      : "postCooldown";

  return PROTOTYPE_DASHBOARD_PREVIEW_PHASES.slice(
    0,
    PROTOTYPE_DASHBOARD_PREVIEW_PHASES.indexOf(maxPreviewPhase) + 1,
  );
}

function resolveDashboardPreviewCurrentPeriod(
  phase: PrototypeDashboardPreviewPhase,
): TreasuryLifecyclePeriodId {
  return phase === "postCooldown" ? "proposal" : phase;
}

function resolveDashboardPreviewLifecycleId(
  phase: PrototypeDashboardPreviewPhase,
  baseLifecycleId: number,
): number {
  return phase === "postCooldown" ? baseLifecycleId + 1 : baseLifecycleId;
}

function resolvePrototypeDetailStatusDerivationPeriod(
  phase: PrototypeJourneyPhase | PrototypeDashboardPreviewPhase,
): TreasuryLifecyclePeriodId | undefined {
  if (phase === "postCooldown" || phase === "executed") {
    return undefined;
  }
  return phase;
}

function buildPrototypeProposalDisplayEntry({
  entry,
  dashboardPreviewPhase,
  proposalJourneyPhase,
  votes,
}: {
  entry: TreasuryProposalTableEntry;
  dashboardPreviewPhase: PrototypeDashboardPreviewPhase;
  proposalJourneyPhase: PrototypeJourneyPhase;
  votes: TreasuryProposalVoteRow[];
}): TreasuryProposalTableEntry {
  const dashboardCurrentPeriod = resolveDashboardPreviewCurrentPeriod(dashboardPreviewPhase);
  const prototypeVoteBlockHeight = resolveNextBlockHeight(
    votes.map((vote) => vote.blockHeight ?? null),
    entry.createdAtBlock ?? 452000,
  );
  const votingPeriodTally =
    votes.length > 0
      ? buildVoteTallyFromVotes(entry, votes, prototypeVoteBlockHeight)
      : createLatestVoteTally(
          null,
          "proposalVoteDispatched",
          "0",
          "0",
          "0",
          entry.createdAtBlock ?? 452000,
        );
  const talliedVoteTally =
    votes.length > 0
      ? {
          ...buildVoteTallyFromVotes(entry, votes, prototypeVoteBlockHeight),
          createdByEventType: "proposalVotesTallied" as const,
        }
      : {
          ...createLatestVoteTally(
            null,
            "proposalVotesTallied",
            "0",
            "0",
            "0",
            entry.createdAtBlock ?? 452000,
          ),
          requiredParticipationBp: entry.requiredParticipationBp ?? null,
          requiredApprovalBp: entry.requiredApprovalBp ?? null,
          requiredParticipation: entry.requiredParticipation ?? null,
          totalParticipatingVotes: "0",
          approvalBp: "0",
        };

  let stage = entry.stage;
  let period: TreasuryProposalTableEntry["period"] = capitalizePeriodLabel(
    dashboardCurrentPeriod,
  );
  let latestVoteTally: TreasuryProposalLatestVoteTally | null | undefined = undefined;

  if (dashboardPreviewPhase === "proposal") {
    stage = "Submitted";
    latestVoteTally = null;
  } else if (dashboardPreviewPhase === "exploration") {
    stage = "Exploration";
    latestVoteTally = null;
  } else if (dashboardPreviewPhase === "voting") {
    stage = "Voting";
    latestVoteTally = votingPeriodTally;
  } else if (dashboardPreviewPhase === "cooldown") {
    stage =
      talliedVoteTally.voteResult === "approved"
        ? "Approved"
        : talliedVoteTally.voteResult === "rejected"
          ? "Rejected"
          : "Abandoned";
    latestVoteTally = talliedVoteTally;
  } else {
    stage =
      proposalJourneyPhase === "executed"
        ? "Executed"
        : talliedVoteTally.voteResult === "approved"
          ? "Approved"
          : talliedVoteTally.voteResult === "rejected"
            ? "Rejected"
            : "Abandoned";
    period = "Historical";
    latestVoteTally = talliedVoteTally;
  }

  return {
    ...entry,
    stage,
    period,
    latestVoteTally,
  };
}

function buildVoteTallyFromVotes(
  entry: TreasuryProposalTableEntry,
  votes: TreasuryProposalVoteRow[],
  blockHeight: number,
): TreasuryProposalLatestVoteTally {
  const tally = votes.reduce(
    (current, vote) => {
      const weight = parseMinaDisplayValue(vote.voteWeight) ?? 0;
      if (vote.vote === "yay") {
        current.yay += weight;
      } else if (vote.vote === "nay") {
        current.nay += weight;
      } else {
        current.abstain += weight;
      }
      return current;
    },
    { yay: 0, nay: 0, abstain: 0 },
  );
  const totalParticipatingVotes = tally.yay + tally.nay + tally.abstain;
  const approvalBp = tally.yay + tally.nay > 0 ? (tally.yay * 10_000) / (tally.yay + tally.nay) : 0;
  return {
    blockHeight,
    yayWeight: `${tally.yay} MINA`,
    nayWeight: `${tally.nay} MINA`,
    abstainWeight: `${tally.abstain} MINA`,
    createdByEventType: "proposalVoteDispatched",
    requiredParticipationBp: entry.requiredParticipationBp ? String(entry.requiredParticipationBp) : null,
    requiredApprovalBp: entry.requiredApprovalBp ? String(entry.requiredApprovalBp) : null,
    requiredParticipation: entry.requiredParticipation ?? null,
    totalParticipatingVotes: `${totalParticipatingVotes} MINA`,
    approvalBp: String(Math.floor(approvalBp)),
    voteResult: tally.yay > tally.nay ? "approved" : tally.nay > tally.yay ? "rejected" : null,
  };
}

function formatRemainingAfterExecution(entry: TreasuryProposalTableEntry, payoutAmount: string): string {
  const requestedAmount = parseMinaDisplayValue(entry.requestedAmount) ?? 0;
  const nextPayoutAmount = parseMinaDisplayValue(payoutAmount) ?? 0;
  const remainingAmount = Math.max(requestedAmount - nextPayoutAmount, 0);
  return `${remainingAmount.toLocaleString("en-US")} MINA`;
}

function capitalizeVoteLabel(vote: "yay" | "nay" | "abstain"): string {
  if (vote === "yay") {
    return "Yay";
  }
  if (vote === "nay") {
    return "Nay";
  }
  return "Abstain";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

const MOCK_CONNECTED_WALLET_ADDRESS = "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi";

function MissingProposalState({
  onViewAllProposals,
}: {
  onViewAllProposals: () => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal not found</CardTitle>
        <CardDescription>
          The selected proposal does not exist in the mock Storybook dataset anymore.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onViewAllProposals}>Return to proposals</Button>
      </CardContent>
    </Card>
  );
}

function createDetailProposal(
  entry: TreasuryProposalTableEntry,
  recipientsById: Record<string, string>,
  contentsById: Record<string, string>,
  executionsById: Record<string, TreasuryProposalExecutionRow[]>,
): TreasuryProposalDetailProposal {
  return {
    ...entry,
    recipient: recipientsById[entry.id] ?? null,
    zkAppUriHash: resolveMockZkAppUriHash(entry),
    stakingEpochDataLedgerHash: resolveMockStakingLedgerHash(entry),
    paidOutAmount: executionsById[entry.id]?.[0]?.paidOutAmount ?? "0 MINA",
    contents: contentsById[entry.id] ?? null,
    updatedAt: entry.createdAt,
    createdAtBlockTimestamp: entry.createdAt,
  };
}

const MOCK_ZKAPP_URI_HASHES = [
  "jx7NqM1yVqZ5hS6rH9tK2pQ4wX8cB3dF6gJ7mL9nR2sT5vY8a",
  "jxB4tW8pQ6mL2sR9yN5vX3cD7gF1hK6aP8qZ2uT5eJ9rM4",
  "jxD9aS3vL7qN2mY6tR8wK5pC1hF4gX9bQ6zU2eJ7nM5rT8",
  "jxF2mQ8xC5vR1sN7yT4pL9gH3aW6dK2zU8eJ5nB7rM1qY",
  "jxH6pT3nW9qL5vS2xR8mK4aD7gF1yC6zU9eJ2bN5rQ8",
];

const MOCK_STAKING_LEDGER_HASHES = [
  "jxA8mL4sQ7vN2tY9pC5rX3gF6hK1dW8zU2eJ5nB7qR4",
  "jxC5qR9yT2mV7sL4pX8nD3gF6hK1aW5zU9eJ2bN8rM6",
  "jxE2vN8pQ5rL1sT7yM4xC9gF3hK6aW2zU8eJ5nB7dR",
  "jxG7mX3qV8tH2nK5pS7yD4wF9cL1aM6eR8uZ2sN5vQ",
  "jxK4pS9vM2qR7tN5yL8xC3gF6hD1aW5zU9eJ2bN8r",
];

function resolveMockZkAppUriHash(entry: TreasuryProposalTableEntry): string {
  return MOCK_ZKAPP_URI_HASHES[resolveMockHashIndex(entry, MOCK_ZKAPP_URI_HASHES.length)];
}

function resolveMockStakingLedgerHash(entry: TreasuryProposalTableEntry): string {
  return MOCK_STAKING_LEDGER_HASHES[
    resolveMockHashIndex(entry, MOCK_STAKING_LEDGER_HASHES.length)
  ];
}

function resolveMockHashIndex(entry: TreasuryProposalTableEntry, length: number): number {
  const seed = `${entry.title}:${entry.proposalAddress ?? entry.proposer}`;
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) % length;
  }
  return hash;
}

function buildLifecycleArgs({
  lifecycleId,
  currentPeriod,
  currentPeriodProgress,
  currentSlot,
  periodEndsIn,
  isHistoricalLifecycle = false,
}: {
  lifecycleId: number;
  currentPeriod: TreasuryLifecyclePeriodId;
  currentPeriodProgress: number;
  currentSlot: number;
  periodEndsIn: string;
  isHistoricalLifecycle?: boolean;
}): TreasuryLifecyclePeriodInfoProps {
  const proposalStart = 18462144 + (lifecycleId - 13) * 6144;
  const periodLength = 1536;
  const lifecycleStartDate = new Date("2026-04-09T13:00:00.000Z");
  const lifecycleDateOffsetMs = (lifecycleId - 13) * 8 * 24 * 60 * 60 * 1000;
  const periodDurationMs = 2 * 24 * 60 * 60 * 1000;

  return {
    lifecycleId,
    currentPeriod,
    currentPeriodProgress,
    currentSlot,
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
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs,
        ).toISOString(),
      },
      {
        period: "exploration",
        slotRange: `${proposalStart + periodLength} - ${proposalStart + periodLength * 2 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 2,
        ).toISOString(),
      },
      {
        period: "voting",
        slotRange: `${proposalStart + periodLength * 2} - ${proposalStart + periodLength * 3 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 2,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 3,
        ).toISOString(),
      },
      {
        period: "cooldown",
        slotRange: `${proposalStart + periodLength * 3} - ${proposalStart + periodLength * 4 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 3,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 4,
        ).toISOString(),
      },
    ],
  };
}
