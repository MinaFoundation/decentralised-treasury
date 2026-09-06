"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import type { TreasuryProposalCreationDraft } from "@repo/ui/treasury-proposal-creation-form";
import { TreasuryProposalCreationForm } from "@repo/ui/treasury-proposal-creation-form";
import type { TreasuryTransactionSummaryItem } from "@repo/ui/treasury-transaction-flow-dialog";
import { TreasuryTransactionFlowDialog } from "@repo/ui/treasury-transaction-flow-dialog";
import { type PreparedCreateProposalTransaction } from "../lib/proposal-prover-runtime";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/ui/alert";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";
import { useProposalDrafts } from "../hooks/use-proposal-drafts";
import { useProposalProverWorker } from "../hooks/use-proposal-prover-worker";
import { submitProposalContents } from "../lib/proposal-content-submission";
import {
  removeProposalContentRetryRecord,
  saveProposalContentRetryRecord,
  updateProposalContentRetryRecord,
} from "../lib/proposal-content-retry-store";
import { waitForTransactionInclusion } from "../lib/transaction-inclusion";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import { fetchLifecycleProposalEstimateContext } from "../../treasury-header/lib/treasury-header-api";
import { useWalletSession } from "../../treasury-header/hooks/use-wallet-session";

type CreateProposalPreviousPage = "dashboard" | "proposals";

interface ProposalCreatePageContainerProps {
  draftId?: string;
  previousPage?: CreateProposalPreviousPage;
}

interface PreparedCreateProposalFlow {
  draft: TreasuryProposalCreationDraft;
  preparedTransaction: PreparedCreateProposalTransaction;
  provedTransactionJson?: string;
  transactionHash?: string;
}

interface ProposalEstimateContext {
  treasuryBalance?: string;
  eligibleVotingWeight?: string;
}

function logWalletSubmissionTransaction(
  label: string,
  transactionJson: string,
): void {
  try {
    const parsed = JSON.parse(transactionJson) as {
      feePayer?: { authorization?: unknown };
      accountUpdates?: Array<{
        body?: {
          publicKey?: string;
          authorizationKind?: {
            isSigned?: boolean;
            isProved?: boolean;
          };
        };
        authorization?: {
          signature?: unknown;
          proof?: unknown;
        };
      }>;
    };
    console.info(`[proposal-prover][wallet-submit] ${label}`, {
      feePayerAuthType: typeof parsed.feePayer?.authorization,
      accountUpdates:
        parsed.accountUpdates?.map((accountUpdate, index) => ({
          index,
          publicKey: accountUpdate.body?.publicKey,
          isSigned: Boolean(accountUpdate.body?.authorizationKind?.isSigned),
          isProved: Boolean(accountUpdate.body?.authorizationKind?.isProved),
          hasSignature: accountUpdate.authorization?.signature != null,
          hasProof: accountUpdate.authorization?.proof != null,
        })) ?? [],
    });
  } catch (error) {
    console.error(
      "[proposal-prover][wallet-submit] failed to inspect transaction json",
      {
        label,
        error,
      },
    );
  }
}

function resolveProofsEnabled(): boolean {
  const rawValue = getRuntimeConfig().proofsEnabled;
  const resolved = rawValue !== "false";
  console.info("[proposal-prover][config] create proposal proofs flag", {
    rawValue,
    resolved,
  });
  return resolved;
}

function resolveCreateProposalPeriod(
  selectedLifecycleId: number | null,
  currentLifecycleId: number | undefined,
  currentPeriod: string | undefined,
): "proposal" | "exploration" | "voting" | "cooldown" | null {
  if (selectedLifecycleId === null || currentLifecycleId === undefined) {
    return currentPeriod === undefined ? null : (currentPeriod as never);
  }
  if (selectedLifecycleId < currentLifecycleId) {
    return "cooldown";
  }
  if (selectedLifecycleId > currentLifecycleId) {
    return "proposal";
  }
  return currentPeriod === undefined ? null : (currentPeriod as never);
}

function formatBondAmount(amount: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 9,
  }).format(parsed / 10);
}

