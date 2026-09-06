import type { CSSProperties, ReactNode } from "react";
import { TreasuryLogoIcon } from "@repo/ui/treasury-logo-icon";
import type { ProviderSession } from "@repo/ui/wallet-provider";
import {
  BackofficeApp,
  type BackofficePreviewState,
  type Receipt,
} from "./backoffice-app";
import type {
  OperationKind,
  OperationPackage,
  TreasuryStatus,
} from "./operations";
import { BackofficeHeaderControls } from "./backoffice-header-controls";
import { BackofficeProviders } from "./backoffice-providers";

const participants = [
  "B62qoHG98jwMiTUbLTRa3swKX37aLHx1BH1jCUwQGjDvwEwFi7Fn3gF",
  "B62qoTUUNCsnPot29XdX2XdfaC4e53XYtBbR8UVAhJK2XDBgLM319Lo",
  "B62qjwzzRidkxK3zjTvnGN1YcfqxH1XE3ChhQWiMLcpWCsnfoSHeMoe",
  "B62qmxH7JivC96aiWEiKh61JzCJ7xFi2ejMke1raAfP1NkW35rYGRHh",
  "B62qowrYiozjPB2gY6Hz6bgHCNZwhgyrPTfa5Y48oWcErq9qLU6w2ae",
];

const nextParticipants = [
  "B62qmGpTuGnsV4fRsfRkWH5sNtoCL8ePscVncyr8mWPHBFsXgTuEAXb",
  "B62qoQuQpnAcPkyzhPNhxmAsYJ3BnsCsxBm8mUQ4WHVeVzrQxH9eLLQ",
  "B62qn2UXbMr9AumgBnamnxnR1itBUGP3xUeMLavDqTvsxapqKXgTRYk",
  "B62qnwuwmwHGqM7R72759ojs6XAc4LYw6Jr844nzUYUeJLchRuK5RTs",
  "B62qqSa9oeMjR5pzsULXddHtLpChV772MU5GKS5rTsdnRJEWm5MT3zm",
];
const emptyPublicKey =
  "B62qiTKpEPjGTSHZrtM8uXiKgn8So916pLmNJKDhKeyBQL9TDb3nvBG";

const activeStatus: TreasuryStatus = {
  networkId: "testnet",
  treasuryOwnerAddress:
    "B62qowner8Aw7sX4mQ2kHy5rP9vJ3nWd6cF1tL8yR2uK6pN4bV7zC3",
  pauseControllerAddress:
    "B62qcontroller6u4m8Noy1T3YcJY5sQ8g7vPhHh9YwJm8rW2pQk7vL2",
  treasuryBalance: "284120750000000",
  paused: false,
  controllerNonce: "42",
  onChainCommitment: "1854298701235678902345678901234567890",
  configuredCommitment: "1854298701235678902345678901234567890",
  participantCommitmentMatches: true,
  participants,
  blockHeight: 451_804,
};

const pausedStatus: TreasuryStatus = { ...activeStatus, paused: true };

const signatures = [
  "7mXsignatureParticipantOne4Qv8Nw2Kp6",
  "7mXsignatureParticipantTwo5Rt9Bx3Ls7",
  "7mXsignatureParticipantThree6Yu1Cm4Mt8",
  null,
  null,
];

function createOperation(
  kind: OperationKind,
  additions: Partial<OperationPackage> = {},
): OperationPackage {
  return {
    schemaVersion: 1,
    kind,
    networkId: activeStatus.networkId,
    treasuryOwnerAddress: activeStatus.treasuryOwnerAddress,
    pauseControllerAddress: activeStatus.pauseControllerAddress,
    controllerNonce: activeStatus.controllerNonce,
    multisigCommitment: activeStatus.onChainCommitment,
    participants,
    messageHash: "2481049827501928374650192837465019283746501928374650192837",
    signatures: Array.from({ length: 5 }, () => null),
    createdAt: "2026-09-03T09:30:00.000Z",
    ...additions,
  };
}

const pauseOperation = createOperation("pauseTreasury");

const toggleOperation = createOperation("toggleProposal", {
  proposalAddress: "B62qproposalM7v4aQf8pR2kHy6oL5vN2xWm3sC7dF9qT4uK8pY1mB5",
  proposalStatusBefore: "VOTING",
  proposalStatusAfter: "PAUSED",
  expectedProposalPaused: false,
});

