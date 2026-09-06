"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  KeyRound,
  LoaderCircle,
  Pause,
  Play,
  ShieldAlert,
  Upload,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/ui/alert";
import { Badge } from "@repo/ui/components/ui/badge";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { Input } from "@repo/ui/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/ui/tabs";
import {
  useWalletSession,
  type ProviderSession,
} from "@repo/ui/wallet-session-provider";
import {
  assertOperationPackage,
  assertPureSigningOperation,
  createSigningOperation,
  createOperationPackage,
  downloadJson,
  fetchTreasuryStatus,
  inspectParticipantRotation,
  mergeOperationSignatures,
  REQUIRED_SIGNATURE_COUNT,
  type OperationKind,
  type OperationPackage,
  type ParticipantKeyReview,
  type ParticipantRotationReview,
  type TreasuryStatus,
  validateSignatures,
  verifyOperationPackage,
} from "./operations";
import type { BackofficeRuntimeConfig } from "./runtime-config";
import { getRuntimeConfigError } from "./runtime-config";
import { useBackofficeSettings } from "./backoffice-settings";
import { useProverWorker } from "./use-prover-worker";
import {
  startTreasuryStatusPolling,
  TREASURY_STATUS_POLL_INTERVAL_MS,
} from "./treasury-status-polling";
import {
  getSessionLedgerAccountIndex,
  signOperationWithLedger,
  submitSignedCommand,
  waitForInclusion,
} from "./wallets";

type WorkflowRole = "signer" | "submitter";
type PendingAction = "prepare" | "import" | "sign" | "submit";

export interface Receipt {
  schemaVersion: 1;
  operation: OperationPackage;
  feePayer: string;
  transactionHash: string;
  includedAtBlock?: number;
  completedAt: string;
}

export interface OperationDialogPreviewState {
  operation?: OperationPackage | null;
  workflowRole?: WorkflowRole;
  proposalAddress?: string;
  nextParticipants?: string[];
  validSignatures?: boolean[];
  fee?: string;
  memo?: string;
  busy?: string | null;
  pendingAction?: PendingAction | null;
  error?: string | null;
  receipt?: Receipt | null;
  proverError?: string | null;
}

export interface BackofficePreviewState {
  status?: TreasuryStatus | null;
  loading?: boolean;
  error?: string | null;
  activeOperation?: OperationKind | null;
  walletSession?: ProviderSession | null;
  dialog?: OperationDialogPreviewState;
}

const actionLabels: Record<OperationKind, string> = {
  pauseTreasury: "Pause treasury",
  unpauseTreasury: "Unpause treasury",
  toggleProposal: "Toggle proposal pause",
  rotateMultisig: "Rotate multisig keys",
};

function short(value: string | undefined, size = 10): string {
  if (!value) return "—";
  return value.length > size * 2 + 1
    ? `${value.slice(0, size)}…${value.slice(-size)}`
    : value;
}

