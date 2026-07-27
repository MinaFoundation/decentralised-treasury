"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { TreasuryProposalDetail } from "@repo/ui/treasury-proposal-detail";
import { TreasuryTransactionFlowDialog } from "@repo/ui/treasury-transaction-flow-dialog";
import type { TreasuryTransactionSummaryItem } from "@repo/ui/treasury-transaction-flow-dialog";
import { withMinimumLoadingDuration } from "../../app-shell/lib/minimum-loading-duration";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import { useWalletSession } from "../../treasury-header/hooks/use-wallet-session";
import {
  fetchProposalExecutionsPage,
  fetchProposalItem,
  fetchProposalVotesPage,
  mapProposalItemToDetailProposal,
} from "../../treasury-header/lib/treasury-header-api";
import { applyDerivedProposalPresentationToDetail } from "../lib/proposal-presentation";
import {
  type PreparedExecuteProposalTransaction,
  type PreparedVoteProposalTransaction,
  type ProposalVoteChoice,
} from "../lib/proposal-prover-runtime";
import { useProposalProverWorker } from "../hooks/use-proposal-prover-worker";
import { signWithAuroWalletAndSubmitZkapp } from "../lib/auro-wallet-zkapp-submission";
import { submitProposalContents } from "../lib/proposal-content-submission";
import {
  getProposalContentRetryRecord,
  PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT,
  removeProposalContentRetryRecord,
  type ProposalContentRetryRecord,
  updateProposalContentRetryRecord,
} from "../lib/proposal-content-retry-store";
import { waitForTransactionInclusion } from "../lib/transaction-inclusion";

interface ProposalDetailPageContainerProps {
  proposalId: string;
}

type DetailPageSize = 10 | 20 | 30 | 40 | 50;

interface PreparedVoteFlow {
  routeProposalId: string;
  vote: ProposalVoteChoice;
  preparedTransaction: PreparedVoteProposalTransaction;
  provedTransactionJson?: string;
  transactionHash?: string;
}

interface PreparedExecuteFlow {
  routeProposalId: string;
  amount: string;
  preparedTransaction: PreparedExecuteProposalTransaction;
  provedTransactionJson?: string;
  transactionHash?: string;
}

type DetailProposal = NonNullable<
  ReturnType<typeof mapProposalItemToDetailProposal>
>;

interface VoteFlowSession {
  routeProposalId: string;
  proposal: DetailProposal;
  vote: ProposalVoteChoice;
  senderAddress: string | null;
  votingWeight: string | null | undefined;
  minaNodeUrl: string;
  treasuryOwnerContractAddress: string;
}

interface ExecuteFlowSession {
  routeProposalId: string;
  proposal: DetailProposal;
  amount: string;
  senderAddress: string | null;
  minaNodeUrl: string;
  treasuryOwnerContractAddress: string;
}

const PROPOSAL_DETAIL_SKELETON_LINE_WIDTHS = [
  "w-full",
  "w-[94%]",
  "w-[88%]",
  "w-[97%]",
  "w-[76%]",
] as const;

function ProposalDetailPanelSkeleton({
  rows = 3,
}: {
  rows?: number;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-[min(100%,19rem)]" />
      </div>
      <div className="space-y-4 rounded-xl border border-border/70 bg-background px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-8 rounded-md" />
          <Skeleton className="h-8 rounded-md" />
        </div>
        <div className="space-y-3 border-t border-border/60 pt-4">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4 border-b border-border/50 pb-3 last:border-0 last:pb-0"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </section>
  );
}

