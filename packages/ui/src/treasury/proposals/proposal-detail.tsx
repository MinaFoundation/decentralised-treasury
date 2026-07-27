import {
  ArrowUpRight,
  CircleAlert,
  CircleHelp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTreasuryIntl } from "../../i18n";
import { formatMinaAmountWithSuffix, parseMinaAmount } from "../../lib/mina";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "../../components/ui/card";
import { MinaAmountInput } from "../../components/ui/mina-amount-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  AcceptanceCriteriaCell,
  parsePeriodValue,
  type TreasuryProposalPeriodId,
  type TreasuryProposalTableEntry,
  VoteSummaryChart,
  formatBasisPointsPercent,
  parseVoteWeight,
  resolveApprovalActual,
  resolveApprovalRequirement,
  resolveDerivedStage,
  resolveEligibleVotingWeight,
  resolveParticipationActual,
  resolveParticipationRequirement,
  resolveStageBadgeClassName,
  resolveStageDescription,
  resolveStageVariant,
  resolveVoteSummary,
} from "./proposals-table";

export interface TreasuryProposalDetailProposal extends TreasuryProposalTableEntry {
  recipient?: string | null;
  zkAppUriHash?: string | null;
  stakingEpochDataLedgerHash?: string | null;
  paidOutAmount?: string | null;
  contents?: string | null;
  updatedAt?: string | null;
  createdAtBlockTimestamp?: string | null;
  isPaused?: boolean;
}

export interface TreasuryProposalVoteRow {
  id: string;
  voterPublicKey: string;
  vote: string;
  voteWeight: string;
  blockHeight?: number | null;
  isNullified?: boolean;
  status?: string | null;
}

export interface TreasuryProposalExecutionRow {
  id: string;
  recipient: string;
  amountToPayOut: string;
  bondAmount?: string | null;
  senderPublicKey?: string | null;
  paidOutAmount: string;
  remainingAmount: string;
  blockHeight?: number | null;
  status?: string | null;
}

export interface TreasuryDetailTablePagination {
  page: number;
  pageSize: 10 | 20 | 30 | 40 | 50;
  totalCount: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: 10 | 20 | 30 | 40 | 50) => void;
}

export interface TreasuryProposalDetailProps {
  proposal: TreasuryProposalDetailProposal;
  votes?: TreasuryProposalVoteRow[];
  executions?: TreasuryProposalExecutionRow[];
  votesPagination?: TreasuryDetailTablePagination;
  executionsPagination?: TreasuryDetailTablePagination;
  className?: string;
  currentLifecycleId?: number;
  statusDerivationPeriod?: TreasuryProposalPeriodId;
  tableInitialPageSize?: 10 | 20 | 30 | 40 | 50;
  contentVerificationStatus?: "loading" | "verified" | "mismatch" | "retryable";
  canRetryContentSubmission?: boolean;
  isRetryingContentSubmission?: boolean;
  contentRetryError?: string | null;
  contentRetryLastAttemptAt?: string | null;
  hasConnectedWallet?: boolean;
  connectedWalletVotingWeight?: string | null;
  onConnectWalletClick?: () => void;
  hasConnectedProposerWallet?: boolean;
  onConnectProposerWalletClick?: () => void;
  onVoteYayClick?: () => void;
  onVoteNayClick?: () => void;
  onVoteAbstainClick?: () => void;
  onLifecycleClick?: (lifecycleId: number) => void;
  onExecutePayoutClick?: (amount: string) => void;
  onRetryContentSubmission?: () => void;
}

// Mirrors `BOND_AMOUNT_DIVISOR` in the treasury contracts.
const PROPOSAL_BOND_AMOUNT_DIVISOR = 10;
const PROPOSAL_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-4 text-2xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-3 mt-6 text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-5 text-lg font-semibold tracking-tight first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-4 leading-7 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-4 list-disc space-y-2 pl-6 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-6 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-7">{children}</li>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-4 border-l-2 border-border pl-4 italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="mb-4 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-sm last:mb-0">
      {children}
    </pre>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-border/70" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table className="w-full min-w-[28rem] border-collapse border border-border/70 text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-muted/30">{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="border-t border-border/70">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-border/70 px-3 py-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-border/70 px-3 py-2 align-top">{children}</td>
  ),
  input: ({ checked, type }: { checked?: boolean; type?: string }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        readOnly
        className="mr-2 translate-y-[1px]"
      />
    ) : (
      <input type={type} disabled readOnly />
    ),
};