function formatMina(nanomina: string): string {
  const value = BigInt(nanomina);
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} MINA`;
}

function ActionButtonContent({
  icon,
  loading,
  loadingLabel,
  children,
}: {
  icon?: ReactNode;
  loading: boolean;
  loadingLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      {loading ? (
        <LoaderCircle
          className="mr-2 h-4 w-4 animate-spin"
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {loading ? loadingLabel : children}
    </>
  );
}

function StatusRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={
          mono
            ? "break-all text-right font-mono text-xs"
            : "text-right text-sm font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

function WorkflowSteps({
  role,
  currentStep,
}: {
  role: WorkflowRole;
  currentStep: number;
}) {
  const steps =
    role === "signer"
      ? ["Import bundle", "Review and sign", "Export contribution"]
      : ["Build or import", "Export and collect", "Verify and submit"];

  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label={`${role} workflow`}>
      {steps.map((step, index) => (
        <li
          key={step}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            index === currentStep
              ? "border-primary bg-primary/5 font-medium text-foreground"
              : index < currentStep
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "bg-muted/20 text-muted-foreground"
          }`}
          aria-current={index === currentStep ? "step" : undefined}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
              index === currentStep
                ? "bg-primary text-primary-foreground"
                : index < currentStep
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {index < currentStep ? "✓" : index + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function RotationParticipantField({
  index,
  value,
  currentParticipant,
  review,
  pending,
  onChange,
}: {
  index: number;
  value: string;
  currentParticipant: string;
  review?: ParticipantKeyReview;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const missing = value.trim().length === 0;
  const unsafe = Boolean(
    review && (!review.valid || review.empty || review.duplicate),
  );
  let status = "Required";
  let detail = "Enter the public key for this participant slot.";
  let variant: "default" | "secondary" | "destructive" | "outline" = "outline";

  if (pending && !missing) {
    status = "Checking";
    detail = "Checking the Mina public key and the complete key set.";
  } else if (review && !missing) {
    if (!review.valid) {
      status = "Invalid key";
      detail = "Enter a valid Mina public key.";
      variant = "destructive";
    } else if (review.empty) {
      status = "PublicKey.empty";
      detail = "This key cannot provide a participant signature.";
      variant = "destructive";
    } else if (review.duplicate) {
      status = "Duplicate";
      detail = "This key occurs more than once in the new participant set.";
      variant = "destructive";
    } else if (review.currentParticipantIndex !== undefined) {
      status =
        review.currentParticipantIndex === index
          ? "Unchanged"
          : `Current participant ${review.currentParticipantIndex + 1}`;
      detail = `This key is already in the current participant set at position ${review.currentParticipantIndex + 1}.`;
      variant = "secondary";
    } else {
      status = "New key";
      detail = "This key is not in the current participant set.";
      variant = "default";
    }
  }

  return (
    <div className="space-y-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label
          htmlFor={`next-participant-${index}`}
          className="text-sm font-semibold"
        >
          New participant {index + 1} public key
        </label>
        <Badge variant={variant}>{status}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        <div>Current participant {index + 1}</div>
        <div className="mt-1 break-all font-mono text-foreground">
          {currentParticipant}
        </div>
      </div>
      <Input
        id={`next-participant-${index}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="B62…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={unsafe}
        aria-describedby={`next-participant-${index}-status`}
      />
      <p
        id={`next-participant-${index}-status`}
        className={`text-xs ${unsafe ? "text-destructive" : "text-muted-foreground"}`}
      >
        {detail}
      </p>
    </div>
  );
}

function RotationSafetyAlerts({
  review,
  pending,
  error,
}: {
  review: ParticipantRotationReview | null;
  pending: boolean;
  error: string | null;
}) {
  return (
    <>
      {pending ? (
        <div className="flex items-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          Checking the participant key set
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Key validation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {review && review.emptyCount > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Critical: break-glass will become inoperable</AlertTitle>
          <AlertDescription>
            {review.emptyCount === 5
              ? "All five slots use PublicKey.empty. No participant can sign a future break-glass action."
              : review.emptyCount +
                " of 5 slots use PublicKey.empty. These slots cannot sign. Leaving empty slots will make break-glass inoperable as other signer keys are lost or unavailable."}{" "}
            The app blocks this rotation.
          </AlertDescription>
        </Alert>
      ) : null}

      {review && review.duplicateCount > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Duplicate participant keys</AlertTitle>
          <AlertDescription>
            Each participant slot must use a distinct key. A repeated key could
            let one signer fill more than one signature slot. The app blocks
            this rotation.
          </AlertDescription>
        </Alert>
      ) : null}

      {review && review.invalidCount > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Invalid Mina public keys</AlertTitle>
          <AlertDescription>
            Replace each invalid value with a valid Mina public key.
          </AlertDescription>
        </Alert>
      ) : null}

      {review?.exactCurrentOrder ? (
        <Alert variant="warning">
          <AlertTitle>No key change</AlertTitle>
          <AlertDescription>
            All five keys match the current ordered participant set. Change at
            least one key before you build the bundle.
          </AlertDescription>
        </Alert>
      ) : null}

      {review && review.retainedCount > 0 && !review.exactCurrentOrder ? (
        <Alert variant="warning">
          <AlertTitle>Existing signer keys remain</AlertTitle>
          <AlertDescription>
            {review.retainedCount === 5
              ? "All five slots reuse current signer keys. This changes their order but does not rotate signer control."
              : review.retainedCount +
                " of 5 slots reuse current signer keys. Confirm that this partial rotation is intentional."}
          </AlertDescription>
        </Alert>
      ) : null}

      {review?.canBuild ? (
        <Alert variant="success">
          <AlertTitle>Participant key set is ready</AlertTitle>
          <AlertDescription>
            All five keys are valid, distinct, and able to sign.{" "}
            {review.newCount} new key
            {review.newCount === 1 ? "" : "s"} will enter the participant set.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function RotationParticipantReviewList({
  currentParticipants,
  nextParticipants,
  review,
  pending,
  error,
}: {
  currentParticipants: string[];
  nextParticipants: string[];
  review: ParticipantRotationReview | null;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">Participant key rotation</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review each current key and its replacement in the final ordered
            set.
          </p>
        </div>
        <Badge variant="outline">Final ordered set</Badge>
      </div>

      <div className="grid gap-3">
        {nextParticipants.map((nextParticipant, index) => {
          const keyReview = review?.keys[index];
          let status = pending ? "Checking" : "New key";
          let variant: "default" | "secondary" | "destructive" | "outline" =
            pending ? "outline" : "default";
          if (keyReview) {
            if (!keyReview.valid) {
              status = "Invalid key";
              variant = "destructive";
            } else if (keyReview.empty) {
              status = "PublicKey.empty";
              variant = "destructive";
            } else if (keyReview.duplicate) {
              status = "Duplicate";
              variant = "destructive";
            } else if (keyReview.currentParticipantIndex !== undefined) {
              status =
                keyReview.currentParticipantIndex === index
                  ? "Unchanged"
                  : `Current participant ${keyReview.currentParticipantIndex + 1}`;
              variant = "secondary";
            }
          }
          return (
            <div key={index} className="rounded-lg bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Participant {index + 1}
                </div>
                <Badge variant={variant}>{status}</Badge>
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="grid gap-1 sm:grid-cols-[4rem_1fr]">
                  <dt className="text-muted-foreground">Current</dt>
                  <dd className="break-all font-mono">
                    {currentParticipants[index] ?? "—"}
                  </dd>
                </div>
                <div className="grid gap-1 sm:grid-cols-[4rem_1fr]">
                  <dt className="text-muted-foreground">New</dt>
                  <dd className="break-all font-mono">{nextParticipant}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <RotationSafetyAlerts review={review} pending={pending} error={error} />
    </div>
  );
}

function OperationWorkspace({
  kind,
  onReset,
  onRefresh,
  onWorkflowActiveChange,
  config,
  currentParticipants,
  preview,
}: {
  kind: OperationKind;
  onReset: () => void;
  onRefresh: () => Promise<TreasuryStatus>;
  onWorkflowActiveChange: (active: boolean) => void;
  config: BackofficeRuntimeConfig;
  currentParticipants: string[];
  preview?: OperationDialogPreviewState;
}) {
  const { wallet, session, connectWallet, signZkapp } = useWalletSession();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [workflowRole, setWorkflowRole] = useState<WorkflowRole>(
    preview?.workflowRole ?? "submitter",
  );
  const { status: proverStatus, send } = useProverWorker({
    disabled: Boolean(preview) || workflowRole === "signer",
    config,
  });
  const [operation, setOperation] = useState<OperationPackage | null>(
    preview?.operation ?? null,
  );
  const [proposalAddress, setProposalAddress] = useState(
    preview?.proposalAddress ?? "",
  );
  const [nextParticipants, setNextParticipants] = useState<string[]>(
    preview?.nextParticipants ?? Array.from({ length: 5 }, () => ""),
  );
  const [rotationReview, setRotationReview] =
    useState<ParticipantRotationReview | null>(null);
  const [rotationReviewPending, setRotationReviewPending] = useState(false);
  const [rotationReviewError, setRotationReviewError] = useState<string | null>(
    null,
  );
  const [validSignatures, setValidSignatures] = useState<boolean[]>(
    preview?.validSignatures ?? Array.from({ length: 5 }, () => false),
  );
  const [fee, setFee] = useState(preview?.fee ?? "0.1");
  const [memo, setMemo] = useState(preview?.memo ?? "");
  const [busy, setBusy] = useState<string | null>(preview?.busy ?? null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    preview?.pendingAction ?? null,
  );
  const [error, setError] = useState<string | null>(preview?.error ?? null);
  const [receipt, setReceipt] = useState<Receipt | null>(
    preview?.receipt ?? null,
  );

  useEffect(() => {
    setOperation(preview?.operation ?? null);
    setProposalAddress(preview?.proposalAddress ?? "");
    setNextParticipants(
      preview?.nextParticipants ?? Array.from({ length: 5 }, () => ""),
    );
    setValidSignatures(
      preview?.validSignatures ?? Array.from({ length: 5 }, () => false),
    );
    setWorkflowRole(preview?.workflowRole ?? "submitter");
    setFee(preview?.fee ?? "0.1");
    setMemo(
      preview?.memo ??
        (kind ? `Treasury back office: ${actionLabels[kind]}` : ""),
    );
    setBusy(preview?.busy ?? null);
    setPendingAction(preview?.pendingAction ?? null);
    setError(preview?.error ?? null);
    setReceipt(preview?.receipt ?? null);
  }, [kind, preview]);

  useEffect(() => {
    onWorkflowActiveChange(Boolean(operation || receipt));
  }, [onWorkflowActiveChange, operation, receipt]);

  useEffect(() => {
    if (kind !== "rotateMultisig") {
      setRotationReview(null);
      setRotationReviewPending(false);
      setRotationReviewError(null);
      return;
    }
    const participantsToInspect =
      operation?.nextParticipants ?? nextParticipants;
    const participantsBeforeRotation =
      operation?.participants ?? currentParticipants;
    if (!participantsToInspect) {
      setRotationReview(null);
      setRotationReviewPending(false);
      setRotationReviewError("The new participant key set is missing.");
      return;
    }
    let cancelled = false;
    setRotationReviewPending(true);
    setRotationReviewError(null);
    void inspectParticipantRotation(
      participantsBeforeRotation,
      participantsToInspect,
    )
      .then((review) => {
        if (!cancelled) setRotationReview(review);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setRotationReview(null);
          setRotationReviewError(
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRotationReviewPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentParticipants, kind, nextParticipants, operation]);

  const prepare = async () => {
    if (!kind) return;
    if (preview) return;
    setPendingAction("prepare");
    setBusy("Building signing bundle");
    setError(null);
    try {
      const fresh = await onRefresh();
      if (kind === "pauseTreasury" && fresh.paused) {
        throw new Error("The treasury is already paused.");
      }
      if (kind === "unpauseTreasury" && !fresh.paused) {
        throw new Error("The treasury is already active.");
      }
      const prepared = await createOperationPackage({
        kind,
        status: fresh,
        config,
        proposalAddress: proposalAddress.trim() || undefined,
        nextParticipants:
          kind === "rotateMultisig"
            ? nextParticipants.map((key) => key.trim())
            : undefined,
      });
      setOperation(prepared);
      if (kind === "toggleProposal") {
        void send({ type: "compile", includeProposalContracts: true }).catch(
          () => undefined,
        );
      } else {
        void send({ type: "compile", includeProposalContracts: false }).catch(
          () => undefined,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPendingAction(null);
    }
  };

  const signLedger = async () => {
    if (!operation || !session) return;
    if (preview) return;
    const signerParticipantIndex = operation.participants.indexOf(
      session.address,
    );
    const ledgerAccountIndex = getSessionLedgerAccountIndex(session);
    if (signerParticipantIndex < 0 || ledgerAccountIndex === null) return;
    setPendingAction("sign");
    setBusy(`Waiting for Ledger participant ${signerParticipantIndex + 1}`);
    setError(null);
    try {
      const signature = await signOperationWithLedger(
        operation,
        signerParticipantIndex,
        ledgerAccountIndex,
      );
      const signatures = Array.from(
        { length: operation.participants.length },
        (): string | null => null,
      );
      signatures[signerParticipantIndex] = signature;
      setOperation({ ...operation, signatures });
      setValidSignatures(
        signatures.map((participantSignature) => Boolean(participantSignature)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPendingAction(null);
    }
  };

  const importFile = async (file: File) => {
    setPendingAction("import");
    setBusy(
      workflowRole === "submitter" && operation
        ? "Merging signature contribution"
        : "Importing signing bundle",
    );
    setError(null);
    try {
      const imported = assertOperationPackage(JSON.parse(await file.text()));
      if (imported.kind !== kind) {
        throw new Error(
          `This file contains “${actionLabels[imported.kind]}”, not “${kind ? actionLabels[kind] : "the selected signing bundle"}”.`,
        );
      }
      if (workflowRole === "signer") {
        const pureOperation = assertPureSigningOperation(imported);
        setOperation(pureOperation);
        setProposalAddress(pureOperation.proposalAddress ?? "");
        setNextParticipants(
          pureOperation.nextParticipants ?? Array.from({ length: 5 }, () => ""),
        );
        setValidSignatures(Array.from({ length: 5 }, () => false));
        return;
      }
      const fresh = await onRefresh();
      await verifyOperationPackage(imported, fresh);
      const validity = await validateSignatures(imported);
      const sanitizedImported = {
        ...imported,
        signatures: imported.signatures.map((value, index) =>
          validity[index] ? value : null,
        ),
      };
      const merged = operation
        ? mergeOperationSignatures(operation, sanitizedImported)
        : sanitizedImported;
      const mergedValidity = await validateSignatures(merged);
      setOperation(merged);
      setProposalAddress(merged.proposalAddress ?? "");
      setNextParticipants(
        merged.nextParticipants ?? Array.from({ length: 5 }, () => ""),
      );
      setValidSignatures(mergedValidity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPendingAction(null);
    }
  };

  const submit = async () => {
    if (!operation || !session) return;
    if (preview) return;
    setPendingAction("submit");
    setBusy("Checking signing bundle");
    setError(null);
    try {
      const fresh = await onRefresh();
      await verifyOperationPackage(operation, fresh);
      const validity = await validateSignatures(operation);
      if (validity.filter(Boolean).length < REQUIRED_SIGNATURE_COUNT) {
        throw new Error("Three valid participant signatures are required.");
      }
      setBusy("Building proof");
      const response = await send({
        type: "buildAndProve",
        operation,
        senderAddress: session.address,
        fee,
        memo,
      });
      if (!response.ok || !response.transactionJson) {
        throw new Error("The proof worker did not return a transaction.");
      }
      setBusy(`Waiting for ${session.displayName}`);
      const command = await signZkapp({
        transactionJson: response.transactionJson,
        expectedSenderAddress: session.address,
        minaNodeUrl: config.minaNodeUrl,
        networkId: config.networkId,
        fee,
        memo,
      });
      setBusy("Submitting transaction");
      const transactionHash = await submitSignedCommand(
        config.minaNodeUrl,
        command,
      );
      setBusy("Waiting for inclusion");
      const includedAtBlock = await waitForInclusion(
        config.minaNodeUrl,
        transactionHash,
      );
      await onRefresh();
      setReceipt({
        schemaVersion: 1,
        operation,
        feePayer: session.address,
        transactionHash,
        includedAtBlock,
        completedAt: new Date().toISOString(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPendingAction(null);
    }
  };

  const validCount = validSignatures.filter(Boolean).length;
  const signerSignatureIndex = operation?.signatures.findIndex(Boolean) ?? -1;
  const signerHasSignature = signerSignatureIndex >= 0;
  const signerParticipantIndex =
    operation && session ? operation.participants.indexOf(session.address) : -1;
  const signerLedgerAccountIndex = getSessionLedgerAccountIndex(session);
  const signerWalletMatches = signerParticipantIndex >= 0;
  const rotationIsSafe =
    kind !== "rotateMultisig" ||
    (rotationReview?.canBuild === true &&
      !rotationReviewPending &&
      !rotationReviewError);
  const signerCanSign =
    signerWalletMatches &&
    signerLedgerAccountIndex !== null &&
    !signerHasSignature &&
    rotationIsSafe;
  const walletConnecting = wallet.loading || wallet.status === "connecting";
  const canPrepare =
    kind === "toggleProposal"
      ? proposalAddress.trim().length > 0
      : kind === "rotateMultisig"
        ? rotationReview?.canBuild === true && !rotationReviewPending
        : true;
  const currentStep = receipt
    ? 3
    : workflowRole === "signer"
      ? !operation
        ? 0
        : signerHasSignature
          ? 2
          : 1
      : !operation
        ? 0
        : validCount < REQUIRED_SIGNATURE_COUNT
          ? 1
          : 2;
  const title = actionLabels[kind];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workflowRole === "signer"
              ? "Import a bundle, add one signature, and export it."
              : "Build or import a bundle, collect three signatures, and submit it."}
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Role
          </div>
          <Tabs
            value={workflowRole}
            onValueChange={(value) => setWorkflowRole(value as WorkflowRole)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="signer"
                disabled={Boolean(busy) || Boolean(operation)}
              >
                Signer
              </TabsTrigger>
              <TabsTrigger
                value="submitter"
                disabled={Boolean(busy) || Boolean(operation)}
              >
                Submitter
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <WorkflowSteps role={workflowRole} currentStep={currentStep} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Signing bundle stopped</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {operation && !receipt ? (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The participant order and controller nonce are part of the
          authorization. Review them before each Ledger approval.
        </div>
      ) : null}

      {receipt ? (
        <div className="space-y-4">
          <Alert variant="success">
            <AlertTitle>Transaction included</AlertTitle>
            <AlertDescription>
              {receipt.transactionHash}
              {receipt.includedAtBlock
                ? ` at block ${receipt.includedAtBlock}`
                : ""}
            </AlertDescription>
          </Alert>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onReset}>
              Start new bundle
            </Button>
            {operation?.kind === "rotateMultisig" &&
            operation.nextParticipants &&
            operation.nextMultisigCommitment ? (
              <Button
                className="w-full sm:flex-1"
                variant="outline"
                onClick={() =>
                  downloadJson("treasury-multisig-participants.json", {
                    schemaVersion: 1,
                    pauseControllerAddress: operation.pauseControllerAddress,
                    multisigCommitment: operation.nextMultisigCommitment,
                    participants: operation.nextParticipants,
                    environment: {
                      NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS:
                        operation.nextParticipants?.join(",") ?? "",
                    },
                  })
                }
              >
                <KeyRound className="mr-2 h-4 w-4" /> Download new key set
              </Button>
            ) : null}
            <Button
              className="w-full sm:flex-1"
              onClick={() =>
                downloadJson(
                  `treasury-${operation?.kind}-receipt.json`,
                  receipt,
                )
              }
            >
              <Download className="mr-2 h-4 w-4" /> Download receipt
            </Button>
          </div>
        </div>
      ) : !operation ? (
        <div className="space-y-4">
          {workflowRole === "submitter" && kind === "toggleProposal" ? (
            <label className="block space-y-2 text-sm font-medium">
              Proposal address
              <Input
                value={proposalAddress}
                onChange={(event) => setProposalAddress(event.target.value)}
                placeholder="B62…"
              />
            </label>
          ) : null}
          {workflowRole === "submitter" && kind === "rotateMultisig" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="font-medium">New participant key set</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter five keys in their final signing order. At least three
                    participants must remain available for each break-glass
                    action.
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  3 of 5 signatures required
                </Badge>
              </div>

              <div className="grid gap-3">
                {nextParticipants.map((value, index) => (
                  <RotationParticipantField
                    key={index}
                    index={index}
                    value={value}
                    currentParticipant={currentParticipants[index] ?? ""}
                    review={rotationReview?.keys[index]}
                    pending={rotationReviewPending}
                    onChange={(nextValue) => {
                      const next = [...nextParticipants];
                      next[index] = nextValue;
                      setNextParticipants(next);
                    }}
                  />
                ))}
              </div>

              <RotationSafetyAlerts
                review={rotationReview}
                pending={rotationReviewPending}
                error={rotationReviewError}
              />
            </div>
          ) : null}
          <Alert
            variant={
              workflowRole === "submitter" &&
              (kind === "rotateMultisig" || kind === "toggleProposal")
                ? "warning"
                : "default"
            }
          >
            <AlertDescription>
              {workflowRole === "signer"
                ? "Import the signing bundle that you received from the submitter."
                : kind === "toggleProposal"
                  ? "The contract toggles PAUSED back to UNKNOWN. The previous proposal status is not restored."
                  : kind === "rotateMultisig"
                    ? "The chain stores only the new commitment. Download and preserve the ordered new participant list."
                    : "The controller nonce is fetched now and becomes part of every participant signature."}
            </AlertDescription>
          </Alert>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
          <div className="grid gap-2 border-t pt-4">
            <Button
              variant={workflowRole === "signer" ? "default" : "outline"}
              disabled={Boolean(busy)}
              aria-busy={pendingAction === "import"}
              onClick={() => fileRef.current?.click()}
              className="w-full"
            >
              <ActionButtonContent
                icon={<Upload className="mr-2 h-4 w-4" />}
                loading={pendingAction === "import"}
                loadingLabel={busy ?? "Importing signing bundle"}
              >
                Import signing bundle
              </ActionButtonContent>
            </Button>
            {workflowRole === "submitter" ? (
              <Button
                className="w-full"
                disabled={!canPrepare || Boolean(busy)}
                aria-busy={pendingAction === "prepare"}
                onClick={() => void prepare()}
              >
                <ActionButtonContent
                  loading={pendingAction === "prepare"}
                  loadingLabel={busy ?? "Building signing bundle"}
                >
                  Build signing bundle
                </ActionButtonContent>
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
          <div className="rounded-xl border bg-muted/30 p-4 text-sm">
            <StatusRow
              label="Controller nonce"
              value={operation.controllerNonce}
            />
            <StatusRow
              label="Message hash"
              value={operation.messageHash}
              mono
            />
            {operation.proposalAddress ? (
              <StatusRow
                label="Proposal transition"
                value={`${operation.proposalStatusBefore} → ${operation.proposalStatusAfter}`}
              />
            ) : null}
            {operation.nextMultisigCommitment ? (
              <StatusRow
                label="New commitment"
                value={operation.nextMultisigCommitment}
                mono
              />
            ) : null}
          </div>

          {operation.kind === "rotateMultisig" && operation.nextParticipants ? (
            <RotationParticipantReviewList
              currentParticipants={operation.participants}
              nextParticipants={operation.nextParticipants}
              review={rotationReview}
              pending={rotationReviewPending}
              error={rotationReviewError}
            />
          ) : null}

          {workflowRole === "signer" ? (
            <div className="space-y-4">
              <div>
                <div className="font-medium">Your signature</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The connected wallet identifies your participant slot. This
                  bundle does not contain other participant signatures.
                </p>
              </div>
              {signerHasSignature ? (
                <>
                  <Alert variant="success">
                    <AlertTitle>Signature ready</AlertTitle>
                    <AlertDescription>
                      The signature contribution contains only participant{" "}
                      {signerSignatureIndex + 1}. Return it to the submitter.
                    </AlertDescription>
                  </Alert>
                  <Button
                    className="w-full"
                    onClick={() =>
                      downloadJson(
                        `treasury-${operation.kind}-signature-contribution.json`,
                        operation,
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" /> Export signature
                    contribution
                  </Button>
                </>
              ) : (
                <>
                  {!session ? (
                    <Alert>
                      <AlertDescription>
                        Connect the Ledger account that controls one participant
                        key.
                      </AlertDescription>
                    </Alert>
                  ) : session.providerId !== "ledger" ? (
                    <Alert variant="destructive">
                      <AlertTitle>Ledger required</AlertTitle>
                      <AlertDescription>
                        Auro identifies {short(session.address)}. Connect the
                        Ledger account for the participant signature.
                      </AlertDescription>
                    </Alert>
                  ) : !signerWalletMatches ? (
                    <Alert variant="destructive">
                      <AlertTitle>Wallet is not a participant</AlertTitle>
                      <AlertDescription>
                        The connected key is not in this signing bundle.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert>
                      <AlertTitle>
                        Participant {signerParticipantIndex + 1}
                      </AlertTitle>
                      <AlertDescription>
                        Ledger account index {signerLedgerAccountIndex} controls{" "}
                        {short(session.address, 14)}.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    className="w-full"
                    disabled={
                      Boolean(busy) ||
                      walletConnecting ||
                      (Boolean(session) && !signerCanSign)
                    }
                    aria-busy={pendingAction === "sign" || walletConnecting}
                    onClick={() => {
                      if (session) void signLedger();
                      else connectWallet();
                    }}
                  >
                    <ActionButtonContent
                      icon={
                        session ? (
                          <KeyRound className="mr-2 h-4 w-4" />
                        ) : undefined
                      }
                      loading={pendingAction === "sign" || walletConnecting}
                      loadingLabel={
                        pendingAction === "sign"
                          ? (busy ?? "Waiting for Ledger")
                          : "Connecting wallet"
                      }
                    >
                      {session ? "Sign bundle" : "Connect wallet"}
                    </ActionButtonContent>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Participant signatures</div>
                <Badge
                  variant={
                    validCount >= REQUIRED_SIGNATURE_COUNT
                      ? "default"
                      : "secondary"
                  }
                >
                  {validCount} of {REQUIRED_SIGNATURE_COUNT} required
                </Badge>
              </div>
              {operation.participants.map((participant, index) => (
                <div key={participant} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      {index + 1}. {short(participant, 12)}
                    </span>
                    {validSignatures[index] ? (
                      <span className="flex items-center text-xs text-emerald-700">
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Valid
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Waiting
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid gap-2">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={Boolean(busy)}
                  aria-busy={pendingAction === "import"}
                  onClick={() => fileRef.current?.click()}
                >
                  <ActionButtonContent
                    icon={<Upload className="mr-2 h-4 w-4" />}
                    loading={pendingAction === "import"}
                    loadingLabel={busy ?? "Importing signing bundle"}
                  >
                    Merge signature contribution
                  </ActionButtonContent>
                </Button>
                <Button
                  className="w-full"
                  variant={
                    validCount < REQUIRED_SIGNATURE_COUNT
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    downloadJson(
                      `treasury-${operation.kind}-signing-bundle.json`,
                      createSigningOperation(operation),
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> Export signing bundle
                </Button>
              </div>
            </div>
          )}

          {workflowRole === "submitter" &&
          validCount >= REQUIRED_SIGNATURE_COUNT ? (
            <div className="space-y-3 border-t pt-5">
              <div className="font-medium">Fee payer</div>
              <p className="text-sm text-muted-foreground">
                {session
                  ? "The connected wallet pays the fee and signs the transaction."
                  : "Connect a wallet to pay the fee and sign the transaction."}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  Fee in MINA
                  <Input
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  Memo
                  <Input
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {busy}
            </div>
          ) : preview?.proverError || proverStatus.error ? (
            <div className="text-sm text-destructive">
              Proof worker: {preview?.proverError ?? proverStatus.error}
            </div>
          ) : null}

          {workflowRole === "submitter" &&
          validCount < REQUIRED_SIGNATURE_COUNT ? (
            <div className="text-right text-xs text-muted-foreground">
              Import each returned contribution. The app verifies it before
              merge.
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={onReset}
            >
              Start over
            </Button>
            {workflowRole === "submitter" &&
            validCount >= REQUIRED_SIGNATURE_COUNT ? (
              <Button
                className="w-full sm:flex-1"
                disabled={Boolean(busy) || walletConnecting}
                aria-busy={pendingAction === "submit" || walletConnecting}
                onClick={() => {
                  if (session) void submit();
                  else connectWallet();
                }}
              >
                <ActionButtonContent
                  loading={pendingAction === "submit" || walletConnecting}
                  loadingLabel={
                    pendingAction === "submit"
                      ? (busy ?? "Proving and submitting")
                      : "Connecting wallet"
                  }
                >
                  {session ? "Prove and submit" : "Connect wallet"}
                </ActionButtonContent>
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export function BackofficeApp({
  preview,
}: { preview?: BackofficePreviewState } = {}) {
  const { config } = useBackofficeSettings();
  const configError = preview ? null : getRuntimeConfigError(config);
  const [status, setStatus] = useState<TreasuryStatus | null>(
    preview?.status ?? null,
  );
  const [loading, setLoading] = useState(preview?.loading ?? !configError);
  const [error, setError] = useState<string | null>(
    preview?.error ?? configError,
  );
  const [activeOperation, setActiveOperation] = useState<OperationKind | null>(
    preview?.activeOperation ?? null,
  );
  const [workflowKey, setWorkflowKey] = useState(0);
  const [workflowActive, setWorkflowActive] = useState(
    Boolean(preview?.dialog?.operation || preview?.dialog?.receipt),
  );

  const refresh = useCallback(
    async (background = false) => {
      if (preview) {
        if (preview.status) return preview.status;
        throw new Error(preview.error ?? "Preview status is not available.");
      }
      if (!background) setLoading(true);
      try {
        const next = await fetchTreasuryStatus(config);
        setStatus(next);
        setError(null);
        return next;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      } finally {
        if (!background) setLoading(false);
      }
    },
    [config, preview],
  );

  useEffect(() => {
    if (configError || preview) return;
    return startTreasuryStatusPolling(async (background) => {
      try {
        await refresh(background);
      } catch {
        // The status alert reports polling errors.
      }
    }, TREASURY_STATUS_POLL_INTERVAL_MS);
  }, [configError, preview, refresh]);

  useEffect(() => {
    if (!status || workflowActive) return;
    if (
      activeOperation === null ||
      activeOperation === "pauseTreasury" ||
      activeOperation === "unpauseTreasury"
    ) {
      const nextOperation = status.paused ? "unpauseTreasury" : "pauseTreasury";
      if (activeOperation !== nextOperation) {
        setActiveOperation(nextOperation);
        setWorkflowKey((current) => current + 1);
      }
    }
  }, [activeOperation, status, workflowActive]);

  const actionsDisabled =
    !status || !status.participantCommitmentMatches || loading;
  const selectedOperation =
    activeOperation ?? (status?.paused ? "unpauseTreasury" : "pauseTreasury");
  const treasuryOperation =
    activeOperation === "pauseTreasury" || activeOperation === "unpauseTreasury"
      ? activeOperation
      : status?.paused
        ? "unpauseTreasury"
        : "pauseTreasury";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Break-glass operations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create, sign, and submit emergency operation bundles.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Back office is not ready</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status && !status.participantCommitmentMatches ? (
        <Alert variant="destructive">
          <AlertTitle>Participant commitment mismatch</AlertTitle>
          <AlertDescription>
            The configured ordered participant list does not match the pause
            controller. All operations are disabled.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2" data-component="action-switcher">
        <div className="text-sm font-medium">Choose an action</div>
        <Tabs
          value={selectedOperation}
          onValueChange={(value) => {
            setActiveOperation(value as OperationKind);
            setWorkflowActive(false);
            setWorkflowKey((current) => current + 1);
          }}
        >
          <TabsList
            className="grid h-auto w-full grid-cols-1 gap-1 rounded-xl border bg-muted/50 p-1.5 shadow-sm sm:grid-cols-3"
            aria-label="Break-glass action"
          >
            <TabsTrigger
              value={treasuryOperation}
              disabled={actionsDisabled}
              className="min-h-14 gap-2 rounded-lg px-4 py-3 font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              {treasuryOperation === "unpauseTreasury" ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              {actionLabels[treasuryOperation]}
            </TabsTrigger>
            <TabsTrigger
              value="toggleProposal"
              disabled={actionsDisabled}
              className="min-h-14 gap-2 rounded-lg px-4 py-3 font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <ShieldAlert className="h-4 w-4" /> Toggle proposal pause
            </TabsTrigger>
            <TabsTrigger
              value="rotateMultisig"
              disabled={actionsDisabled}
              className="min-h-14 gap-2 rounded-lg px-4 py-3 font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <KeyRound className="h-4 w-4" /> Rotate multisig keys
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card
        key={`action-panel-${selectedOperation}-${workflowKey}`}
        className="animate-in overflow-hidden border-primary/20 shadow-sm fade-in slide-in-from-bottom-1 duration-200"
        data-component="action-panel"
        data-operation={selectedOperation}
      >
        <div className="h-1 bg-primary" />
        <CardContent className="space-y-6 p-5 sm:p-6">
          {status ? (
            status.participantCommitmentMatches ? (
              <OperationWorkspace
                key={`${selectedOperation}-${workflowKey}`}
                kind={selectedOperation}
                onReset={() => {
                  setWorkflowActive(false);
                  setWorkflowKey((current) => current + 1);
                  setActiveOperation(
                    status.paused ? "unpauseTreasury" : "pauseTreasury",
                  );
                }}
                onRefresh={refresh}
                onWorkflowActiveChange={setWorkflowActive}
                config={config}
                currentParticipants={status.participants}
                preview={preview?.dialog}
              />
            ) : null
          ) : (
            <div className="flex items-center py-10 text-sm text-muted-foreground">
              {loading ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {loading
                ? "Loading treasury state"
                : "Treasury state is not available"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Treasury status</CardTitle>
              <CardDescription>
                Direct state from the configured Mina node. Updates every 10
                seconds.
              </CardDescription>
            </div>
            {status ? (
              <Badge variant={status.paused ? "destructive" : "secondary"}>
                {status.paused ? "Paused" : "Active"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {loading && !status ? (
            <div className="flex items-center py-10 text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading
              state
            </div>
          ) : status ? (
            <div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">Network</div>
                  <div className="mt-1 text-sm font-medium">
                    {status.networkId}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    Block height
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {status.blockHeight?.toString() ?? "Unavailable"}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="mt-1 text-sm font-medium">
                    {formatMina(status.treasuryBalance)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    Controller nonce
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {status.controllerNonce}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    Participant commitment
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {status.participantCommitmentMatches
                      ? "Verified"
                      : "Mismatch"}
                  </div>
                </div>
              </div>
              <details className="mt-3 rounded-lg bg-muted/50 p-3 text-xs">
                <summary className="cursor-pointer font-medium">
                  Technical details
                </summary>
                <div className="mt-3 space-y-2 font-mono">
                  <div className="break-all">
                    Owner: {status.treasuryOwnerAddress}
                  </div>
                  <div className="break-all">
                    Controller: {status.pauseControllerAddress}
                  </div>
                  <div className="break-all">
                    Commitment: {status.onChainCommitment}
                  </div>
                  <div>Balance: {status.treasuryBalance} nanomina</div>
                  <div className="pt-1 font-sans font-medium">
                    Ordered participants
                  </div>
                  {status.participants.map((participant, index) => (
                    <div key={participant} className="break-all">
                      {index + 1}. {participant}
                    </div>
                  ))}
                  <div>Build: {config.buildSha}</div>
                </div>
              </details>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