function extractProposalTitle(contents: string): string {
  const match = contents.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  return match?.[1]?.trim() || "Untitled proposal";
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

function getCreateProposalTransactionDetails(
  prepared: PreparedCreateProposalTransaction | null,
): string | undefined {
  if (!prepared) {
    return undefined;
  }

  try {
    const parsedTransaction = JSON.parse(prepared.transactionJson) as
      | Record<string, unknown>
      | unknown[];
    const sanitizedTransaction =
      parsedTransaction &&
      typeof parsedTransaction === "object" &&
      !Array.isArray(parsedTransaction)
        ? (() => {
            const { accountUpdates: _accountUpdates, ...rest } =
              parsedTransaction;
            return rest;
          })()
        : parsedTransaction;

    return JSON.stringify(
      {
        proposalPublicKey: prepared.proposalPublicKey,
        proposalZkAppUri: prepared.proposalZkAppUri,
        zkAppUriHash: prepared.zkAppUriHash,
        transaction: sanitizedTransaction,
      },
      null,
      2,
    );
  } catch {
    return undefined;
  }
}

function resolveBackHref(
  previousPage: CreateProposalPreviousPage,
  lifecycleId: number | null,
): string {
  if (previousPage === "dashboard") {
    return lifecycleId != null ? `/?lifecycleId=${lifecycleId}` : "/";
  }
  return "/proposals";
}

export function ProposalCreatePageContainer({
  draftId,
  previousPage = "proposals",
}: ProposalCreatePageContainerProps): JSX.Element {
  const router = useRouter();
  const { wallet, connectWallet, signAndSubmitZkapp } = useWalletSession();
  const settings = useEndpointSettingsState();
  const treasury = useTreasuryState();
  const setAppError = useAppShellStore((state) => state.setError);
  const { getDraftById, removeDraft, saveDraft } = useProposalDrafts();
  const proofsEnabled = resolveProofsEnabled();
  const { compile, buildAndProveCreateProposal } =
    useProposalProverWorker(proofsEnabled);
  const [submissionDraft, setSubmissionDraft] =
    useState<TreasuryProposalCreationDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preparedFlow, setPreparedFlow] =
    useState<PreparedCreateProposalFlow | null>(null);
  const [estimateContext, setEstimateContext] =
    useState<ProposalEstimateContext>({});
  const submissionDraftRef = useRef<TreasuryProposalCreationDraft | null>(null);
  const preparedFlowRef = useRef<PreparedCreateProposalFlow | null>(null);

  const selectedDraft = draftId ? getDraftById(draftId) : null;
  const resolvedLifecycleId = treasury.currentLifecycleId ?? null;
  const createProposalPeriod = resolveCreateProposalPeriod(
    resolvedLifecycleId,
    treasury.currentLifecycleId,
    treasury.currentPeriod,
  );
  const treasuryOwnerAddress =
    getRuntimeConfig().treasuryOwnerContractAddress ?? "";
  const hasRequiredConfig =
    settings.hydrated &&
    Boolean(settings.value.apiUrl) &&
    Boolean(settings.value.minaNodeUrl) &&
    Boolean(treasuryOwnerAddress);

  useEffect(() => {
    submissionDraftRef.current = submissionDraft;
  }, [submissionDraft]);

  useEffect(() => {
    preparedFlowRef.current = preparedFlow;
  }, [preparedFlow]);

  useEffect(() => {
    if (
      !settings.hydrated ||
      !settings.value.apiUrl ||
      resolvedLifecycleId == null ||
      !treasuryOwnerAddress
    ) {
      setEstimateContext({});
      return;
    }

    let cancelled = false;
    void fetchLifecycleProposalEstimateContext(
      settings.value.apiUrl,
      settings.value.minaNodeUrl,
      resolvedLifecycleId,
      treasuryOwnerAddress,
    )
      .then((nextEstimateContext) => {
        if (cancelled) {
          return;
        }
        setEstimateContext(nextEstimateContext);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setEstimateContext({});
      });

    return () => {
      cancelled = true;
    };
  }, [
    resolvedLifecycleId,
    settings.hydrated,
    settings.value.apiUrl,
    treasuryOwnerAddress,
  ]);

  const handleSaveDraft = (draft: TreasuryProposalCreationDraft): void => {
    saveDraft(draft, draftId);
    router.push(
      resolveBackHref(previousPage, draft.lifecycleId ?? resolvedLifecycleId),
      {
        scroll: false,
      },
    );
  };

  const handleSubmit = (draft: TreasuryProposalCreationDraft): void => {
    setSubmissionDraft(draft);
    submissionDraftRef.current = draft;
    setPreparedFlow(null);
    preparedFlowRef.current = null;
    setDialogOpen(true);
  };

  if (!settings.hydrated) {
    return (
      <section className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[48rem] w-full" />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {!hasRequiredConfig ? (
        <Alert variant="destructive">
          <AlertTitle>Proposal creation is not configured</AlertTitle>
          <AlertDescription>
            Configure the treasury API URL, Mina node URL, and treasury owner
            contract address before creating proposals from the web app.
          </AlertDescription>
        </Alert>
      ) : null}

      <TreasuryProposalCreationForm
        lifecycleId={resolvedLifecycleId}
        connectedWalletAddress={wallet.address ?? null}
        currentPeriod={createProposalPeriod}
        treasuryBalance={estimateContext.treasuryBalance}
        eligibleVotingWeight={estimateContext.eligibleVotingWeight}
        initialContent={selectedDraft?.draft.content}
        initialAmount={selectedDraft?.draft.amount}
        initialRecipient={selectedDraft?.draft.recipient}
        onSubmit={handleSubmit}
        onSaveDraft={handleSaveDraft}
        onCancel={() => {
          router.push(resolveBackHref(previousPage, resolvedLifecycleId), {
            scroll: false,
          });
        }}
        onConnectWalletClick={() => {
          void connectWallet();
        }}
      />

      {submissionDraft ? (
        <TreasuryTransactionFlowDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kind="createProposal"
          autoCloseDelaySeconds={5}
          senderAddress={submissionDraft.proposerAddress ?? null}
          summaryItems={buildCreateProposalSummaryItems(submissionDraft)}
          transactionDetailsCode={getCreateProposalTransactionDetails(
            preparedFlow?.preparedTransaction ?? null,
          )}
          submitLabel="Create proposal transaction"
          preventCloseWhileRunning
          onCompile={async (context) => {
            if (!hasRequiredConfig) {
              throw new Error("Proposal creation is not configured.");
            }
            await compile(context.signal);
          }}
          onProve={async (context) => {
            if (!hasRequiredConfig || resolvedLifecycleId == null) {
              throw new Error(
                "Lifecycle context is not available for proposal creation.",
              );
            }

            const { preparedTransaction, provedTransactionJson } =
              await buildAndProveCreateProposal(
                {
                  minaNodeUrl: settings.value.minaNodeUrl,
                  networkId: settings.value.networkId,
                  treasuryOwnerContractAddress: treasuryOwnerAddress,
                  senderAddress:
                    submissionDraft.proposerAddress ?? context.senderAddress,
                  lifecycleId: resolvedLifecycleId,
                  recipient: submissionDraft.recipient,
                  amount: submissionDraft.amount,
                  contents: submissionDraft.content,
                  fee: context.fee,
                  nonce: context.nonce,
                  memo: context.memo,
                },
                context.signal,
              );
            const nextPreparedFlow: PreparedCreateProposalFlow = {
              draft: submissionDraft,
              preparedTransaction,
              provedTransactionJson,
            };
            saveProposalContentRetryRecord({
              proposalPublicKey: preparedTransaction.proposalPublicKey,
              zkAppUriHash: preparedTransaction.zkAppUriHash,
              contents: submissionDraft.content,
              lastError: null,
            });
            preparedFlowRef.current = nextPreparedFlow;
            setPreparedFlow(nextPreparedFlow);
          }}
          onSignAndSend={async (context) => {
            if (
              !preparedFlowRef.current?.provedTransactionJson ||
              !preparedFlowRef.current.preparedTransaction
            ) {
              throw new Error(
                "Proposal transaction was not prepared before signing.",
              );
            }

            logWalletSubmissionTransaction(
              "create proposal before wallet sign",
              preparedFlowRef.current.provedTransactionJson,
            );
            const hash = await signAndSubmitZkapp({
              minaNodeUrl: settings.value.minaNodeUrl,
              networkId: settings.value.networkId ?? "DEVNET",
              transactionJson: preparedFlowRef.current.provedTransactionJson,
              expectedSenderAddress: context.senderAddress,
              fee: context.fee,
              memo: context.memo,
              nonce: context.nonce,
              signal: context.signal,
            });

            if (preparedFlowRef.current) {
              updateProposalContentRetryRecord(
                preparedFlowRef.current.preparedTransaction.proposalPublicKey,
                {
                  transactionHash: hash,
                  lastError: null,
                },
              );
              preparedFlowRef.current = {
                ...preparedFlowRef.current,
                transactionHash: hash,
              };
              setPreparedFlow(preparedFlowRef.current);
            }

            return {
              hash,
            };
          }}
          onWaitForInclusion={async (context) => {
            const { hash } = context;
            if (!hash) {
              throw new Error("Transaction hash is missing.");
            }
            await waitForTransactionInclusion(
              settings.value.minaNodeUrl,
              hash,
              context.signal,
            );
            return { hash };
          }}
          onPostInclusion={async (context) => {
            if (!preparedFlowRef.current?.preparedTransaction) {
              throw new Error("Prepared proposal metadata is missing.");
            }
            const activeSubmissionDraft = submissionDraftRef.current;
            if (!activeSubmissionDraft) {
              throw new Error("Proposal draft is missing.");
            }
            const proposalPublicKey =
              preparedFlowRef.current.preparedTransaction.proposalPublicKey;
            updateProposalContentRetryRecord(proposalPublicKey, {
              lastAttemptAt: new Date().toISOString(),
              lastError: null,
            });
            try {
              await submitProposalContents({
                apiUrl: settings.value.apiUrl,
                proposalPublicKey,
                contents: activeSubmissionDraft.content,
                signal: context.signal,
              });
              removeProposalContentRetryRecord(proposalPublicKey);
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Failed to submit proposal contents.";
              updateProposalContentRetryRecord(proposalPublicKey, {
                lastError: message,
              });
              throw error;
            }
          }}
          onComplete={() => {
            const proposalPublicKey =
              preparedFlowRef.current?.preparedTransaction.proposalPublicKey;
            if (draftId) {
              removeDraft(draftId);
            }
            setDialogOpen(false);
            setSubmissionDraft(null);
            submissionDraftRef.current = null;
            setPreparedFlow(null);
            preparedFlowRef.current = null;
            if (proposalPublicKey) {
              router.push(
                `/proposals/${encodeURIComponent(proposalPublicKey)}`,
                {
                  scroll: false,
                },
              );
            }
          }}
          onError={(error) => {
            setAppError(error.message);
          }}
        />
      ) : null}
    </section>
  );
}