export function TreasuryProposalDetail({
  proposal,
  votes = [],
  executions = [],
  votesPagination,
  executionsPagination,
  className,
  currentLifecycleId,
  statusDerivationPeriod,
  tableInitialPageSize = 10,
  contentVerificationStatus,
  canRetryContentSubmission = false,
  isRetryingContentSubmission = false,
  contentRetryError,
  contentRetryLastAttemptAt,
  hasConnectedWallet = true,
  connectedWalletVotingWeight,
  onConnectWalletClick,
  hasConnectedProposerWallet = true,
  onConnectProposerWalletClick,
  onVoteYayClick,
  onVoteNayClick,
  onVoteAbstainClick,
  onLifecycleClick,
  onExecutePayoutClick,
  onRetryContentSubmission,
}: TreasuryProposalDetailProps): JSX.Element {
  const intl = useTreasuryIntl();
  const markdownContainerRef = useRef<HTMLDivElement | null>(null);
  const { title: contentTitle, body: contentBody } =
    extractMarkdownTitleAndBody(proposal.contents);
  const effectivePeriod =
    statusDerivationPeriod ?? parsePeriodValue(proposal.period) ?? null;
  const showVoteActions = effectivePeriod === "voting";
  const isPreVotingPeriod =
    effectivePeriod === "proposal" || effectivePeriod === "exploration";
  const normalizedInputStage = proposal.stage.trim().toLowerCase();
  const isProposalPaused =
    proposal.isPaused === true ||
    normalizedInputStage.includes("paused") ||
    normalizedInputStage.includes("vetoed");
  const hasZeroVotingWeight =
    hasConnectedWallet &&
    connectedWalletVotingWeight != null &&
    parseVoteWeight(connectedWalletVotingWeight) <= 0;
  const showDisabledPreVotingOverlay = isPreVotingPeriod;
  const showVoteActionOverlay =
    isProposalPaused || showDisabledPreVotingOverlay || hasZeroVotingWeight;
  const voteActionOverlayTitle = isProposalPaused
    ? intl.formatMessage({
        id: "ui.proposalDetail.pausedActionOverlayTitle",
        defaultMessage: "Proposal vetoed",
      })
    : showDisabledPreVotingOverlay
      ? intl.formatMessage({
          id: "ui.proposalDetail.waitingForVotingOverlayTitle",
          defaultMessage: "Waiting for voting to start",
        })
      : intl.formatMessage({
          id: "ui.proposalDetail.zeroVotingWeightOverlayTitle",
          defaultMessage: "Zero voting weight",
        });
  const voteActionOverlayMessage = isProposalPaused
    ? intl.formatMessage({
        id: "ui.proposalDetail.pausedActionOverlay",
        defaultMessage:
          "This proposal has been vetoed. Voting and execution actions are unavailable.",
      })
    : showDisabledPreVotingOverlay
      ? intl.formatMessage({
          id: "ui.proposalDetail.waitingForVotingOverlay",
          defaultMessage:
            "Voting actions will unlock once this proposal enters the voting period.",
        })
      : intl.formatMessage({
          id: "ui.proposalDetail.zeroVotingWeightOverlay",
          defaultMessage:
            "You have zero voting weight. Connect a wallet with more than zero voting weight.",
        });
  const resolvedStage = isProposalPaused
    ? "VETOED"
    : resolveDerivedStage(proposal, statusDerivationPeriod);
  const resolvedProposal = {
    ...proposal,
    stage: resolvedStage,
    voteSummary: resolveVoteSummary(proposal),
  };
  const resolvedTitle = contentTitle ?? proposal.title;
  const resolvedLifecycleId =
    typeof proposal.lifecycleId === "number"
      ? proposal.lifecycleId
      : proposal.lifecycleId != null &&
          Number.isFinite(Number(proposal.lifecycleId))
        ? Number(proposal.lifecycleId)
        : null;
  const hasExecutionHistory =
    (executionsPagination?.totalCount ?? executions.length) > 0;
  const requestedAmountValue = parseDisplayAmount(proposal.requestedAmount);
  const requestedAmountDisplay =
    formatMinaAmountWithSuffix(proposal.requestedAmount) ?? "-";
  const derivedBondAmountValue =
    requestedAmountValue != null && requestedAmountValue > 0
      ? Math.floor(requestedAmountValue / PROPOSAL_BOND_AMOUNT_DIVISOR)
      : null;
  const totalPayoutAmountValue =
    requestedAmountValue != null
      ? requestedAmountValue + (derivedBondAmountValue ?? 0)
      : null;
  const bondAmountDisplay =
    derivedBondAmountValue != null
      ? formatDisplayAmount(derivedBondAmountValue)
      : "-";
  const paidOutAmountDisplay =
    formatMinaAmountWithSuffix(proposal.paidOutAmount ?? "0") ?? "0 MINA";
  const paidOutAmountValue = parseDisplayAmount(paidOutAmountDisplay);
  const remainingAmountValue =
    totalPayoutAmountValue != null && paidOutAmountValue != null
      ? Math.max(totalPayoutAmountValue - paidOutAmountValue, 0)
      : null;
  const remainingAmountDisplay =
    remainingAmountValue != null
      ? formatDisplayAmount(remainingAmountValue)
      : "-";
  const normalizedResolvedStage = resolvedStage.trim().toLowerCase();
  const showEmptyVoteSummary =
    isPreVotingPeriod || normalizedResolvedStage === "abandoned";
  const hasOnChainTallySubmitted =
    proposal.latestVoteTally?.createdByEventType === "proposalVotesTallied";
  const isProposalPassed =
    normalizedResolvedStage === "passed" ||
    normalizedResolvedStage === "approved";
  const hasAdvancedBeyondProposalLifecycle =
    resolvedLifecycleId != null && currentLifecycleId != null
      ? currentLifecycleId > resolvedLifecycleId
      : null;
  const isExecutionLockedByCooldown =
    isProposalPassed &&
    (hasAdvancedBeyondProposalLifecycle === null
      ? effectivePeriod === "cooldown" || isPreVotingPeriod || showVoteActions
      : !hasAdvancedBeyondProposalLifecycle);
  const isFullyPaidOut =
    remainingAmountValue !== null && remainingAmountValue <= 0;
  const needsOnChainTallyBeforeExecution =
    !isProposalPaused &&
    !hasOnChainTallySubmitted &&
    !isPreVotingPeriod &&
    effectivePeriod !== "voting" &&
    !isFullyPaidOut;
  const canExecutePayout =
    !isProposalPaused &&
    isProposalPassed &&
    hasOnChainTallySubmitted &&
    !isExecutionLockedByCooldown &&
    !isFullyPaidOut;
  const executePayoutStatusLabel = isProposalPaused
    ? intl.formatMessage({
        id: "ui.proposalDetail.executePayoutPaused",
        defaultMessage: "VETOED",
      })
    : canExecutePayout
      ? hasExecutionHistory
        ? intl.formatMessage({
            id: "ui.proposalDetail.executePayoutInProgress",
            defaultMessage: "Payout available",
          })
        : intl.formatMessage({
            id: "ui.proposalDetail.executePayoutReady",
            defaultMessage: "Ready",
          })
      : isFullyPaidOut
        ? intl.formatMessage({
            id: "ui.proposalDetail.executePayoutComplete",
            defaultMessage: "Complete",
          })
        : needsOnChainTallyBeforeExecution
          ? intl.formatMessage({
              id: "ui.proposalDetail.executePayoutNeedsOnChainTally",
              defaultMessage: "Awaiting on-chain tally submission",
            })
          : isExecutionLockedByCooldown
            ? intl.formatMessage({
                id: "ui.proposalDetail.executePayoutCooldownLocked",
                defaultMessage: "Execution available post-cooldown",
              })
            : intl.formatMessage({
                id: "ui.proposalDetail.executePayoutLocked",
                defaultMessage: "Locked",
              });
  const executePayoutMessage = isProposalPaused
    ? intl.formatMessage({
        id: "ui.proposalDetail.executePayoutPausedMessage",
        defaultMessage:
          "This proposal has been vetoed. Voting and execution actions are disabled.",
      })
    : canExecutePayout
      ? hasExecutionHistory
        ? intl.formatMessage({
            id: "ui.proposalDetail.executePayoutContinueMessage",
            defaultMessage:
              "Cooldown has cleared and this proposal can continue payout from its remaining balance.",
          })
        : intl.formatMessage({
            id: "ui.proposalDetail.executePayoutReadyMessage",
            defaultMessage:
              "Cooldown has cleared and this passed proposal is ready to execute its first payout.",
          })
      : isFullyPaidOut
        ? intl.formatMessage({
            id: "ui.proposalDetail.executePayoutCompleteMessage",
            defaultMessage: "This proposal has already been fully paid out.",
          })
        : needsOnChainTallyBeforeExecution
          ? intl.formatMessage({
              id: "ui.proposalDetail.executePayoutNeedsOnChainTallyMessage",
              defaultMessage:
                "Voting has ended, but execution stays locked until the final on-chain tally is submitted.",
            })
          : isExecutionLockedByCooldown
            ? intl.formatMessage({
                id: "ui.proposalDetail.executePayoutCooldownMessage",
                defaultMessage:
                  "This proposal has been tallied on-chain and passed, but execution is only possible after cooldown ends.",
              })
            : isPreVotingPeriod
              ? intl.formatMessage({
                  id: "ui.proposalDetail.executePayoutBeforeVotingMessage",
                  defaultMessage:
                    "Execution opens only after the proposal passes voting and clears the cooldown period.",
                })
              : showVoteActions
                ? intl.formatMessage({
                    id: "ui.proposalDetail.executePayoutDuringVotingMessage",
                    defaultMessage:
                      "This proposal must finish voting with a passing result before execution can open.",
                  })
                : intl.formatMessage({
                    id: "ui.proposalDetail.executePayoutFailedMessage",
                    defaultMessage:
                      "Only proposals with a passing result can be executed for payout.",
                  });
  const executePayoutButtonLabel = isProposalPaused
    ? intl.formatMessage({
        id: "ui.proposalDetail.proposalPausedButton",
        defaultMessage: "Proposal vetoed",
      })
    : canExecutePayout
      ? hasExecutionHistory
        ? intl.formatMessage({
            id: "ui.proposalDetail.continuePayout",
            defaultMessage: "Continue payout",
          })
        : intl.formatMessage({
            id: "ui.proposalDetail.executeProposal",
            defaultMessage: "Execute proposal",
          })
      : isFullyPaidOut
        ? intl.formatMessage({
            id: "ui.proposalDetail.fullyPaidOut",
            defaultMessage: "Fully paid out",
          })
        : needsOnChainTallyBeforeExecution
          ? intl.formatMessage({
              id: "ui.proposalDetail.submitTallyFirst",
              defaultMessage: "Submit tally first",
            })
          : isExecutionLockedByCooldown
            ? intl.formatMessage({
                id: "ui.proposalDetail.availableAfterCooldown",
                defaultMessage: "Available post-cooldown",
              })
            : intl.formatMessage({
                id: "ui.proposalDetail.mustPassToExecute",
                defaultMessage: "Must pass to execute",
              });
  const [payoutAmountInput, setPayoutAmountInput] = useState("");
  const collapsedContentMaxHeightPx = 56 * 16;
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [contentIsOverflowing, setContentIsOverflowing] = useState(false);
  const [isVotingDetailsExpanded, setIsVotingDetailsExpanded] = useState(false);
  const requiresProposerWalletConnection =
    !isProposalPaused && canExecutePayout && !hasConnectedProposerWallet;
  const parsedPayoutAmountValue = parseInputAmount(payoutAmountInput);
  const payoutAmountError =
    canExecutePayout && hasConnectedProposerWallet
      ? payoutAmountInput.trim() === ""
        ? intl.formatMessage({
            id: "ui.proposalDetail.enterPayoutAmount",
            defaultMessage: "Enter a payout amount.",
          })
        : parsedPayoutAmountValue === null
          ? intl.formatMessage({
              id: "ui.proposalDetail.invalidPayoutAmount",
              defaultMessage: "Enter a valid MINA amount.",
            })
          : parsedPayoutAmountValue <= 0
            ? intl.formatMessage({
                id: "ui.proposalDetail.nonPositivePayoutAmount",
                defaultMessage: "Payout amount must be greater than zero.",
              })
            : remainingAmountValue !== null &&
                parsedPayoutAmountValue > remainingAmountValue
              ? intl.formatMessage(
                  {
                    id: "ui.proposalDetail.payoutExceedsRemaining",
                    defaultMessage:
                      "Payout amount cannot exceed the remaining payout of {remainingAmount}.",
                  },
                  { remainingAmount: remainingAmountDisplay },
                )
              : null
      : null;
  const canSubmitPayout =
    canExecutePayout &&
    hasConnectedProposerWallet &&
    payoutAmountError === null;
  const votingDetailRows = [
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.totalParticipatingVotes",
        defaultMessage: "Participating votes",
      }),
      value: formatWeight(proposal.latestVoteTally?.totalParticipatingVotes),
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.latestTallyBlock",
        defaultMessage: "Latest tally block",
      }),
      value: proposal.latestVoteTally?.blockHeight
        ? `#${proposal.latestVoteTally.blockHeight}`
        : "-",
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.totalEligibleWeight",
        defaultMessage: "Eligible voting weight",
      }),
      value: formatWeight(proposal.stakingEpochDataLedgerTotalCurrency),
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.requiredParticipationBp",
        defaultMessage: "Required participation",
      }),
      value:
        formatBasisPointsPercent(
          proposal.requiredParticipationBp ??
            proposal.latestVoteTally?.requiredParticipationBp,
        ) ?? "-",
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.requiredApprovalBp",
        defaultMessage: "Required approval",
      }),
      value:
        formatBasisPointsPercent(
          proposal.requiredApprovalBp ??
            proposal.latestVoteTally?.requiredApprovalBp,
        ) ?? "-",
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.requiredParticipationWeight",
        defaultMessage: "Required participation weight",
      }),
      value: formatWeight(
        proposal.requiredParticipation ??
          proposal.latestVoteTally?.requiredParticipation,
      ),
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.yayWeight",
        defaultMessage: "Yay weight",
      }),
      value: formatWeight(proposal.latestVoteTally?.yayWeight),
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.nayWeight",
        defaultMessage: "Nay weight",
      }),
      value: formatWeight(proposal.latestVoteTally?.nayWeight),
    },
    {
      label: intl.formatMessage({
        id: "ui.proposalDetail.abstainWeight",
        defaultMessage: "Abstain weight",
      }),
      value: formatWeight(proposal.latestVoteTally?.abstainWeight),
    },
  ];
  const votingDetailPreviewCount = 3;
  const visibleVotingDetailRows = isVotingDetailsExpanded
    ? votingDetailRows
    : votingDetailRows.slice(0, votingDetailPreviewCount);
  const hasHiddenVotingDetailRows =
    votingDetailRows.length > votingDetailPreviewCount;
  const votingSummary = isPreVotingPeriod
    ? { yay: 0, nay: 0, abstain: 0 }
    : resolvedProposal.voteSummary;

  useEffect(() => {
    const container = markdownContainerRef.current;

    if (!container || !contentBody) {
      setContentIsOverflowing(false);
      return;
    }

    const updateOverflowState = (): void => {
      setContentIsOverflowing(
        container.scrollHeight > collapsedContentMaxHeightPx + 1,
      );
    };

    const animationFrame = window.requestAnimationFrame(updateOverflowState);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateOverflowState)
        : null;

    resizeObserver?.observe(container);
    window.addEventListener("resize", updateOverflowState);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateOverflowState);
      resizeObserver?.disconnect();
    };
  }, [collapsedContentMaxHeightPx, contentBody]);

  useEffect(() => {
    setIsContentExpanded(false);
  }, [contentBody]);

  useEffect(() => {
    setIsVotingDetailsExpanded(false);
  }, [proposal.id, effectivePeriod]);

  useEffect(() => {
    if (!canExecutePayout || remainingAmountValue === null) {
      setPayoutAmountInput("");
      return;
    }
    setPayoutAmountInput(formatInputAmount(remainingAmountValue));
  }, [canExecutePayout, proposal.id, remainingAmountValue]);

  return (
    <TooltipProvider>
      <div className={cn("space-y-6", className)}>
        {isProposalPaused ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50/90 px-4 py-3 text-amber-950"
            data-component="proposal-paused-banner"
          >
            <CircleAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">
                {intl.formatMessage({
                  id: "ui.proposalDetail.pausedBannerTitle",
                  defaultMessage: "Proposal vetoed",
                })}
              </p>
              <p className="text-sm leading-6 text-amber-900/90">
                {intl.formatMessage({
                  id: "ui.proposalDetail.pausedBannerMessage",
                  defaultMessage:
                    "Voting and execution actions are disabled for this vetoed proposal.",
                })}
              </p>
            </div>
          </div>
        ) : null}
        <div className="grid items-stretch gap-6 lg:grid-cols-[1.75fr,0.78fr]">
          <section className="flex min-h-0 flex-col space-y-4 lg:border-r lg:border-border/60 lg:pr-6">
            <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-3 px-1 py-0.5">
              {resolvedLifecycleId != null && onLifecycleClick ? (
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <span>
                    {intl.formatMessage({
                      id: "ui.proposalDetail.proposalFromLifecycle",
                      defaultMessage: "Proposal from",
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto justify-start gap-1 px-0 py-0 text-[15px] font-medium text-primary underline underline-offset-4 hover:bg-transparent hover:text-primary/80"
                    onClick={() => {
                      onLifecycleClick(resolvedLifecycleId);
                    }}
                  >
                    <span>
                      {intl.formatMessage(
                        {
                          id: "ui.lifecycle.lifecycleId",
                          defaultMessage: "Lifecycle {id}",
                        },
                        { id: resolvedLifecycleId },
                      )}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <CardDescription className="text-muted-foreground">
                  {intl.formatMessage(
                    {
                      id: "ui.proposalDetail.proposalFromLifecycleFallback",
                      defaultMessage: "Proposal from Lifecycle {id}",
                    },
                    { id: proposal.lifecycleId ?? "-" },
                  )}
                </CardDescription>
              )}
              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant={resolveStageVariant(resolvedStage)}
                      className={cn(
                        "min-w-[8.5rem] justify-center px-3 py-1.5 text-xs",
                        resolveStageBadgeClassName(resolvedStage),
                      )}
                    >
                      {resolvedStage}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 text-center">
                    {resolveStageDescription(intl, resolvedStage)}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <section className="space-y-4 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] via-primary/[0.03] to-transparent px-5 py-4 shadow-[0_1px_0_rgba(0,0,0,0.015)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CardTitle className="flex-1 text-2xl leading-tight sm:text-[2rem]">
                  {resolvedTitle}
                </CardTitle>
              </div>
              <div className="border-t border-primary/10 pt-4">
                <div className="mb-3">
                  <CardTitle className="text-lg font-semibold tracking-tight sm:text-[1.35rem]">
                    {intl.formatMessage({
                      id: "ui.proposalDetail.detailsLabel",
                      defaultMessage: "Details",
                    })}
                  </CardTitle>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.amountLabel",
                      defaultMessage: "Amount",
                    })}
                    value={requestedAmountDisplay}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.createdAtLabel",
                      defaultMessage: "Created at",
                    })}
                    value={formatTimestamp(
                      proposal.createdAt,
                      proposal.createdAtBlock,
                    )}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.proposalAddressLabel",
                      defaultMessage: "Proposal address",
                    })}
                    value={truncateMiddle(
                      proposal.proposalAddress ?? proposal.id,
                    )}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.recipientLabel",
                      defaultMessage: "Recipient",
                    })}
                    value={truncateMiddle(proposal.recipient ?? "-")}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.paidOutAmount",
                      defaultMessage: "Paid out amount",
                    })}
                    value={paidOutAmountDisplay}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.bondAmount",
                      defaultMessage: "Bond amount",
                    })}
                    value={bondAmountDisplay}
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.ledgerHash",
                      defaultMessage: "Staking ledger hash",
                    })}
                    value={truncateMiddle(
                      proposal.stakingEpochDataLedgerHash ?? "-",
                      10,
                      10,
                    )}
                    mono
                  />
                  <HeroStat
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.zkAppUriHash",
                      defaultMessage: "zkApp URI hash",
                    })}
                    value={truncateMiddle(proposal.zkAppUriHash ?? "-", 10, 10)}
                    mono
                    labelAdornment={
                      contentVerificationStatus ? (
                        <ContentVerificationIndicator
                          status={contentVerificationStatus}
                        />
                      ) : undefined
                    }
                  />
                </div>
              </div>
            </section>
            {contentBody ? (
              <div className="space-y-3">
                <div className="relative flex-1">
                  <div
                    ref={markdownContainerRef}
                    className={cn(
                      "min-h-[28rem] overflow-hidden sm:min-h-[34rem]",
                      !isContentExpanded && "max-h-[56rem]",
                    )}
                    data-component="proposal-markdown-box"
                  >
                    <article className="text-[15px] text-foreground sm:text-base">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={PROPOSAL_MARKDOWN_COMPONENTS}
                      >
                        {contentBody}
                      </ReactMarkdown>
                    </article>
                  </div>
                  {!isContentExpanded && contentIsOverflowing ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/90 to-transparent"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                {contentIsOverflowing ? (
                  <div
                    className={cn(
                      "flex justify-center",
                      !isContentExpanded &&
                        "-mt-16 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-2 pt-8",
                    )}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 rounded-full"
                      onClick={() => {
                        setIsContentExpanded((current) => !current);
                      }}
                    >
                      {isContentExpanded ? (
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                      {intl.formatMessage({
                        id: isContentExpanded
                          ? "ui.proposalDetail.collapseContent"
                          : "ui.proposalDetail.expandContent",
                        defaultMessage: isContentExpanded
                          ? "Collapse proposal content"
                          : "Expand proposal content",
                      })}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[28rem] flex-1 items-center justify-center sm:min-h-[34rem]">
                {canRetryContentSubmission ? (
                  <div
                    className="max-w-xl rounded-2xl border border-amber-300 bg-amber-50/90 p-5 text-left text-amber-950"
                    data-component="proposal-content-retry-alert"
                  >
                    <div className="flex gap-3">
                      <CircleAlert
                        className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">
                            {intl.formatMessage({
                              id: "ui.proposalDetail.contentRetryTitle",
                              defaultMessage: "Proposal content needs upload",
                            })}
                          </p>
                          <p className="text-sm leading-6 text-amber-900/90">
                            {intl.formatMessage({
                              id: "ui.proposalDetail.contentRetryDescription",
                              defaultMessage:
                                "This proposal exists on chain, but the markdown content was not attached to the indexed proposal yet. A local copy is available in this browser.",
                            })}
                          </p>
                        </div>
                        {contentRetryLastAttemptAt ? (
                          <p className="text-xs text-amber-900/80">
                            {intl.formatMessage(
                              {
                                id: "ui.proposalDetail.contentRetryLastAttempt",
                                defaultMessage: "Last retry: {timestamp}",
                              },
                              {
                                timestamp: formatTimestamp(
                                  contentRetryLastAttemptAt,
                                ),
                              },
                            )}
                          </p>
                        ) : null}
                        {contentRetryError ? (
                          <p className="rounded-lg border border-amber-300/70 bg-amber-100/70 px-3 py-2 text-xs leading-5 text-amber-950">
                            {contentRetryError}
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          className="gap-2"
                          onClick={onRetryContentSubmission}
                          disabled={
                            isRetryingContentSubmission ||
                            !onRetryContentSubmission
                          }
                        >
                          {isRetryingContentSubmission ? (
                            <LoaderCircle
                              className="h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                          ) : null}
                          {intl.formatMessage({
                            id: "ui.proposalDetail.contentRetryButton",
                            defaultMessage: "Retry content upload",
                          })}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({
                      id: "ui.proposalDetail.contentEmpty",
                      defaultMessage: "No proposal contents are available yet.",
                    })}
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="flex min-h-0 flex-col space-y-4">
            <section className="flex min-h-0 flex-col space-y-2">
              <DetailSectionIntro
                title={intl.formatMessage({
                  id: "ui.proposalDetail.votingPanelTitle",
                  defaultMessage: "Voting",
                })}
                description={intl.formatMessage({
                  id: "ui.proposalDetail.votingPanelDescription",
                  defaultMessage:
                    "Current tally, acceptance thresholds, and voting actions.",
                })}
              />
              <div className="relative">
                <div className="space-y-4 rounded-xl border border-border/70 bg-background px-5 py-5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {intl.formatMessage({
                      id: "ui.proposalDetail.currentVoteStatusLabel",
                      defaultMessage: "Current vote status",
                    })}
                  </p>
                  {showEmptyVoteSummary ? (
                    <EmptyVoteSummaryChart />
                  ) : (
                    <VoteSummaryChart
                      summary={votingSummary}
                      eligibleVotingWeight={resolveEligibleVotingWeight(
                        proposal,
                      )}
                    />
                  )}
                  <AcceptanceCriteriaCell
                    participationActual={resolveParticipationActual(proposal)}
                    participationRequirement={resolveParticipationRequirement(
                      proposal,
                    )}
                    approvalActual={resolveApprovalActual(proposal)}
                    approvalRequirement={resolveApprovalRequirement(proposal)}
                  />
                  {showVoteActions || isPreVotingPeriod ? (
                    <div className="border-t border-border/60 pt-4">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {intl.formatMessage({
                          id: "ui.proposalDetail.castVoteLabel",
                          defaultMessage: "Cast a vote",
                        })}
                      </p>
                      {isProposalPaused ||
                      showDisabledPreVotingOverlay ||
                      hasConnectedWallet ? (
                        <div
                          className="relative overflow-hidden rounded-xl"
                          data-component="proposal-vote-action-area"
                        >
                          <div
                            className={cn(
                              "space-y-2 rounded-xl",
                              showVoteActionOverlay &&
                                "pointer-events-none opacity-80 saturate-90",
                            )}
                          >
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                type="button"
                                size="sm"
                                className="h-11 w-full border border-emerald-600 bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                                onClick={onVoteYayClick}
                                disabled={showVoteActionOverlay}
                              >
                                Yay
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-11 w-full border border-rose-600 bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700"
                                onClick={onVoteNayClick}
                                disabled={showVoteActionOverlay}
                              >
                                Nay
                              </Button>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-9 w-full justify-center border border-border/70 bg-background px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={onVoteAbstainClick}
                              disabled={showVoteActionOverlay}
                            >
                              Abstain
                            </Button>
                          </div>
                          {showVoteActionOverlay ? (
                            <div
                              className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-border/40 bg-background/35 p-4 text-center backdrop-blur-md"
                              data-component={
                                isProposalPaused
                                  ? "proposal-paused-overlay"
                                  : showDisabledPreVotingOverlay
                                    ? "proposal-voting-pending-overlay"
                                    : "proposal-zero-voting-weight-overlay"
                              }
                            >
                              <div className="w-full max-w-sm space-y-0.5">
                                <div className="flex items-start justify-center gap-2">
                                  {isProposalPaused ? (
                                    <CircleAlert
                                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                                      aria-hidden="true"
                                    />
                                  ) : null}
                                  <p className="text-sm font-medium leading-5 text-foreground/90">
                                    {voteActionOverlayTitle}
                                  </p>
                                </div>
                                <p className="text-sm leading-5 text-muted-foreground">
                                  {voteActionOverlayMessage}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="h-10 w-full"
                          onClick={onConnectWalletClick}
                        >
                          {intl.formatMessage({
                            id: "ui.proposalDetail.connectWallet",
                            defaultMessage: "Connect a wallet to vote",
                          })}
                        </Button>
                      )}
                    </div>
                  ) : null}
                  <div className="space-y-3 pt-1 text-sm">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {intl.formatMessage({
                          id: "ui.proposalDetail.votingDetailsLabel",
                          defaultMessage: "Voting details",
                        })}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {visibleVotingDetailRows.map((row) => (
                        <DetailRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                        />
                      ))}
                    </div>
                    {hasHiddenVotingDetailRows && !isVotingDetailsExpanded ? (
                      <div className="-mt-6 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-2 pt-10">
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2 rounded-full"
                            onClick={() => {
                              setIsVotingDetailsExpanded(true);
                            }}
                          >
                            <ChevronDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            {intl.formatMessage({
                              id: "ui.proposalDetail.showVotingDetails",
                              defaultMessage: "Show details",
                            })}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {hasHiddenVotingDetailRows && isVotingDetailsExpanded ? (
                      <div className="flex justify-center pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2 rounded-full"
                          onClick={() => {
                            setIsVotingDetailsExpanded(false);
                          }}
                        >
                          <ChevronUp
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {intl.formatMessage({
                            id: "ui.proposalDetail.hideVotingDetails",
                            defaultMessage: "Hide details",
                          })}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
            <section className="space-y-2">
              <DetailSectionIntro
                title={intl.formatMessage({
                  id: "ui.proposalDetail.executePayoutTitle",
                  defaultMessage: "Execute / payout",
                })}
                description={intl.formatMessage({
                  id: "ui.proposalDetail.executePayoutDescription",
                  defaultMessage:
                    "Execution unlocks only after a proposal passes and the cooldown period has ended.",
                })}
              />
              <div className="space-y-4 rounded-xl border border-border/70 bg-background px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {intl.formatMessage({
                      id: "ui.proposalDetail.executePayoutStatus",
                      defaultMessage: "Payout status",
                    })}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-2.5 py-1 text-[11px]",
                      isProposalPaused
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : canExecutePayout
                          ? "border-emerald-600/40 bg-emerald-50 text-emerald-700"
                          : isFullyPaidOut
                            ? "border-slate-300 bg-slate-50 text-slate-700"
                            : "border-border/70 bg-muted/40 text-muted-foreground",
                    )}
                  >
                    {executePayoutStatusLabel}
                  </Badge>
                </div>
                <CardDescription className="text-sm leading-6 text-foreground/70">
                  {executePayoutMessage}
                </CardDescription>
                {needsOnChainTallyBeforeExecution ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-900">
                    <CircleAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-medium">
                          {intl.formatMessage({
                            id: "ui.proposalDetail.executionNeedsOnChainTallyWarning",
                            defaultMessage:
                              "Awaiting on-chain tally submission.",
                          })}
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-700 transition hover:bg-amber-100"
                              aria-label={intl.formatMessage({
                                id: "ui.proposalDetail.learnMoreOnChainTally",
                                defaultMessage:
                                  "Learn more about on-chain tally submission",
                              })}
                            >
                              <CircleHelp
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="max-w-80 text-left"
                          >
                            {intl.formatMessage({
                              id: "ui.proposalDetail.executionTallyCliTooltip",
                              defaultMessage:
                                "Execution stays locked until a final tally transaction is submitted on-chain. Use the treasury CLI to submit that tally, then refresh once the proposal reflects the on-chain result.",
                            })}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-amber-800/90">
                        {intl.formatMessage({
                          id: "ui.proposalDetail.executionNeedsOnChainTallyHint",
                          defaultMessage:
                            "Use the CLI to submit the final tally on-chain. Once the proposal reflects a tallied Passed result, execution can proceed after cooldown.",
                        })}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3 pt-1 text-sm">
                  <DetailRow
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.bondAmount",
                      defaultMessage: "Bond amount",
                    })}
                    value={bondAmountDisplay}
                  />
                  <DetailRow
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.paidOutAmount",
                      defaultMessage: "Paid out amount",
                    })}
                    value={paidOutAmountDisplay}
                  />
                  <DetailRow
                    label={intl.formatMessage({
                      id: "ui.proposalDetail.remainingPayout",
                      defaultMessage: "Remaining payout",
                    })}
                    value={remainingAmountDisplay}
                  />
                </div>
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`proposal-payout-amount-${proposal.id}`}
                      className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {intl.formatMessage({
                        id: "ui.proposalDetail.payoutAmountLabel",
                        defaultMessage: "Payout amount",
                      })}
                    </label>
                    <MinaAmountInput
                      id={`proposal-payout-amount-${proposal.id}`}
                      placeholder={intl.formatMessage({
                        id: "ui.proposalDetail.payoutAmountPlaceholder",
                        defaultMessage: "0",
                      })}
                      value={payoutAmountInput}
                      disabled={
                        isProposalPaused ||
                        !canExecutePayout ||
                        !hasConnectedProposerWallet
                      }
                      onChange={(event) => {
                        setPayoutAmountInput(event.target.value);
                      }}
                      aria-invalid={payoutAmountError ? "true" : "false"}
                    />
                  </div>
                  {requiresProposerWalletConnection ? (
                    <p className="text-sm text-muted-foreground">
                      {intl.formatMessage({
                        id: "ui.proposalDetail.connectProposerWalletMessage",
                        defaultMessage:
                          "Connect the proposer wallet before executing or paying out this proposal.",
                      })}
                    </p>
                  ) : payoutAmountError ? (
                    <p className="text-sm text-rose-600">{payoutAmountError}</p>
                  ) : canExecutePayout ? (
                    <p className="text-sm text-muted-foreground">
                      {intl.formatMessage(
                        {
                          id: "ui.proposalDetail.maxPayoutHint",
                          defaultMessage:
                            "You can execute up to {remainingAmount}.",
                        },
                        { remainingAmount: remainingAmountDisplay },
                      )}
                    </p>
                  ) : null}
                </div>
                {requiresProposerWalletConnection ? (
                  <Button
                    type="button"
                    className="h-10 w-full"
                    onClick={onConnectProposerWalletClick}
                  >
                    {intl.formatMessage({
                      id: "ui.proposalDetail.connectWalletToExecute",
                      defaultMessage: "Connect recipient wallet to execute",
                    })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="h-10 w-full"
                    variant={canExecutePayout ? "default" : "outline"}
                    disabled={!canSubmitPayout}
                    onClick={() => {
                      if (
                        !canSubmitPayout ||
                        parsedPayoutAmountValue === null
                      ) {
                        return;
                      }
                      onExecutePayoutClick?.(String(parsedPayoutAmountValue));
                    }}
                  >
                    {executePayoutButtonLabel}
                  </Button>
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="space-y-2">
          <DetailSectionIntro
            title={intl.formatMessage({
              id: "ui.proposalDetail.votesTitle",
              defaultMessage: "Votes",
            })}
            description={intl.formatMessage({
              id: "ui.proposalDetail.votesDescription",
              defaultMessage: "Per-voter dispatch records for this proposal.",
            })}
          />
          <PaginatedDetailTable
            rows={votes}
            initialPageSize={tableInitialPageSize}
            pagination={votesPagination}
            columns={[
              { key: "voter", label: "Voter", className: "w-[44%]" },
              { key: "vote", label: "Vote", className: "w-[16%]" },
              { key: "weight", label: "Weight", className: "w-[22%]" },
              { key: "block", label: "Block", className: "w-[18%]" },
            ]}
            emptyMessage={intl.formatMessage({
              id: "ui.proposalDetail.votesEmpty",
              defaultMessage:
                "No vote records are available for this proposal yet.",
            })}
            renderRow={(vote) => (
              <TableRow key={vote.id}>
                <TableCell className="w-[44%] break-all px-6 font-mono text-xs">
                  {vote.voterPublicKey}
                </TableCell>
                <TableCell className="w-[16%] px-6">
                  {formatVoteLabel(vote.vote)}
                </TableCell>
                <TableCell className="w-[22%] px-6 font-medium">
                  {formatWeight(vote.voteWeight)}
                </TableCell>
                <TableCell className="w-[18%] px-6">
                  {vote.blockHeight ? `#${vote.blockHeight}` : "-"}
                </TableCell>
              </TableRow>
            )}
          />
        </section>

        <section className="space-y-2">
          <DetailSectionIntro
            title={intl.formatMessage({
              id: "ui.proposalDetail.executionsTitle",
              defaultMessage: "Execution history",
            })}
            description={intl.formatMessage({
              id: "ui.proposalDetail.executionsDescription",
              defaultMessage:
                "Payout records associated with proposal execution.",
            })}
          />
          <PaginatedDetailTable
            rows={executions}
            initialPageSize={tableInitialPageSize}
            pagination={executionsPagination}
            columns={[
              { key: "executedBy", label: "Executed by", className: "w-[42%]" },
              { key: "paidOut", label: "Paid out", className: "w-[20%]" },
              { key: "remaining", label: "Remaining", className: "w-[20%]" },
              { key: "block", label: "Block", className: "w-[18%]" },
            ]}
            emptyMessage={intl.formatMessage({
              id: "ui.proposalDetail.executionsEmpty",
              defaultMessage:
                "No execution records are available for this proposal yet.",
            })}
            renderRow={(execution) => (
              <TableRow key={execution.id}>
                <TableCell className="w-[42%] break-all px-6 font-mono text-xs">
                  {execution.senderPublicKey ?? "-"}
                </TableCell>
                <TableCell className="w-[20%] px-6">
                  {formatMinaAmountWithSuffix(execution.paidOutAmount) ?? "-"}
                </TableCell>
                <TableCell className="w-[20%] px-6">
                  {formatMinaAmountWithSuffix(execution.remainingAmount) ?? "-"}
                </TableCell>
                <TableCell className="w-[18%] px-6">
                  {execution.blockHeight ? `#${execution.blockHeight}` : "-"}
                </TableCell>
              </TableRow>
            )}
          />
        </section>
      </div>
    </TooltipProvider>
  );
}

const DETAIL_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;

function PaginatedDetailTable<T extends { id: string }>({
  rows,
  columns,
  emptyMessage,
  renderRow,
  initialPageSize,
  pagination,
}: {
  rows: T[];
  columns: Array<{ key: string; label: string; className?: string }>;
  emptyMessage: string;
  renderRow: (row: T) => JSX.Element;
  initialPageSize: 10 | 20 | 30 | 40 | 50;
  pagination?: TreasuryDetailTablePagination;
}): JSX.Element {
  const intl = useTreasuryIntl();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const isServerControlled = pagination !== undefined;
  const resolvedPage = pagination?.page ?? page;
  const resolvedPageSize = pagination?.pageSize ?? pageSize;
  const totalCount = pagination?.totalCount ?? rows.length;
  const loading = pagination?.loading ?? false;

  useEffect(() => {
    if (!isServerControlled) {
      setPage(1);
    }
  }, [isServerControlled, rows.length]);

  const totalPages = Math.max(1, Math.ceil(totalCount / resolvedPageSize));
  const currentPage = Math.min(resolvedPage, totalPages);

  useEffect(() => {
    if (resolvedPage <= totalPages) {
      return;
    }
    if (pagination) {
      pagination.onPageChange(totalPages);
    } else {
      setPage(totalPages);
    }
  }, [pagination, resolvedPage, totalPages]);

  const paginatedRows = useMemo(() => {
    if (isServerControlled) {
      return rows;
    }
    const start = (currentPage - 1) * resolvedPageSize;
    return rows.slice(start, start + resolvedPageSize);
  }, [currentPage, isServerControlled, resolvedPageSize, rows]);

  const rangeStart =
    totalCount === 0 ? 0 : (currentPage - 1) * resolvedPageSize + 1;
  const rangeEnd =
    totalCount === 0
      ? 0
      : isServerControlled
        ? paginatedRows.length === 0
          ? 0
          : Math.min(rangeStart + paginatedRows.length - 1, totalCount)
        : Math.min(currentPage * resolvedPageSize, totalCount);

  const handlePageChange = (nextPage: number): void => {
    if (pagination) {
      pagination.onPageChange(nextPage);
    } else {
      setPage(nextPage);
    }
  };

  const handlePageSizeChange = (
    nextPageSize: (typeof DETAIL_TABLE_PAGE_SIZE_OPTIONS)[number],
  ): void => {
    if (pagination) {
      pagination.onPageSizeChange(nextPageSize);
    } else {
      setPage(1);
      setPageSize(nextPageSize);
    }
  };

  return (
    <Card className="rounded-xl shadow-none">
      <CardContent className="px-0 pb-0 pt-0.5">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn("px-6", column.className)}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground",
                      column.className?.includes("text-right")
                        ? "ml-auto flex"
                        : "",
                    )}
                  >
                    {column.label}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    {intl.formatMessage({
                      id: "ui.proposalDetail.tableLoading",
                      defaultMessage: "Loading records",
                    })}
                  </span>
                </TableCell>
              </TableRow>
            ) : paginatedRows.length > 0 ? (
              paginatedRows.map((row) => renderRow(row))
            ) : (
              <EmptyTableRow colSpan={columns.length} message={emptyMessage} />
            )}
          </TableBody>
        </Table>
        {totalCount > 0 ? (
          <div className="flex flex-col gap-3 border-t px-2 py-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <label className="flex items-center gap-2">
                <span>
                  {intl.formatMessage({
                    id: "ui.proposalsTable.pageSize",
                    defaultMessage: "Rows",
                  })}
                </span>
                <select
                  value={resolvedPageSize}
                  onChange={(event) =>
                    handlePageSizeChange(
                      Number(
                        event.target.value,
                      ) as (typeof DETAIL_TABLE_PAGE_SIZE_OPTIONS)[number],
                    )
                  }
                  className="h-8 rounded-md border border-input bg-background pl-2 pr-7 text-sm text-foreground"
                  disabled={loading}
                  aria-label={intl.formatMessage({
                    id: "ui.proposalsTable.pageSize.label",
                    defaultMessage: "Entries per page",
                  })}
                >
                  {DETAIL_TABLE_PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {intl.formatMessage(
                  {
                    id: "ui.proposalsTable.paginationSummary",
                    defaultMessage: "Page {page} of {totalPages}",
                  },
                  { page: currentPage, totalPages },
                )}
              </p>
              <p>
                {intl.formatMessage(
                  {
                    id: "ui.proposalsTable.showingRange",
                    defaultMessage: "Showing {start}-{end} of {count}",
                  },
                  {
                    start: rangeStart,
                    end: rangeEnd,
                    count: totalCount,
                  },
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={loading || currentPage === 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                {intl.formatMessage({
                  id: "ui.proposalsTable.previous",
                  defaultMessage: "Previous",
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handlePageChange(Math.min(totalPages, currentPage + 1))
                }
                disabled={loading || currentPage === totalPages}
              >
                {intl.formatMessage({
                  id: "ui.proposalsTable.next",
                  defaultMessage: "Next",
                })}
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailSectionIntro({
  title,
  description,
  titleAdornment,
}: {
  title: string;
  description: string;
  titleAdornment?: JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg font-semibold tracking-tight sm:text-[1.35rem]">
          {title}
        </CardTitle>
        {titleAdornment}
      </div>
      <CardDescription className="max-w-2xl text-[15px] leading-6 text-foreground/70">
        {description}
      </CardDescription>
    </div>
  );
}

function ContentVerificationIndicator({
  status,
}: {
  status: "loading" | "verified" | "mismatch" | "retryable";
}): JSX.Element {
  const description =
    "Checks whether the markdown served by the API hashes to the same value as the on-chain zkApp URI hash.";

  if (status === "verified") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-700">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Verified
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-center">
          {description}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status === "loading") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
            Verifying
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-center">
          {description}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status === "retryable") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Retry needed
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-center">
          Proposal content is missing from the API, but this browser has a local
          copy that can be uploaded again.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700">
          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          Mismatch
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-center">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

function HeroStat({
  label,
  value,
  mono = false,
  labelAdornment,
}: {
  label: string;
  value: string;
  mono?: boolean;
  labelAdornment?: JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {labelAdornment}
      </div>
      <p className={cn("text-sm text-foreground", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm", mono && "break-all font-mono")}>
        {value}
      </span>
    </div>
  );
}

function EmptyVoteSummaryChart(): JSX.Element {
  return (
    <div
      className="space-y-2 min-w-[11rem]"
      aria-hidden="true"
      data-component="proposal-empty-vote-summary"
    >
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="w-full bg-muted" />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full bg-emerald-600/40"
            aria-hidden="true"
          />
          Yay 0%
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full bg-rose-600/40"
            aria-hidden="true"
          />
          Nay 0%
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full bg-slate-400/70"
            aria-hidden="true"
          />
          Abstain 0%
        </span>
      </div>
    </div>
  );
}

function truncateMiddle(value: string, start = 12, end = 12): string {
  if (value.length <= start + end + 3) {
    return value;
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function EmptyTableRow({
  colSpan,
  message,
}: {
  colSpan: number;
  message: string;
}): JSX.Element {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {message}
      </TableCell>
    </TableRow>
  );
}

function formatVoteLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "-";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatWeight(value: string | undefined | null): string {
  if (!value) {
    return "-";
  }
  return formatMinaAmountWithSuffix(value) ?? "-";
}

function parseDisplayAmount(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = parseMinaAmount(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInputAmount(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDisplayAmount(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)} MINA`;
}

function formatInputAmount(value: number): string {
  return value.toString();
}

function formatTimestamp(
  value: string | undefined | null,
  blockHeight?: number,
): string {
  if (!value) {
    return blockHeight ? `#${blockHeight}` : "-";
  }
  const date = new Date(value);
  const formatted = Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
  return blockHeight ? `${formatted} (#${blockHeight})` : formatted;
}

function extractMarkdownTitleAndBody(contents: string | null | undefined): {
  title: string | null;
  body: string | null;
} {
  if (!contents) {
    return { title: null, body: null };
  }

  const match = contents.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  if (!match) {
    return { title: null, body: contents };
  }

  const title = match[1]?.trim() ?? null;
  const body = contents.slice(match[0].length).replace(/^\s+/, "");
  return {
    title: title && title.length > 0 ? title : null,
    body: body.length > 0 ? body : null,
  };
}
