"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { TreasuryProposalDetail } from "@repo/ui/treasury-proposal-detail";
import { TreasuryTransactionFlowDialog } from "@repo/ui/treasury-transaction-flow-dialog";
import type { TreasuryTransactionSummaryItem } from "@repo/ui/treasury-transaction-flow-dialog";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import { useWalletSession } from "../../treasury-header/hooks/use-wallet-session";
import {
  fetchProposalExecutions,
  fetchProposalItems,
  fetchProposalVotes,
  mapProposalItemToDetailProposal,
} from "../../treasury-header/lib/treasury-header-api";
import { applyDerivedProposalPresentationToDetail } from "../lib/proposal-presentation";
import {
  type PreparedExecuteProposalTransaction,
  type PreparedVoteProposalTransaction,
  type ProposalVoteChoice,
} from "../lib/proposal-prover-runtime";
import { useProposalProverWorker } from "../hooks/use-proposal-prover-worker";
import { waitForTransactionInclusion } from "../lib/transaction-inclusion";

interface ProposalDetailPageContainerProps {
  proposalId: string;
}

interface PreparedVoteFlow {
  vote: ProposalVoteChoice;
  preparedTransaction: PreparedVoteProposalTransaction;
  provedTransactionJson?: string;
  transactionHash?: string;
}

interface PreparedExecuteFlow {
  amount: string;
  preparedTransaction: PreparedExecuteProposalTransaction;
  provedTransactionJson?: string;
  transactionHash?: string;
}