const unpauseProposalOperation = createOperation("toggleProposal", {
  proposalAddress: "B62qproposalM7v4aQf8pR2kHy6oL5vN2xWm3sC7dF9qT4uK8pY1mB5",
  proposalStatusBefore: "PAUSED",
  proposalStatusAfter: "UNKNOWN",
  expectedProposalPaused: true,
});

const rotateOperation = createOperation("rotateMultisig", {
  nextParticipants,
  nextMultisigCommitment: "7623498105672349810567234981056723498105",
});

const completedReceipt: Receipt = {
  schemaVersion: 1,
  operation: { ...pauseOperation, signatures },
  feePayer: "B62qfeePayer9Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri8Aw7sX4mQ2",
  transactionHash: "5JuW7pK8x3YvN2dF9mQ4rT6cL1sA5eH8gB3zC7uP2oV6iR9jK4",
  includedAtBlock: 451_811,
  completedAt: "2026-09-03T09:42:17.000Z",
};

function auroSession(address = completedReceipt.feePayer): ProviderSession {
  return {
    providerId: "auro",
    address,
    displayName: "Auro",
    details: [{ label: "Wallet", value: "Auro" }],
  };
}

function ledgerSession(
  participantIndex: number,
  accountIndex: number,
): ProviderSession {
  return {
    providerId: "ledger",
    address: participants[participantIndex]!,
    displayName: "Ledger",
    details: [
      { label: "Wallet", value: "Ledger" },
      { label: "Account index", value: String(accountIndex) },
    ],
    data: { accountIndex },
  };
}

const storyTheme = {
  "--background": "0 0% 98%",
  "--foreground": "205 23% 16%",
  "--card-foreground": "205 23% 16%",
  "--secondary": "0 0% 94%",
  "--secondary-foreground": "205 23% 16%",
  "--muted": "0 0% 94%",
  "--muted-foreground": "0 0% 42%",
  "--accent": "194 65% 90%",
  "--accent-foreground": "205 23% 16%",
} as CSSProperties;

function BackofficeFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={storyTheme}
    >
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <TreasuryLogoIcon />
          <div>
            <div className="font-semibold">Mina Treasury</div>
            <div className="text-sm text-muted-foreground">Back office</div>
          </div>
          <BackofficeHeaderControls />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

function Preview({ preview }: { preview: BackofficePreviewState }) {
  return (
    <BackofficeProviders
      initialSession={preview.walletSession ?? null}
      persistSession={false}
    >
      <BackofficeFrame>
        <BackofficeApp preview={preview} />
      </BackofficeFrame>
    </BackofficeProviders>
  );
}

function story(preview: BackofficePreviewState) {
  return { render: () => <Preview preview={preview} /> };
}

function proposalStory(
  dialog: NonNullable<BackofficePreviewState["dialog"]> = {},
  walletSession: ProviderSession | null = null,
) {
  return story({
    status: activeStatus,
    loading: false,
    activeOperation: "toggleProposal",
    walletSession,
    dialog,
  });
}

function rotateKeysStory(
  dialog: NonNullable<BackofficePreviewState["dialog"]> = {},
  walletSession: ProviderSession | null = null,
) {
  return story({
    status: activeStatus,
    loading: false,
    activeOperation: "rotateMultisig",
    walletSession,
    dialog,
  });
}

export default {
  title: "Back office/Complete workflow",
  component: BackofficeApp,
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
  },
};

export const Loading = story({ loading: true });

export const ConfigurationError = story({
  loading: false,
  error: "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS is required.",
});

export const LoadError = story({
  loading: false,
  error: "The Mina node did not return the treasury owner account.",
});

export const ActiveTreasury = story({ status: activeStatus, loading: false });

export const SettingsOpen = {
  ...story({ status: activeStatus, loading: false }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const settingsButton = canvasElement.ownerDocument.querySelector(
      'button[aria-label="Settings"]',
    ) as HTMLButtonElement | null;
    settingsButton?.click();
  },
};

export const WalletConnectionOpen = {
  ...story({ status: activeStatus, loading: false }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const walletButton = Array.from(
      canvasElement.ownerDocument.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Connect wallet");
    walletButton?.click();
  },
};

export const PausedTreasury = story({ status: pausedStatus, loading: false });

export const StatusCheckInProgress = story({
  status: activeStatus,
  loading: true,
});

export const ParticipantCommitmentMismatch = story({
  status: {
    ...activeStatus,
    participantCommitmentMatches: false,
    configuredCommitment: "9012384756102938475610293847561029384756",
  },
  loading: false,
});

export const PauseStart = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
});

