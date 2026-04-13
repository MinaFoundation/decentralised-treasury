import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  TreasuryTransactionFlowDialog,
  type TreasuryTransactionFlowKind,
  type TreasuryTransactionSummaryItem,
} from "./transaction-flow-dialog";

export default {
  title: "Treasury/Transaction Flow Dialog",
};

export const CreateProposalFlow = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStory
        kind="createProposal"
        buttonLabel="Open create proposal flow"
        submitLabel="Create proposal transaction"
        summaryItems={[
          { label: "Lifecycle", value: "Lifecycle 12" },
          {
            label: "Proposer wallet",
            value: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
            mono: true,
          },
          {
            label: "Recipient",
            value: "B62qrecipientAmbassador1111111111111111111111111111111111",
            mono: true,
          },
          { label: "Amount", value: "96,000 MINA" },
          { label: "Derived bond", value: "9,600 MINA" },
        ]}
      />
    </StoryFrame>
  ),
};

export const VoteFlow = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStory
        kind="vote"
        buttonLabel="Open vote flow"
        submitLabel="Cast vote transaction"
        summaryItems={[
          { label: "Proposal", value: "P-130" },
          { label: "Vote", value: "Yay" },
          {
            label: "Proposal address",
            value: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
            mono: true,
          },
          { label: "Voting weight", value: "182,450 MINA" },
        ]}
      />
    </StoryFrame>
  ),
};

export const ExecuteFlow = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStory
        kind="executeProposal"
        buttonLabel="Open execute flow"
        submitLabel="Execute payout transaction"
        summaryItems={[
          { label: "Proposal", value: "P-128" },
          {
            label: "Recipient wallet",
            value: "B62qrecipientPassed111111111111111111111111111111111111111",
            mono: true,
          },
          { label: "Amount to pay out", value: "82,500 MINA" },
          { label: "Remaining after execution", value: "0 MINA" },
        ]}
      />
    </StoryFrame>
  ),
};

export const OpenAtStart = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Open At Start"
        state="idle"
        kind="createProposal"
        submitLabel="Create proposal transaction"
      />
    </StoryFrame>
  ),
};

export const ReviewStep = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Review Step"
        state="idle"
        kind="createProposal"
        submitLabel="Create proposal transaction"
      />
    </StoryFrame>
  ),
};

export const Compiling = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Compiling"
        state="compiling"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const Proving = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Proving"
        state="proving"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const CompileFailed = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Compile Failed"
        state="compileError"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const ProveFailed = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Prove Failed"
        state="proveError"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const AwaitingWalletSignature = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Awaiting Wallet Signature"
        state="awaitingSignature"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const SignAndSendFailed = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Sign & Send Failed"
        state="signAndSendError"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

export const WaitingForInclusion = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Waiting For Inclusion"
        state="waitForInclusion"
        kind="executeProposal"
        submitLabel="Execute payout transaction"
      />
    </StoryFrame>
  ),
};

export const Included = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Included"
        state="completed"
        kind="executeProposal"
        submitLabel="Execute payout transaction"
      />
    </StoryFrame>
  ),
};

export const PostingContent = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Posting Content"
        state="postContent"
        kind="createProposal"
        submitLabel="Create proposal transaction"
      />
    </StoryFrame>
  ),
};

export const PostContentFailed = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Post Content Failed"
        state="postContentError"
        kind="createProposal"
        submitLabel="Create proposal transaction"
      />
    </StoryFrame>
  ),
};

export const WalletRejected = {
  render: (): JSX.Element => (
    <StoryFrame>
      <TransactionFlowStateStory
        title="Wallet Rejected"
        state="error"
        kind="vote"
        submitLabel="Cast vote transaction"
      />
    </StoryFrame>
  ),
};

function StoryFrame({ children }: { children: JSX.Element }): JSX.Element {
  return <div className="min-h-screen bg-background p-6">{children}</div>;
}