function ProposalDetailTableSkeleton(): JSX.Element {
  return (
    <section className="space-y-2">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-[min(100%,22rem)]" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="grid grid-cols-4 gap-4 border-b bg-muted/20 px-6 py-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              key={index}
              className={index === 0 ? "h-3 w-20" : "h-3 w-14"}
            />
          ))}
        </div>
        {Array.from({ length: 3 }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="grid grid-cols-4 gap-4 border-b border-border/50 px-6 py-4 last:border-0"
          >
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-4 w-[65%]" />
            <Skeleton className="h-4 w-[70%]" />
            <Skeleton className="h-4 w-[55%]" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ProposalDetailPageSkeleton(): JSX.Element {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-component="proposal-detail-loading"
    >
      <span className="sr-only">Loading proposal details</span>
      <div
        className="grid items-start gap-6 lg:grid-cols-[1.75fr,0.78fr]"
        aria-hidden="true"
      >
        <section className="min-w-0 space-y-4 lg:border-r lg:border-border/60 lg:pr-6">
          <div className="flex min-h-[3.25rem] items-center justify-between gap-4 px-1 py-0.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-7 w-32 rounded-full" />
          </div>
          <section className="space-y-4 rounded-2xl border border-primary/15 bg-primary/[0.025] px-5 py-4">
            <Skeleton className="h-9 w-[min(86%,34rem)]" />
            <div className="border-t border-primary/10 pt-4">
              <Skeleton className="mb-4 h-6 w-20" />
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton
                      className={index > 5 ? "h-4 w-full" : "h-4 w-[80%]"}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="min-h-[28rem] space-y-7 py-2 sm:min-h-[34rem]">
            <div className="space-y-3">
              <Skeleton className="h-7 w-[min(72%,28rem)]" />
              <Skeleton className="h-4 w-[min(48%,18rem)]" />
            </div>
            {Array.from({ length: 3 }, (_, paragraphIndex) => (
              <div key={paragraphIndex} className="space-y-2.5">
                {paragraphIndex > 0 ? (
                  <Skeleton className="mb-3 h-5 w-40" />
                ) : null}
                {PROPOSAL_DETAIL_SKELETON_LINE_WIDTHS.map(
                  (width, lineIndex) => (
                    <Skeleton key={lineIndex} className={`h-4 ${width}`} />
                  ),
                )}
              </div>
            ))}
          </div>
        </section>
        <aside className="space-y-4">
          <ProposalDetailPanelSkeleton rows={4} />
          <ProposalDetailPanelSkeleton rows={3} />
        </aside>
      </div>
      <div aria-hidden="true" className="space-y-6">
        <ProposalDetailTableSkeleton />
        <ProposalDetailTableSkeleton />
      </div>
    </div>
  );
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
  const rawValue = process.env.NEXT_PUBLIC_PROOFS_ENABLED;
  const resolved = rawValue !== "false";
  console.info("[proposal-prover][config] proposal detail proofs flag", {
    rawValue,
    resolved,
  });
  return resolved;
}

function buildVoteSummaryItems(
  proposal: NonNullable<ReturnType<typeof mapProposalItemToDetailProposal>>,
  vote: ProposalVoteChoice,
  votingWeight: string | null | undefined,
): TreasuryTransactionSummaryItem[] {
  const proposalTitle =
    proposal.title && proposal.title !== proposal.id
      ? proposal.title
      : "Untitled proposal";

  return [
    { label: "Proposal title", value: proposalTitle },
    { label: "Vote", value: vote.charAt(0).toUpperCase() + vote.slice(1) },
    {
      label: "Proposal address",
      value: proposal.proposalAddress ?? "-",
      mono: true,
    },
    { label: "Voting weight", value: votingWeight ?? "-" },
  ];
}

function buildExecuteSummaryItems(
  proposal: NonNullable<ReturnType<typeof mapProposalItemToDetailProposal>>,
  recipient: string,
  amount: string,
): TreasuryTransactionSummaryItem[] {
  return [
    { label: "Proposal", value: proposal.id },
    { label: "Recipient wallet", value: recipient, mono: true },
    { label: "Amount to pay out", value: `${amount} MINA` },
    {
      label: "Proposal address",
      value: proposal.proposalAddress ?? proposal.id,
      mono: true,
    },
  ];
}

function getVoteTransactionDetails(
  prepared: PreparedVoteProposalTransaction | null,
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
        vote: prepared.vote,
        transaction: sanitizedTransaction,
      },
      null,
      2,
    );
  } catch {
    return undefined;
  }
}