export const UnpauseStart = story({
  status: pausedStatus,
  loading: false,
  activeOperation: "unpauseTreasury",
});

export const SignerImport = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: { workflowRole: "signer" },
});

export const SignerImportingBundle = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    workflowRole: "signer",
    busy: "Importing signing bundle",
    pendingAction: "import",
  },
});

export const SubmitterBuildingBundle = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    busy: "Building signing bundle",
    pendingAction: "prepare",
  },
});

export const SubmitterUnsignedReview = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: { operation: pauseOperation },
});

export const SubmitterMergingContribution = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    operation: pauseOperation,
    busy: "Merging signature contribution",
    pendingAction: "import",
  },
});

export const ReadyToSubmitWithLedger = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: ledgerSession(0, 3),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
});

export const ReadyToSubmitWithAuro = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
});

export const ReadyToConnectFeePayer = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
});

export const SignerUnsignedReview = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: ledgerSession(1, 7),
  dialog: {
    operation: pauseOperation,
    workflowRole: "signer",
  },
});

export const SignerAwaitingWallet = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    operation: pauseOperation,
    workflowRole: "signer",
  },
});

export const SignerWaitingForLedger = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: ledgerSession(1, 7),
  dialog: {
    operation: pauseOperation,
    workflowRole: "signer",
    busy: "Waiting for Ledger participant 2",
    pendingAction: "sign",
  },
});

export const SignerSignedReview = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: ledgerSession(1, 7),
  dialog: {
    operation: {
      ...pauseOperation,
      signatures: [null, signatures[1]!, null, null, null],
    },
    workflowRole: "signer",
    validSignatures: [false, true, false, false, false],
  },
});

export const SignerWrongWallet = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: {
    ...ledgerSession(0, 7),
    address: "B62qnotAParticipant8mN4tR2xW7cD9fG5hJ1kL6pQ3vS",
  },
  dialog: {
    operation: {
      ...pauseOperation,
      participants: [
        ...pauseOperation.participants.slice(0, 4),
        "B62qanotherParticipantKey5nQ9pR3xW7cL2vD8sF4gH6jK1mT",
      ],
    },
    workflowRole: "signer",
  },
});

export const SignerConnectedWithAuro = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(participants[1]),
  dialog: { operation: pauseOperation, workflowRole: "signer" },
});

export const BuildingProof = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Building proof",
    pendingAction: "submit",
  },
});

export const CheckingSigningBundle = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Checking signing bundle",
    pendingAction: "submit",
  },
});

export const WaitingForWalletApproval = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Waiting for Auro",
    pendingAction: "submit",
  },
});

export const SubmittingTransaction = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Submitting transaction",
    pendingAction: "submit",
  },
});

export const WaitingForInclusion = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Waiting for inclusion",
    pendingAction: "submit",
  },
});

export const OperationError = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    operation: pauseOperation,
    error: "The controller nonce changed. Create a new signing bundle.",
  },
});

export const ProofWorkerError = story({
  status: activeStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  walletSession: auroSession(),
  dialog: {
    operation: { ...pauseOperation, signatures },
    validSignatures: [true, true, true, false, false],
    proverError: "The proof worker could not compile the pause controller.",
  },
});

export const TransactionIncluded = story({
  status: pausedStatus,
  loading: false,
  activeOperation: "pauseTreasury",
  dialog: {
    operation: completedReceipt.operation,
    receipt: completedReceipt,
  },
});

export const ProposalPauseStart = proposalStory();

export const ProposalPauseSignerImport = proposalStory({
  workflowRole: "signer",
});

export const ProposalPauseSubmitterUnsignedReview = proposalStory({
  operation: toggleOperation,
});

export const ProposalPauseSubmitterPartiallySigned = proposalStory({
  operation: {
    ...toggleOperation,
    signatures: [signatures[0]!, signatures[1]!, null, null, null],
  },
  validSignatures: [true, true, false, false, false],
});