interface DirectSendZkappResponse {
  data?: {
    sendZkapp?: {
      zkapp?: {
        hash?: string | null;
        id?: string | null;
        failureReason?:
          | Array<{
              failures?: string[] | null;
              index?: number | null;
            }>
          | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

function buildSendZkappMutation(transactionJson: string): string {
  return `mutation {
  sendZkapp(input: {
    zkappCommand: ${JSON.stringify(JSON.parse(transactionJson), null, 2).replace(
      /\"(\S+)\"\s*:/gm,
      "$1:",
    )}
  }) {
    zkapp {
      hash
      id
      failureReason {
        failures
        index
      }
    }
  }
}`;
}

async function submitZkappDirectly(minaNodeUrl: string, transactionJson: string): Promise<string> {
  const requestBody = {
    query: buildSendZkappMutation(transactionJson),
  };

  console.info("[proposal-prover][direct-send] request", {
    minaNodeUrl,
    requestBody,
  });

  const response = await fetch(minaNodeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Direct transaction submit failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as DirectSendZkappResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join("; "));
  }

  const zkapp = payload.data?.sendZkapp?.zkapp;
  if (!zkapp) {
    throw new Error("Direct transaction submit did not return a zkApp payload.");
  }

  if (zkapp.failureReason?.length) {
    throw new Error(
      `Direct transaction submit was rejected: ${zkapp.failureReason
        .map((reason) => `${reason.index ?? "unknown"}:${reason.failures?.join(", ") ?? "unknown"}`)
        .join("; ")}`,
    );
  }

  const hash = zkapp.hash ?? zkapp.id;
  if (!hash) {
    throw new Error("Direct transaction submit did not return a transaction hash.");
  }

  return hash;
}

function logWalletSubmissionTransaction(label: string, transactionJson: string): void {
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
    console.error("[proposal-prover][wallet-submit] failed to inspect transaction json", {
      label,
      error,
    });
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
    { label: "Proposal address", value: proposal.proposalAddress ?? "-", mono: true },
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
    { label: "Proposal address", value: proposal.proposalAddress ?? proposal.id, mono: true },
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
      parsedTransaction && typeof parsedTransaction === "object" && !Array.isArray(parsedTransaction)
        ? (() => {
            const { accountUpdates: _accountUpdates, ...rest } = parsedTransaction;
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
      parsedTransaction && typeof parsedTransaction === "object" && !Array.isArray(parsedTransaction)
        ? (() => {
            const { accountUpdates: _accountUpdates, ...rest } = parsedTransaction;
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
  const {
    compile,
    buildAndProveVoteProposal,
    buildAndProveExecuteProposal,
  } = useProposalProverWorker(proofsEnabled);
  const [proposal, setProposal] = useState<ReturnType<typeof mapProposalItemToDetailProposal> | null>(
    null,
  );
  const [votes, setVotes] = useState<Parameters<typeof TreasuryProposalDetail>[0]["votes"]>([]);
  const [executions, setExecutions] = useState<Parameters<typeof TreasuryProposalDetail>[0]["executions"]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [voteRequest, setVoteRequest] = useState<ProposalVoteChoice | null>(null);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [preparedVoteFlow, setPreparedVoteFlow] = useState<PreparedVoteFlow | null>(null);
  const [executeAmount, setExecuteAmount] = useState<string | null>(null);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [preparedExecuteFlow, setPreparedExecuteFlow] = useState<PreparedExecuteFlow | null>(null);
  const voteRequestRef = useRef<ProposalVoteChoice | null>(null);
  const preparedVoteFlowRef = useRef<PreparedVoteFlow | null>(null);
  const executeAmountRef = useRef<string | null>(null);
  const preparedExecuteFlowRef = useRef<PreparedExecuteFlow | null>(null);

  useEffect(() => {
    if (!settings.hydrated || !settings.value.apiUrl) {
      setProposal(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchProposalItems(settings.value.apiUrl, undefined, 200)
      .then(async (items) => {
        if (cancelled) {
          return;
        }

        const nextProposal =
          items.find(
            (item) =>
              item.proposalPublicKey === proposalId ||
              item.id === proposalId,
          ) ?? null;

        const nextPresentedProposal = nextProposal ? mapProposalItemToDetailProposal(nextProposal) : null;
        setProposal(nextPresentedProposal);

        if (!nextPresentedProposal?.proposalAddress) {
          setVotes([]);
          setExecutions([]);
          return;
        }

        try {
          const [nextVotes, nextExecutions] = await Promise.all([
            fetchProposalVotes(settings.value.apiUrl, nextPresentedProposal.proposalAddress),
            fetchProposalExecutions(settings.value.apiUrl, nextPresentedProposal.proposalAddress),
          ]);
          if (cancelled) {
            return;
          }
          setVotes(nextVotes);
          setExecutions(nextExecutions);
        } catch (error) {
          if (cancelled) {
            return;
          }
          setVotes([]);
          setExecutions([]);
          setAppError(
            error instanceof Error ? error.message : "Failed to fetch proposal vote and execution details.",
          );
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setProposal(null);
        setVotes([]);
        setExecutions([]);
        setAppError(error instanceof Error ? error.message : "Failed to fetch proposal detail.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshToken, setAppError, settings.hydrated, settings.value.apiUrl]);

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
  const hasRequiredConfig =
    settings.hydrated &&
    Boolean(settings.value.minaNodeUrl) &&
    Boolean(process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS);

  useEffect(() => {
    voteRequestRef.current = voteRequest;
  }, [voteRequest]);

  useEffect(() => {
    preparedVoteFlowRef.current = preparedVoteFlow;
  }, [preparedVoteFlow]);

  useEffect(() => {
    executeAmountRef.current = executeAmount;
  }, [executeAmount]);

  useEffect(() => {
    preparedExecuteFlowRef.current = preparedExecuteFlow;
  }, [preparedExecuteFlow]);

  if (!settings.hydrated || loading) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="mt-4 h-[42rem] w-full" />
      </section>
    );
  }

  if (!presentedProposal) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Proposal not found</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The selected proposal could not be found in the current indexed dataset.
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
        currentLifecycleId={treasury.currentLifecycleId}
        contentVerificationStatus={presentedProposal.contents ? "verified" : undefined}
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
          if (!presentedProposal.proposalAddress) {
            setAppError("Proposal public key is missing.");
            return;
          }
          setVoteRequest("yay");
          voteRequestRef.current = "yay";
          setPreparedVoteFlow(null);
          preparedVoteFlowRef.current = null;
          setVoteDialogOpen(true);
        }}
        onVoteNayClick={() => {
          if (!presentedProposal.proposalAddress) {
            setAppError("Proposal public key is missing.");
            return;
          }
          setVoteRequest("nay");
          voteRequestRef.current = "nay";
          setPreparedVoteFlow(null);
          preparedVoteFlowRef.current = null;
          setVoteDialogOpen(true);
        }}
        onVoteAbstainClick={() => {
          if (!presentedProposal.proposalAddress) {
            setAppError("Proposal public key is missing.");
            return;
          }
          setVoteRequest("abstain");
          voteRequestRef.current = "abstain";
          setPreparedVoteFlow(null);
          preparedVoteFlowRef.current = null;
          setVoteDialogOpen(true);
        }}
        onLifecycleClick={(lifecycleId) => {
          router.push(`/?lifecycleId=${lifecycleId}`);
        }}
        onExecutePayoutClick={(amount) => {
          if (!presentedProposal.proposalAddress || !presentedProposal.recipient) {
            setAppError("Proposal execution details are missing.");
            return;
          }
          setExecuteAmount(amount);
          executeAmountRef.current = amount;
          setPreparedExecuteFlow(null);
          preparedExecuteFlowRef.current = null;
          setExecuteDialogOpen(true);
        }}
      />
      {voteRequest ? (
        <TreasuryTransactionFlowDialog
          open={voteDialogOpen}
          onOpenChange={setVoteDialogOpen}
          kind="vote"
          autoCloseDelaySeconds={5}
          senderAddress={wallet.address ?? null}
          transactionDetailsCode={getVoteTransactionDetails(preparedVoteFlow?.preparedTransaction ?? null)}
          submitLabel="Cast vote transaction"
          summaryItems={buildVoteSummaryItems(
            presentedProposal,
            voteRequest,
            wallet.accountInfo?.votingWeight,
          )}
          onCompile={async () => {
            if (!hasRequiredConfig) {
              throw new Error("Proposal transaction configuration is missing.");
            }
            await compile();
          }}
          onProve={async (context) => {
            if (!hasRequiredConfig || !presentedProposal.proposalAddress) {
              throw new Error("Proposal vote details are missing.");
            }
            const nextVote = voteRequestRef.current;
            if (!nextVote) {
              throw new Error("Vote selection is missing.");
            }
            const { preparedTransaction, provedTransactionJson } =
              await buildAndProveVoteProposal({
                minaNodeUrl: settings.value.minaNodeUrl,
                treasuryOwnerContractAddress:
                  process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS ?? "",
                senderAddress: context.senderAddress,
                proposalPublicKey: presentedProposal.proposalAddress,
                vote: nextVote,
                fee: context.fee,
                nonce: context.nonce,
                memo: context.memo,
              });
            const nextPreparedVoteFlow: PreparedVoteFlow = {
              vote: nextVote,
              preparedTransaction,
              provedTransactionJson,
            };
            preparedVoteFlowRef.current = nextPreparedVoteFlow;
            setPreparedVoteFlow(nextPreparedVoteFlow);
          }}
          onSignAndSend={async (context) => {
            if (!preparedVoteFlowRef.current?.provedTransactionJson) {
              throw new Error("Vote transaction was not prepared before signing.");
            }
            logWalletSubmissionTransaction(
              "vote before direct send",
              preparedVoteFlowRef.current.provedTransactionJson,
            );
            const hash = await submitZkappDirectly(
              settings.value.minaNodeUrl,
              preparedVoteFlowRef.current.provedTransactionJson,
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
            await waitForTransactionInclusion(settings.value.minaNodeUrl, hash);
            return { hash };
          }}
          onComplete={() => {
            setVoteDialogOpen(false);
            setVoteRequest(null);
            voteRequestRef.current = null;
            setPreparedVoteFlow(null);
            preparedVoteFlowRef.current = null;
            forceRefresh();
          }}
          onError={(error) => {
            setAppError(error.message);
          }}
        />
      ) : null}
      {executeAmount ? (
        <TreasuryTransactionFlowDialog
          open={executeDialogOpen}
          onOpenChange={setExecuteDialogOpen}
          kind="executeProposal"
          autoCloseDelaySeconds={5}
          senderAddress={wallet.address ?? null}
          transactionDetailsCode={getExecuteTransactionDetails(
            preparedExecuteFlow?.preparedTransaction ?? null,
          )}
          submitLabel="Execute payout transaction"
          summaryItems={buildExecuteSummaryItems(
            presentedProposal,
            presentedProposal.recipient ?? "-",
            executeAmount,
          )}
          onCompile={async () => {
            if (!hasRequiredConfig) {
              throw new Error("Proposal transaction configuration is missing.");
            }
            await compile();
          }}
          onProve={async (context) => {
            if (
              !hasRequiredConfig ||
              !presentedProposal.proposalAddress ||
              !presentedProposal.recipient
            ) {
              throw new Error("Proposal execution details are missing.");
            }
            const nextAmount = executeAmountRef.current;
            if (!nextAmount) {
              throw new Error("Payout amount is missing.");
            }
            const { preparedTransaction, provedTransactionJson } =
              await buildAndProveExecuteProposal({
                minaNodeUrl: settings.value.minaNodeUrl,
                treasuryOwnerContractAddress:
                  process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS ?? "",
                senderAddress: context.senderAddress,
                proposalPublicKey: presentedProposal.proposalAddress,
                recipient: presentedProposal.recipient,
                amount: nextAmount,
                fee: context.fee,
                nonce: context.nonce,
                memo: context.memo,
              });
            const nextPreparedExecuteFlow: PreparedExecuteFlow = {
              amount: nextAmount,
              preparedTransaction,
              provedTransactionJson,
            };
            preparedExecuteFlowRef.current = nextPreparedExecuteFlow;
            setPreparedExecuteFlow(nextPreparedExecuteFlow);
          }}
          onSignAndSend={async () => {
            if (!preparedExecuteFlowRef.current?.provedTransactionJson) {
              throw new Error("Execute transaction was not prepared before signing.");
            }
            logWalletSubmissionTransaction(
              "execute before direct send",
              preparedExecuteFlowRef.current.provedTransactionJson,
            );
            const hash = await submitZkappDirectly(
              settings.value.minaNodeUrl,
              preparedExecuteFlowRef.current.provedTransactionJson,
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
            await waitForTransactionInclusion(settings.value.minaNodeUrl, hash);
            return { hash };
          }}
          onComplete={() => {
            setExecuteDialogOpen(false);
            setExecuteAmount(null);
            executeAmountRef.current = null;
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