function getExecuteTransactionDetails(
  prepared: PreparedExecuteProposalTransaction | null,
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
        recipient: prepared.recipient,
        amount: prepared.amount,
        transaction: sanitizedTransaction,
      },
      null,
      2,
    );
  } catch {
    return undefined;
  }
}

export function ProposalDetailPageContainer({
  proposalId,
}: ProposalDetailPageContainerProps): JSX.Element {
  const router = useRouter();
  const settings = useEndpointSettingsState();
  const treasury = useTreasuryState();
  const { wallet, connectWallet } = useWalletSession();
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const forceRefresh = useMinaBlockStore((state) => state.forceRefresh);
  const setAppError = useAppShellStore((state) => state.setError);
  const proofsEnabled = resolveProofsEnabled();
  const { compile, buildAndProveVoteProposal, buildAndProveExecuteProposal } =
    useProposalProverWorker(proofsEnabled);
  const [proposal, setProposal] = useState<ReturnType<
    typeof mapProposalItemToDetailProposal
  > | null>(null);
  const [votes, setVotes] = useState<
    Parameters<typeof TreasuryProposalDetail>[0]["votes"]
  >([]);
  const [executions, setExecutions] = useState<
    Parameters<typeof TreasuryProposalDetail>[0]["executions"]
  >([]);
  const [votesPage, setVotesPage] = useState(1);
  const [votesPageSize, setVotesPageSize] = useState<DetailPageSize>(10);
  const [votesTotalCount, setVotesTotalCount] = useState(0);
  const [votesLoading, setVotesLoading] = useState(false);
  const [votesInitialized, setVotesInitialized] = useState(false);
  const [executionsPage, setExecutionsPage] = useState(1);
  const [executionsPageSize, setExecutionsPageSize] =
    useState<DetailPageSize>(10);
  const [executionsTotalCount, setExecutionsTotalCount] = useState(0);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionsInitialized, setExecutionsInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [voteSession, setVoteSession] = useState<VoteFlowSession | null>(null);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [voteDialogSession, setVoteDialogSession] = useState(0);
  const [preparedVoteFlow, setPreparedVoteFlow] =
    useState<PreparedVoteFlow | null>(null);
  const [executeSession, setExecuteSession] =
    useState<ExecuteFlowSession | null>(null);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [executeDialogSession, setExecuteDialogSession] = useState(0);
  const [preparedExecuteFlow, setPreparedExecuteFlow] =
    useState<PreparedExecuteFlow | null>(null);
  const [contentRetryRecord, setContentRetryRecord] =
    useState<ProposalContentRetryRecord | null>(null);
  const [isRetryingContentSubmission, setIsRetryingContentSubmission] =
    useState(false);
  const [contentRetryError, setContentRetryError] = useState<string | null>(
    null,
  );
  const preparedVoteFlowRef = useRef<PreparedVoteFlow | null>(null);
  const preparedExecuteFlowRef = useRef<PreparedExecuteFlow | null>(null);
  const loadedProposalKeyRef = useRef<string | null>(null);
  const loadedVotesQueryRef = useRef<string | null>(null);
  const loadedExecutionsQueryRef = useRef<string | null>(null);

  useEffect(() => {
    setVotesPage(1);
    setExecutionsPage(1);
  }, [proposalId]);

  useEffect(() => {
    loadedProposalKeyRef.current = null;
    loadedVotesQueryRef.current = null;
    loadedExecutionsQueryRef.current = null;
    setProposal(null);
    setLoading(true);
    setVotes([]);
    setVotesTotalCount(0);
    setVotesInitialized(false);
    setExecutions([]);
    setExecutionsTotalCount(0);
    setExecutionsInitialized(false);
  }, [proposalId]);

  useEffect(() => {
    setVoteDialogOpen(false);
    setVoteSession(null);
    setPreparedVoteFlow(null);
    preparedVoteFlowRef.current = null;
    setExecuteDialogOpen(false);
    setExecuteSession(null);
    setPreparedExecuteFlow(null);
    preparedExecuteFlowRef.current = null;
  }, [proposalId, wallet.address]);

  useEffect(() => {
    if (!settings.hydrated) {
      loadedProposalKeyRef.current = null;
      setProposal(null);
      setLoading(true);
      return;
    }
    if (!settings.value.apiUrl) {
      loadedProposalKeyRef.current = null;
      setProposal(null);
      setVotesInitialized(true);
      setExecutionsInitialized(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const proposalKey = `${settings.value.apiUrl}:${proposalId}`;
    const isInitialProposalLoad = loadedProposalKeyRef.current !== proposalKey;
    if (isInitialProposalLoad) {
      loadedVotesQueryRef.current = null;
      loadedExecutionsQueryRef.current = null;
      setLoading(true);
      setProposal(null);
      setVotesInitialized(false);
      setExecutionsInitialized(false);
    }

    const request = fetchProposalItem(settings.value.apiUrl, proposalId);

    void (isInitialProposalLoad ? withMinimumLoadingDuration(request) : request)
      .then((nextProposal) => {
        if (cancelled) {
          return;
        }

        const nextPresentedProposal = nextProposal
          ? mapProposalItemToDetailProposal(nextProposal)
          : null;
        setProposal(nextPresentedProposal);
        loadedProposalKeyRef.current = proposalKey;
        if (!nextPresentedProposal?.proposalAddress) {
          setVotes([]);
          setVotesTotalCount(0);
          setVotesInitialized(true);
          setExecutions([]);
          setExecutionsTotalCount(0);
          setExecutionsInitialized(true);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (isInitialProposalLoad) {
          setProposal(null);
          setVotes([]);
          setVotesTotalCount(0);
          setVotesInitialized(true);
          setExecutions([]);
          setExecutionsTotalCount(0);
          setExecutionsInitialized(true);
        }
        setAppError(
          error instanceof Error
            ? error.message
            : "Failed to fetch proposal detail.",
        );
      })
      .finally(() => {
        if (!cancelled && isInitialProposalLoad) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    proposalId,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
  ]);

  useEffect(() => {
    const proposalPublicKey = proposal?.proposalAddress;
    if (!settings.hydrated || !settings.value.apiUrl || !proposalPublicKey) {
      return;
    }

    let cancelled = false;
    const votesQueryKey = JSON.stringify({
      apiUrl: settings.value.apiUrl,
      proposalPublicKey,
      page: votesPage,
      pageSize: votesPageSize,
    });
    const isInitialVotesLoad = loadedVotesQueryRef.current !== votesQueryKey;
    if (isInitialVotesLoad) {
      setVotesLoading(true);
    }

    const request = fetchProposalVotesPage(
      settings.value.apiUrl,
      proposalPublicKey,
      {
        limit: votesPageSize,
        offset: (votesPage - 1) * votesPageSize,
      },
    );

    void (isInitialVotesLoad ? withMinimumLoadingDuration(request) : request)
      .then((result) => {
        if (!cancelled) {
          setVotes(result.items);
          setVotesTotalCount(result.total);
          loadedVotesQueryRef.current = votesQueryKey;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (isInitialVotesLoad) {
            setVotes([]);
            setVotesTotalCount(0);
          }
          setAppError(
            error instanceof Error
              ? error.message
              : "Failed to fetch proposal votes.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (isInitialVotesLoad) {
            setVotesLoading(false);
          }
          setVotesInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    proposal?.proposalAddress,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
    votesPage,
    votesPageSize,
  ]);

  useEffect(() => {
    const proposalPublicKey = proposal?.proposalAddress;
    if (!settings.hydrated || !settings.value.apiUrl || !proposalPublicKey) {
      return;
    }

    let cancelled = false;
    const executionsQueryKey = JSON.stringify({
      apiUrl: settings.value.apiUrl,
      proposalPublicKey,
      page: executionsPage,
      pageSize: executionsPageSize,
    });
    const isInitialExecutionsLoad =
      loadedExecutionsQueryRef.current !== executionsQueryKey;
    if (isInitialExecutionsLoad) {
      setExecutionsLoading(true);
    }

    const request = fetchProposalExecutionsPage(
      settings.value.apiUrl,
      proposalPublicKey,
      {
        limit: executionsPageSize,
        offset: (executionsPage - 1) * executionsPageSize,
      },
    );

    void (
      isInitialExecutionsLoad ? withMinimumLoadingDuration(request) : request
    )
      .then((result) => {
        if (!cancelled) {
          setExecutions(result.items);
          setExecutionsTotalCount(result.total);
          loadedExecutionsQueryRef.current = executionsQueryKey;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (isInitialExecutionsLoad) {
            setExecutions([]);
            setExecutionsTotalCount(0);
          }
          setAppError(
            error instanceof Error
              ? error.message
              : "Failed to fetch proposal executions.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (isInitialExecutionsLoad) {
            setExecutionsLoading(false);
          }
          setExecutionsInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    executionsPage,
    executionsPageSize,
    proposal?.proposalAddress,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
  ]);

  const hasConnectedWallet = wallet.status === "connected";
  const presentedProposal = useMemo(
    () =>
      proposal
        ? applyDerivedProposalPresentationToDetail(
            proposal,
            treasury.currentLifecycleId,
            treasury.currentPeriod,
          )
        : null,
    [proposal, treasury.currentLifecycleId, treasury.currentPeriod],
  );
  const hasConnectedProposerWallet = useMemo(
    () =>
      hasConnectedWallet &&
      wallet.address != null &&
      presentedProposal?.proposer != null &&
      wallet.address === presentedProposal.proposer,
    [hasConnectedWallet, presentedProposal?.proposer, wallet.address],
  );
  useEffect(() => {
    preparedVoteFlowRef.current = preparedVoteFlow;
  }, [preparedVoteFlow]);

  useEffect(() => {
    preparedExecuteFlowRef.current = preparedExecuteFlow;
  }, [preparedExecuteFlow]);

  useEffect(() => {
    const proposalPublicKey = proposal?.proposalAddress;
    if (!proposalPublicKey) {
      setContentRetryRecord(null);
      return;
    }

    const syncRetryRecord = () => {
      setContentRetryRecord(getProposalContentRetryRecord(proposalPublicKey));
    };

    syncRetryRecord();
    window.addEventListener(
      PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT,
      syncRetryRecord,
    );
    window.addEventListener("storage", syncRetryRecord);
    return () => {
      window.removeEventListener(
        PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT,
        syncRetryRecord,
      );
      window.removeEventListener("storage", syncRetryRecord);
    };
  }, [proposal?.proposalAddress]);

  const matchingContentRetryRecord = useMemo(() => {
    if (!presentedProposal?.proposalAddress || presentedProposal.contents) {
      return null;
    }
    if (!contentRetryRecord) {
      return null;
    }
    if (
      presentedProposal.zkAppUriHash &&
      contentRetryRecord.zkAppUriHash !== presentedProposal.zkAppUriHash
    ) {
      return null;
    }
    return contentRetryRecord;
  }, [
    contentRetryRecord,
    presentedProposal?.contents,
    presentedProposal?.proposalAddress,
    presentedProposal?.zkAppUriHash,
  ]);

  const retryProposalContentSubmission = async (): Promise<void> => {
    const proposalPublicKey = presentedProposal?.proposalAddress;
    if (!matchingContentRetryRecord || !proposalPublicKey) {
      return;
    }
    setIsRetryingContentSubmission(true);
    setContentRetryError(null);
    updateProposalContentRetryRecord(proposalPublicKey, {
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    });
    try {
      await submitProposalContents({
        apiUrl: settings.value.apiUrl,
        proposalPublicKey,
        contents: matchingContentRetryRecord.contents,
      });
      removeProposalContentRetryRecord(proposalPublicKey);
      setContentRetryRecord(null);
      setProposal((current) => {
        if (!current || current.proposalAddress !== proposalPublicKey) {
          return current;
        }
        return {
          ...current,
          contents: matchingContentRetryRecord.contents,
        } as NonNullable<ReturnType<typeof mapProposalItemToDetailProposal>>;
      });
      forceRefresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to retry proposal content upload.";
      setContentRetryError(message);
      updateProposalContentRetryRecord(proposalPublicKey, {
        lastError: message,
      });
      setAppError(message);
    } finally {
      setIsRetryingContentSubmission(false);
    }
  };

  const openVoteSession = (vote: ProposalVoteChoice): void => {
    if (!presentedProposal?.proposalAddress) {
      setAppError("Proposal public key is missing.");
      return;
    }
    setVoteSession({
      routeProposalId: proposalId,
      proposal: presentedProposal,
      vote,
      senderAddress: wallet.address ?? null,
      votingWeight: wallet.accountInfo?.votingWeight,
      minaNodeUrl: settings.value.minaNodeUrl,
      treasuryOwnerContractAddress:
        process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS ?? "",
    });
    setPreparedVoteFlow(null);
    preparedVoteFlowRef.current = null;
    setVoteDialogSession((session) => session + 1);
    setVoteDialogOpen(true);
  };

  if (
    !settings.hydrated ||
    loading ||
    !votesInitialized ||
    !executionsInitialized
  ) {
    return <ProposalDetailPageSkeleton />;
  }

  if (!presentedProposal) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">
          Proposal not found
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The selected proposal could not be found in the current indexed
          dataset.
        </p>
      </section>
    );
  }

  return (
    <section>
      <TreasuryProposalDetail
        proposal={presentedProposal}
        votes={votes}
        executions={executions}
        votesPagination={{
          page: votesPage,
          pageSize: votesPageSize,
          totalCount: votesTotalCount,
          loading: votesLoading,
          onPageChange: setVotesPage,
          onPageSizeChange: (nextPageSize) => {
            setVotesPage(1);
            setVotesPageSize(nextPageSize);
          },
        }}
        executionsPagination={{
          page: executionsPage,
          pageSize: executionsPageSize,
          totalCount: executionsTotalCount,
          loading: executionsLoading,
          onPageChange: setExecutionsPage,
          onPageSizeChange: (nextPageSize) => {
            setExecutionsPage(1);
            setExecutionsPageSize(nextPageSize);
          },
        }}
        currentLifecycleId={treasury.currentLifecycleId}
        contentVerificationStatus={
          presentedProposal.contents
            ? "verified"
            : matchingContentRetryRecord
              ? "retryable"
              : undefined
        }
        canRetryContentSubmission={Boolean(matchingContentRetryRecord)}
        isRetryingContentSubmission={isRetryingContentSubmission}
        contentRetryError={
          contentRetryError ?? matchingContentRetryRecord?.lastError ?? null
        }
        contentRetryLastAttemptAt={
          matchingContentRetryRecord?.lastAttemptAt ?? null
        }
        hasConnectedWallet={hasConnectedWallet}
        connectedWalletVotingWeight={wallet.accountInfo?.votingWeight}
        hasConnectedProposerWallet={hasConnectedProposerWallet}
        onConnectWalletClick={() => {
          void connectWallet();
        }}
        onConnectProposerWalletClick={() => {
          void connectWallet();
        }}
        onVoteYayClick={() => {
          openVoteSession("yay");
        }}
        onVoteNayClick={() => {
          openVoteSession("nay");
        }}
        onVoteAbstainClick={() => {
          openVoteSession("abstain");
        }}
        onLifecycleClick={(lifecycleId) => {
          router.push(`/?lifecycleId=${lifecycleId}`);
        }}
        onExecutePayoutClick={(amount) => {
          if (
            !presentedProposal.proposalAddress ||
            !presentedProposal.recipient
          ) {
            setAppError("Proposal execution details are missing.");
            return;
          }
          setExecuteSession({
            routeProposalId: proposalId,
            proposal: presentedProposal,
            amount,
            senderAddress: wallet.address ?? null,
            minaNodeUrl: settings.value.minaNodeUrl,
            treasuryOwnerContractAddress:
              process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS ?? "",
          });
          setPreparedExecuteFlow(null);
          preparedExecuteFlowRef.current = null;
          setExecuteDialogSession((session) => session + 1);
          setExecuteDialogOpen(true);
        }}
        onRetryContentSubmission={() => {
          void retryProposalContentSubmission();
        }}
      />
      {voteSession ? (
        <TreasuryTransactionFlowDialog
          key={voteDialogSession}
          open={voteDialogOpen}
          onOpenChange={setVoteDialogOpen}
          kind="vote"
          autoCloseDelaySeconds={5}
          senderAddress={voteSession.senderAddress}
          transactionDetailsCode={getVoteTransactionDetails(
            preparedVoteFlow?.preparedTransaction ?? null,
          )}
          submitLabel="Cast vote transaction"
          summaryItems={buildVoteSummaryItems(
            voteSession.proposal,
            voteSession.vote,
            voteSession.votingWeight,
          )}
          onCompile={async () => {
            if (
              !voteSession.minaNodeUrl ||
              !voteSession.treasuryOwnerContractAddress
            ) {
              throw new Error("Proposal transaction configuration is missing.");
            }
            await compile();
          }}
          onProve={async (context) => {
            if (!voteSession.proposal.proposalAddress) {
              throw new Error("Proposal vote details are missing.");
            }
            const { preparedTransaction, provedTransactionJson } =
              await buildAndProveVoteProposal({
                minaNodeUrl: voteSession.minaNodeUrl,
                treasuryOwnerContractAddress:
                  voteSession.treasuryOwnerContractAddress,
                senderAddress: context.senderAddress,
                proposalPublicKey: voteSession.proposal.proposalAddress,
                vote: voteSession.vote,
                fee: context.fee,
                nonce: context.nonce,
                memo: context.memo,
              });
            const nextPreparedVoteFlow: PreparedVoteFlow = {
              routeProposalId: voteSession.routeProposalId,
              vote: voteSession.vote,
              preparedTransaction,
              provedTransactionJson,
            };
            preparedVoteFlowRef.current = nextPreparedVoteFlow;
            setPreparedVoteFlow(nextPreparedVoteFlow);
          }}
          onSignAndSend={async (context) => {
            const activePreparedVote = preparedVoteFlowRef.current;
            if (!activePreparedVote?.provedTransactionJson) {
              throw new Error(
                "Vote transaction was not prepared before signing.",
              );
            }
            if (
              activePreparedVote.routeProposalId !== voteSession.routeProposalId
            ) {
              throw new Error(
                "The active proposal changed while preparing this vote. Please retry.",
              );
            }

            console.info("[proposal-prover][wallet-submit] vote context", {
              feePayer: context.senderAddress,
              proposalPublicKey:
                activePreparedVote.preparedTransaction.proposalPublicKey,
              vote: activePreparedVote.vote,
              nonce: context.nonce,
            });
            logWalletSubmissionTransaction(
              "vote before Auro wallet sign",
              activePreparedVote.provedTransactionJson,
            );
            const hash = await signWithAuroWalletAndSubmitZkapp(
              voteSession.minaNodeUrl,
              activePreparedVote.provedTransactionJson,
              context.senderAddress,
              context.fee,
              context.memo,
              context.nonce,
            );
            if (preparedVoteFlowRef.current) {
              preparedVoteFlowRef.current = {
                ...preparedVoteFlowRef.current,
                transactionHash: hash,
              };
              setPreparedVoteFlow(preparedVoteFlowRef.current);
            }
            return { hash };
          }}
          onWaitForInclusion={async ({ hash }) => {
            if (!hash) {
              throw new Error("Transaction hash is missing.");
            }
            await waitForTransactionInclusion(voteSession.minaNodeUrl, hash);
            return { hash };
          }}
          onComplete={() => {
            setVoteDialogOpen(false);
            setVoteSession(null);
            setPreparedVoteFlow(null);
            preparedVoteFlowRef.current = null;
            forceRefresh();
          }}
          onError={(error) => {
            setAppError(error.message);
          }}
        />
      ) : null}
      {executeSession ? (
        <TreasuryTransactionFlowDialog
          key={executeDialogSession}
          open={executeDialogOpen}
          onOpenChange={setExecuteDialogOpen}
          kind="executeProposal"
          autoCloseDelaySeconds={5}
          senderAddress={executeSession.senderAddress}
          transactionDetailsCode={getExecuteTransactionDetails(
            preparedExecuteFlow?.preparedTransaction ?? null,
          )}
          submitLabel="Execute payout transaction"
          summaryItems={buildExecuteSummaryItems(
            executeSession.proposal,
            executeSession.proposal.recipient ?? "-",
            executeSession.amount,
          )}
          onCompile={async () => {
            if (
              !executeSession.minaNodeUrl ||
              !executeSession.treasuryOwnerContractAddress
            ) {
              throw new Error("Proposal transaction configuration is missing.");
            }
            await compile();
          }}
          onProve={async (context) => {
            if (
              !executeSession.proposal.proposalAddress ||
              !executeSession.proposal.recipient
            ) {
              throw new Error("Proposal execution details are missing.");
            }
            const { preparedTransaction, provedTransactionJson } =
              await buildAndProveExecuteProposal({
                minaNodeUrl: executeSession.minaNodeUrl,
                treasuryOwnerContractAddress:
                  executeSession.treasuryOwnerContractAddress,
                senderAddress: context.senderAddress,
                proposalPublicKey: executeSession.proposal.proposalAddress,
                recipient: executeSession.proposal.recipient,
                amount: executeSession.amount,
                fee: context.fee,
                nonce: context.nonce,
                memo: context.memo,
              });
            const nextPreparedExecuteFlow: PreparedExecuteFlow = {
              routeProposalId: executeSession.routeProposalId,
              amount: executeSession.amount,
              preparedTransaction,
              provedTransactionJson,
            };
            preparedExecuteFlowRef.current = nextPreparedExecuteFlow;
            setPreparedExecuteFlow(nextPreparedExecuteFlow);
          }}
          onSignAndSend={async (context) => {
            const activePreparedExecution = preparedExecuteFlowRef.current;
            if (!activePreparedExecution?.provedTransactionJson) {
              throw new Error(
                "Execute transaction was not prepared before signing.",
              );
            }
            if (
              activePreparedExecution.routeProposalId !==
              executeSession.routeProposalId
            ) {
              throw new Error(
                "The active proposal changed while preparing this execution. Please retry.",
              );
            }
            logWalletSubmissionTransaction(
              "execute before Auro wallet sign",
              activePreparedExecution.provedTransactionJson,
            );
            const hash = await signWithAuroWalletAndSubmitZkapp(
              executeSession.minaNodeUrl,
              activePreparedExecution.provedTransactionJson,
              context.senderAddress,
              context.fee,
              context.memo,
              context.nonce,
            );
            if (preparedExecuteFlowRef.current) {
              preparedExecuteFlowRef.current = {
                ...preparedExecuteFlowRef.current,
                transactionHash: hash,
              };
              setPreparedExecuteFlow(preparedExecuteFlowRef.current);
            }
            return { hash };
          }}
          onWaitForInclusion={async ({ hash }) => {
            if (!hash) {
              throw new Error("Transaction hash is missing.");
            }
            await waitForTransactionInclusion(executeSession.minaNodeUrl, hash);
            return { hash };
          }}
          onComplete={() => {
            setExecuteDialogOpen(false);
            setExecuteSession(null);
            setPreparedExecuteFlow(null);
            preparedExecuteFlowRef.current = null;
            forceRefresh();
          }}
          onError={(error) => {
            setAppError(error.message);
          }}
        />
      ) : null}
    </section>
  );
}