export const ProposalPauseReadyWithAuro = proposalStory(
  {
    operation: { ...toggleOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
  auroSession(),
);

export const ProposalPauseReadyWithLedger = proposalStory(
  {
    operation: { ...toggleOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
  ledgerSession(0, 3),
);

export const ProposalPauseSignerUnsignedReview = proposalStory(
  { operation: toggleOperation, workflowRole: "signer" },
  ledgerSession(2, 4),
);

export const ProposalPauseSignerSignedReview = proposalStory(
  {
    operation: {
      ...toggleOperation,
      signatures: [null, null, signatures[2]!, null, null],
    },
    workflowRole: "signer",
    validSignatures: [false, false, true, false, false],
  },
  ledgerSession(2, 4),
);

export const ProposalPauseBuildingProof = proposalStory(
  {
    operation: { ...toggleOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Building proof",
    pendingAction: "submit",
  },
  auroSession(),
);

export const ProposalPauseOperationError = proposalStory({
  operation: toggleOperation,
  error: "The proposal state changed. Create a new signing bundle.",
});

export const ProposalPauseProofWorkerError = proposalStory(
  {
    operation: { ...toggleOperation, signatures },
    validSignatures: [true, true, true, false, false],
    proverError: "The proof worker could not compile the proposal contracts.",
  },
  auroSession(),
);

export const ProposalPauseIncluded = proposalStory({
  operation: { ...toggleOperation, signatures },
  receipt: {
    ...completedReceipt,
    operation: { ...toggleOperation, signatures },
  },
});

export const ProposalUnpauseReview = proposalStory({
  operation: unpauseProposalOperation,
});

export const RotateKeysStart = rotateKeysStory({ nextParticipants });

export const RotateKeysPartialRotation = rotateKeysStory({
  nextParticipants: [participants[0]!, ...nextParticipants.slice(1)],
});

export const RotateKeysDuplicateKeys = rotateKeysStory({
  nextParticipants: [
    nextParticipants[0]!,
    nextParticipants[0]!,
    ...nextParticipants.slice(2),
  ],
});

export const RotateKeysOneEmptyKey = rotateKeysStory({
  nextParticipants: [emptyPublicKey, ...nextParticipants.slice(1)],
});

export const RotateKeysAllEmptyKeys = rotateKeysStory({
  nextParticipants: Array.from({ length: 5 }, () => emptyPublicKey),
});

export const RotateKeysCurrentKeysUnchanged = rotateKeysStory({
  nextParticipants: [...participants],
});

export const RotateKeysInvalidKey = rotateKeysStory({
  nextParticipants: ["not-a-mina-public-key", ...nextParticipants.slice(1)],
});

export const RotateKeysSignerImport = rotateKeysStory({
  workflowRole: "signer",
});

export const RotateKeysSubmitterUnsignedReview = rotateKeysStory({
  operation: rotateOperation,
});

export const RotateKeysSubmitterPartiallySigned = rotateKeysStory({
  operation: {
    ...rotateOperation,
    signatures: [signatures[0]!, signatures[1]!, null, null, null],
  },
  validSignatures: [true, true, false, false, false],
});

export const RotateKeysReadyWithAuro = rotateKeysStory(
  {
    operation: { ...rotateOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
  auroSession(),
);

export const RotateKeysReadyWithLedger = rotateKeysStory(
  {
    operation: { ...rotateOperation, signatures },
    validSignatures: [true, true, true, false, false],
  },
  ledgerSession(0, 3),
);

export const RotateKeysSignerUnsignedReview = rotateKeysStory(
  { operation: rotateOperation, workflowRole: "signer" },
  ledgerSession(2, 4),
);

export const RotateKeysSignerSignedReview = rotateKeysStory(
  {
    operation: {
      ...rotateOperation,
      signatures: [null, null, signatures[2]!, null, null],
    },
    workflowRole: "signer",
    validSignatures: [false, false, true, false, false],
  },
  ledgerSession(2, 4),
);

export const RotateKeysBuildingProof = rotateKeysStory(
  {
    operation: { ...rotateOperation, signatures },
    validSignatures: [true, true, true, false, false],
    busy: "Building proof",
    pendingAction: "submit",
  },
  auroSession(),
);

export const RotateKeysOperationError = rotateKeysStory({
  operation: rotateOperation,
  error: "The participant commitment changed. Create a new signing bundle.",
});

export const RotateKeysProofWorkerError = rotateKeysStory(
  {
    operation: { ...rotateOperation, signatures },
    validSignatures: [true, true, true, false, false],
    proverError: "The proof worker could not compile the pause controller.",
  },
  auroSession(),
);

export const RotateKeysIncluded = rotateKeysStory({
  operation: { ...rotateOperation, signatures },
  receipt: {
    ...completedReceipt,
    operation: { ...rotateOperation, signatures },
  },
});