function TransactionFlowStory({
  kind,
  buttonLabel,
  submitLabel,
  summaryItems,
}: {
  kind: TreasuryTransactionFlowKind;
  buttonLabel: string;
  submitLabel: string;
  summaryItems: TreasuryTransactionSummaryItem[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [storyKey, setStoryKey] = useState(0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex justify-start gap-2">
        <Button type="button" onClick={() => setOpen(true)}>
          {buttonLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpen(false);
            setStoryKey((current) => current + 1);
          }}
        >
          Reset story
        </Button>
      </div>

      <TreasuryTransactionFlowDialog
        key={storyKey}
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        senderAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        transactionDetailsCode={getMockTransactionDetails(kind)}
        defaultFee="0.1"
        defaultNonce="12"
        defaultMemo="treasury-ui-story"
        submitLabel={submitLabel}
        summaryItems={summaryItems}
        onCompile={() => delay(1400)}
        onProve={() => delay(1500)}
        onSignAndSend={async () => {
          await delay(1200);
          return {
            hash: `5JuD${kind}Hash1111111111111111111111111111111111111111111`,
          };
        }}
        onWaitForInclusion={async ({ hash }) => {
          await delay(3500);
          return {
            hash,
            blockHeight:
              kind === "createProposal" ? 452041 : kind === "vote" ? 452042 : 452043,
          };
        }}
        onPostInclusion={
          kind === "createProposal"
            ? async () => {
                await delay(2200);
              }
            : undefined
        }
      />
    </div>
  );
}

type StoryState =
  | "idle"
  | "compiling"
  | "compileError"
  | "proving"
  | "proveError"
  | "awaitingSignature"
  | "signAndSendError"
  | "waitForInclusion"
  | "postContent"
  | "postContentError"
  | "completed"
  | "error";

function TransactionFlowStateStory({
  title,
  state,
  kind,
  submitLabel,
}: {
  title: string;
  state: StoryState;
  kind: TreasuryTransactionFlowKind;
  submitLabel: string;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const [storyKey, setStoryKey] = useState(0);
  const hasAutoStartedRef = useRef(false);
  const stalledStepPromiseRef = useRef<Promise<void>>(new Promise(() => {}));

  useEffect(() => {
    if (state === "idle" || hasAutoStartedRef.current) {
      return;
    }

    let frame = 0;
    let attempts = 0;
    const maxAttempts = 20;

    const clickWhenReady = () => {
      const startButton = document.querySelector<HTMLButtonElement>(
        '[data-component="transaction-flow-start-button"]',
      );
      if (startButton) {
        hasAutoStartedRef.current = true;
        startButton.click();
        return;
      }
      if (attempts >= maxAttempts) {
        return;
      }
      attempts += 1;
      frame = window.requestAnimationFrame(clickWhenReady);
    };

    frame = window.requestAnimationFrame(clickWhenReady);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [state]);

  const summaryItems = getDefaultSummaryItems(kind);
  const txHash = `5JuD${kind}InspectHash1111111111111111111111111111111111111111`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">
          This story opens the modal directly in a stable inspection state.
        </p>
      </div>
      <div className="flex justify-start">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            hasAutoStartedRef.current = false;
            setOpen(true);
            setStoryKey((current) => current + 1);
          }}
        >
          Reset story
        </Button>
      </div>

      <TreasuryTransactionFlowDialog
        key={storyKey}
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        senderAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        transactionDetailsCode={getMockTransactionDetails(kind)}
        defaultFee="0.1"
        defaultNonce="12"
        defaultMemo="treasury-ui-story"
        submitLabel={submitLabel}
        summaryItems={summaryItems}
        onCompile={async () => {
          if (state === "compileError") {
            await delay(20);
            throw new Error("Contract compilation failed.");
          }
          if (state === "compiling") {
            await stalledStepPromiseRef.current;
          }
          await delay(20);
        }}
        onProve={async () => {
          if (state === "proveError") {
            await delay(20);
            throw new Error("Proof generation failed.");
          }
          if (state === "proving") {
            await stalledStepPromiseRef.current;
          }
          await delay(20);
        }}
        onSignAndSend={async () => {
          if (state === "error" || state === "signAndSendError") {
            await delay(20);
            throw new Error("Auro rejected the transaction request.");
          }
          if (state === "awaitingSignature") {
            await stalledStepPromiseRef.current;
          }
          await delay(20);
          return {
            hash: txHash,
          };
        }}
        onWaitForInclusion={async ({ hash }) => {
          if (state === "waitForInclusion") {
            await stalledStepPromiseRef.current;
          }
          await delay(20);
          return {
            hash,
            blockHeight: kind === "createProposal" ? 452041 : kind === "vote" ? 452042 : 452043,
          };
        }}
        onPostInclusion={
          kind === "createProposal"
            ? async () => {
                if (state === "postContentError") {
                  await delay(20);
                  throw new Error("Proposal content post failed.");
                }
                if (state === "postContent") {
                  await stalledStepPromiseRef.current;
                }
                await delay(20);
              }
            : undefined
        }
      />
    </div>
  );
}

