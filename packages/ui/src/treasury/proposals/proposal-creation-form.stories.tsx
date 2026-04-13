import { type JSX, useState } from "react";
import { TreasuryTransactionFlowDialog } from "../../treasury/transactions/transaction-flow-dialog";
import {
  TreasuryProposalCreationForm,
  type TreasuryProposalCreationDraft,
} from "./proposal-creation-form";

export default {
  title: "Treasury/Proposal Creation Form",
};

export const Default = {
  render: (): JSX.Element => (
    <div className="mx-auto w-full max-w-6xl p-6">
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="proposal"
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        treasuryBalance="24000000"
        eligibleVotingWeight="360000"
        onSaveDraft={() => {}}
        initialTitle="Governance office-hours expansion"
        initialAmount="96000"
        initialRecipient="B62qrecipientAmbassador1111111111111111111111111111111111"
        initialContent={`# Governance office-hours expansion

## Summary

Expand recurring governance office hours and contributor support sessions across additional regions.

## Deliverables

- weekly office hours
- facilitator stipends
- reporting and follow-up`}
      />
    </div>
  ),
};

export const WalletRequired = {
  render: (): JSX.Element => (
    <div className="mx-auto w-full max-w-6xl p-6">
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="proposal"
        connectedWalletAddress={null}
        onConnectWalletClick={() => {}}
        onSaveDraft={() => {}}
      />
    </div>
  ),
};

export const DraftOnly = {
  render: (): JSX.Element => (
    <div className="mx-auto w-full max-w-6xl p-6">
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="cooldown"
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        treasuryBalance="24000000"
        eligibleVotingWeight="360000"
        onSaveDraft={() => {}}
        initialTitle="Governance office-hours expansion"
        initialAmount="96000"
        initialRecipient="B62qrecipientAmbassador1111111111111111111111111111111111"
        initialContent={`# Governance office-hours expansion

## Summary

Expand recurring governance office hours and contributor support sessions across additional regions.`}
      />
    </div>
  ),
};

export const WithTransactionFlow = {
  render: (): JSX.Element => <ProposalCreationTransactionStory />,
};

function ProposalCreationTransactionStory(): JSX.Element {
  const [draft, setDraft] = useState<TreasuryProposalCreationDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="proposal"
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        treasuryBalance="24000000"
        eligibleVotingWeight="360000"
        onSaveDraft={(nextDraft) => {
          setDraft(nextDraft);
        }}
        initialTitle="Governance office-hours expansion"
        initialAmount="96000"
        initialRecipient="B62qrecipientAmbassador1111111111111111111111111111111111"
        initialContent={`# Governance office-hours expansion

## Summary

Expand recurring governance office hours and contributor support sessions across additional regions.

## Deliverables

- weekly office hours
- facilitator stipends
- reporting and follow-up`}
        onSubmit={(nextDraft) => {
          setDraft(nextDraft);
          setDialogOpen(true);
        }}
      />

      <TreasuryTransactionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kind="createProposal"
        senderAddress={draft?.proposerAddress ?? null}
        transactionDetailsCode={
          draft
            ? `{
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
}`
            : undefined
        }
        submitLabel="Create proposal transaction"
        summaryItems={
          draft
            ? [
                { label: "Lifecycle", value: `Lifecycle ${draft.lifecycleId ?? "-"}` },
                { label: "Title", value: extractProposalTitle(draft.content) },
                { label: "Recipient", value: draft.recipient, mono: true },
                { label: "Amount", value: `${draft.amount} MINA` },
                {
                  label: "Derived bond",
                  value: `${formatBondAmount(draft.amount)} MINA`,
                },
              ]
            : []
        }
        onCompile={() => delay(1400)}
        onProve={() => delay(1500)}
        onSignAndSend={async () => {
          await delay(1200);
          return {
            hash: "5JuDcreateProposalHash1111111111111111111111111111111111111",
          };
        }}
        onWaitForInclusion={async ({ hash }) => {
          await delay(3200);
          return {
            hash,
            blockHeight: 452041,
          };
        }}
        onPostInclusion={async () => {
          await delay(2200);
        }}
      />
    </div>
  );
}

function extractProposalTitle(contents: string): string {
  const match = contents.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  return match?.[1]?.trim() || "Untitled proposal";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