function getDefaultSummaryItems(kind: TreasuryTransactionFlowKind): TreasuryTransactionSummaryItem[] {
  if (kind === "createProposal") {
    return [
      { label: "Lifecycle", value: "Lifecycle 12" },
      {
        label: "Proposer wallet",
        value: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
        mono: true,
      },
      {
        label: "Recipient",
        value: "B62qrecipientAmbassador1111111111111111111111111111111111",
        mono: true,
      },
      { label: "Amount", value: "96,000 MINA" },
      { label: "Derived bond", value: "9,600 MINA" },
    ];
  }
  if (kind === "executeProposal") {
    return [
      { label: "Proposal", value: "P-128" },
      {
        label: "Recipient wallet",
        value: "B62qrecipientPassed111111111111111111111111111111111111111",
        mono: true,
      },
      { label: "Amount to pay out", value: "82,500 MINA" },
      { label: "Remaining after execution", value: "0 MINA" },
    ];
  }
  return [
    { label: "Proposal", value: "P-130" },
    { label: "Vote", value: "Yay" },
    {
      label: "Proposal address",
      value: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
      mono: true,
    },
    { label: "Voting weight", value: "182,450 MINA" },
  ];
}

function getMockTransactionDetails(kind: TreasuryTransactionFlowKind): string {
  if (kind === "createProposal") {
    return `{
  feePayer: {
    body: {
      publicKey: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      fee: "100000000",
      nonce: "12"
    }
  },
  accountUpdates: [
    {
      publicKey: "B62qproposalzkapp111111111111111111111111111111111111",
      update: { appState: ["Lifecycle12", "Recipient", "96000"] },
      authorizationKind: "proof"
    },
    {
      publicKey: "B62qtreasuryvault11111111111111111111111111111111111",
      update: { balanceChange: "-96000000000" },
      authorizationKind: "proof"
    }
  ]
}`;
  }

  if (kind === "executeProposal") {
    return `{
  feePayer: {
    body: {
      publicKey: "B62qrecipientPassExample111111111111111111111111111111111",
      fee: "100000000",
      nonce: "21"
    }
  },
  accountUpdates: [
    {
      publicKey: "B62qproposalzkapp111111111111111111111111111111111111",
      update: { actionState: ["execute"] },
      authorizationKind: "proof"
    },
    {
      publicKey: "B62qrecipientPassed111111111111111111111111111111111111111",
      update: { balanceChange: "82500000000" },
      authorizationKind: "none"
    }
  ]
}`;
  }

  return `{
  feePayer: {
    body: {
      publicKey: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      fee: "100000000",
      nonce: "34"
    }
  },
  accountUpdates: [
    {
      publicKey: "B62qproposalzkapp111111111111111111111111111111111111",
      update: { voteState: ["yay", "182450000000"] },
      authorizationKind: "proof"
    },
    {
      publicKey: "B62qvoterstake111111111111111111111111111111111111111",
      update: { delegate: "B62qproposalzkapp111111111111111111111111111111111111" },
      authorizationKind: "signature"
    }
  ]
}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
