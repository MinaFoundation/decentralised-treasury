import { type JSX, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SquarePen,
} from "lucide-react";
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
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";

export interface TreasuryProposalTableEntry {
  id: string;
  title: string;
  lifecycleId?: number;
  proposalAddress?: string;
  proposer: string;
  requestedAmount: string;
  stage: string;
  period: string;
  createdAt: string;
  createdAtBlock?: number;
  voteStatus?: string;
  voteSummary?: TreasuryProposalVoteSummary;
  stakingEpochDataLedgerTotalCurrency?: string | null;
  requiredParticipationBp?: string | null;
  requiredApprovalBp?: string | null;
  requiredParticipation?: string | null;
  contractStatus?: TreasuryProposalContractStatus | null;
  contractStatusFinality?: TreasuryProposalObservationStatus | null;
  contractStatusSourceEventId?: string | null;
  statusAsOfBlockHeight?: number | null;
  creationObservationStatus?: TreasuryProposalObservationStatus | null;
  runningVoteTally?: TreasuryProposalLatestVoteTally | null;
  finalVoteTally?: TreasuryProposalLatestVoteTally | null;
  latestVoteTally?: TreasuryProposalLatestVoteTally | null;
  isPaused?: boolean;
}

export type TreasuryProposalContractStatus =
  | "unknown"
  | "approved"
  | "rejected"
  | "paused";

export type TreasuryProposalObservationStatus = "pending" | "canonical";

export interface TreasuryProposalVoteSummary {
  yay: number;
  nay: number;
  abstain: number;
}

export interface TreasuryProposalLatestVoteTally {
  archiveEventId?: string;
  blockEventIndex?: number;
  sourceStatus?: TreasuryProposalObservationStatus;
  blockHeight: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  createdByEventType: "proposalVoteDispatched" | "proposalVotesTallied" | null;
  requiredParticipationBp?: string | null;
  requiredApprovalBp?: string | null;
  requiredParticipation?: string | null;
  totalParticipatingVotes?: string | null;
  approvalBp?: string | null;
  voteResult: "approved" | "rejected" | null;
}

export type TreasuryProposalPeriodId =
  | "proposal"
  | "exploration"
  | "voting"
  | "cooldown";
type ResolvedTreasuryProposalTableEntry = TreasuryProposalTableEntry & {
  stage: string;
  voteSummary?: TreasuryProposalVoteSummary;
};

type SortKey =
  | "id"
  | "title"
  | "lifecycleId"
  | "proposer"
  | "requestedAmount"
  | "stage"
  | "period"
  | "createdAt"
  | "voteStatus";
export type TreasuryProposalTableSortKey = SortKey;
export type TreasuryProposalTableSortDirection = "asc" | "desc";
type SortDirection = TreasuryProposalTableSortDirection;
export type TreasuryProposalTableColumnKey =
  | Exclude<SortKey, "id">
  | "voteSummary"
  | "acceptanceCriteria";
type SortableProposalTableColumnKey = Exclude<
  TreasuryProposalTableColumnKey,
  "voteSummary" | "acceptanceCriteria"
>;

interface ProposalColumn {
  key: TreasuryProposalTableColumnKey;
  label: string;
  className?: string;
  sortable?: boolean;
}

export interface TreasuryProposalsTableProps {
  entries: TreasuryProposalTableEntry[];
  title?: string;
  description?: string;
  largeTitle?: boolean;
  lifecycleId?: number;
  lifecycleOptions?: number[];
  onLifecycleChange?: (lifecycleId: number | undefined) => void;
  className?: string;
  initialPageSize?: 10 | 20 | 30 | 40 | 50;
  loading?: boolean;
  columns?: TreasuryProposalTableColumnKey[];
  onCreateProposalClick?: () => void;
  onProposalClick?: (entry: TreasuryProposalTableEntry) => void;
  emptyActionLabel?: string;
  statusDerivationPeriod?: TreasuryProposalPeriodId;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  sortKey?: TreasuryProposalTableSortKey;
  sortDirection?: TreasuryProposalTableSortDirection;
  onSortChange?: (
    key: TreasuryProposalTableSortKey,
    direction: TreasuryProposalTableSortDirection,
  ) => void;
  sortableColumns?: TreasuryProposalTableSortKey[];
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;
const TABLE_VIEWPORT_MIN_HEIGHT_CLASS = "min-h-[32rem]";
const DEFAULT_COLUMNS: TreasuryProposalTableColumnKey[] = [
  "title",
  "lifecycleId",
  "proposer",
  "requestedAmount",
  "stage",
  "createdAt",
];
const DEFAULT_PERIOD_COLUMNS: TreasuryProposalTableColumnKey[] = [
  "title",
  "proposer",
  "requestedAmount",
  "createdAt",
];
const VOTING_PERIOD_COLUMNS: TreasuryProposalTableColumnKey[] = [
  "title",
  "requestedAmount",
  "stage",
  "voteSummary",
  "acceptanceCriteria",
];
const COOLDOWN_PERIOD_COLUMNS: TreasuryProposalTableColumnKey[] = [
  "title",
  "proposer",
  "requestedAmount",
  "stage",
  "voteSummary",
  "acceptanceCriteria",
];

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function parseRequestedAmount(value: string): number {
  return parseMinaAmount(value);
}

function parseBasisPointsValue(value: string | undefined | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(
  value: string | number | Date | undefined | null,
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSortableColumnKey(
  key: TreasuryProposalTableColumnKey,
): key is SortableProposalTableColumnKey {
  return key !== "voteSummary" && key !== "acceptanceCriteria";
}

function resolveInitialSortKey(
  columns: TreasuryProposalTableColumnKey[],
): SortKey {
  if (columns.includes("createdAt")) {
    return "createdAt";
  }
  const firstSortable = columns.find(isSortableColumnKey);
  return firstSortable ?? "title";
}

export function resolveStageVariant(
  stage: string,
): "default" | "secondary" | "outline" | "destructive" {
  const normalized = stage.toLowerCase();
  if (normalized.includes("paused") || normalized.includes("vetoed")) {
    return "outline";
  }
  if (normalized.includes("passing") || normalized.includes("failing")) {
    return "outline";
  }
  if (normalized.includes("active")) {
    return "default";
  }
  if (normalized.includes("approved") || normalized.includes("passed")) {
    return "outline";
  }
  if (normalized.includes("rejected") || normalized.includes("failed")) {
    return "destructive";
  }
  if (normalized.includes("voting") || normalized.includes("exploration")) {
    return "secondary";
  }
  return "outline";
}

export function resolveStageBadgeClassName(stage: string): string | undefined {
  const normalized = stage.toLowerCase();
  if (normalized.includes("paused") || normalized.includes("vetoed")) {
    return "border-2 border-slate-900 bg-slate-950 text-slate-50 hover:bg-slate-950";
  }
  if (normalized.includes("abandoned")) {
    return "border-2 border-slate-400 bg-slate-100 text-slate-700 hover:bg-slate-100";
  }
  if (normalized.includes("approved") || normalized.includes("passed")) {
    return "border-2 border-emerald-600 bg-emerald-50 text-emerald-600 hover:bg-emerald-50";
  }
  if (normalized.includes("passing")) {
    return "border-2 border-dashed border-emerald-600 bg-emerald-50 text-emerald-600 hover:bg-emerald-50";
  }
  if (normalized.includes("rejected") || normalized.includes("failed")) {
    return "border-2 border-rose-600 bg-rose-50 text-rose-600 hover:bg-rose-50";
  }
  if (normalized.includes("failing")) {
    return "border-2 border-dashed border-rose-600 bg-rose-50 text-rose-600 hover:bg-rose-50";
  }
  return undefined;
}

export function resolveStageDescription(
  intl: ReturnType<typeof useTreasuryIntl>,
  stage: string,
): string {
  const normalized = stage.trim().toLowerCase();

  if (normalized === "new") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.new",
      defaultMessage:
        "This proposal belongs to the current lifecycle and is still in the proposal submission phase.",
    });
  }
  if (normalized === "exploration") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.exploration",
      defaultMessage:
        "This proposal is in exploration, where delegates and token holders review it before voting opens.",
    });
  }
  if (normalized === "waiting for votes") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.waitingForVotes",
      defaultMessage:
        "Voting has opened, but there are not enough decisive votes yet to determine whether the proposal is passing or failing.",
    });
  }
  if (normalized === "passing") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.passing",
      defaultMessage:
        "The proposal is currently meeting quorum and approval requirements, but voting is still in progress.",
    });
  }
  if (normalized === "failing") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.failing",
      defaultMessage:
        "The proposal is currently not meeting quorum or approval requirements, but voting is still in progress.",
    });
  }
  if (normalized === "passed") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.passed",
      defaultMessage:
        "Voting has closed and the proposal finished with a passing result.",
    });
  }
  if (normalized === "failed") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.failed",
      defaultMessage:
        "Voting has closed and the proposal did not satisfy the acceptance criteria.",
    });
  }
  if (normalized === "abandoned") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.abandoned",
      defaultMessage:
        "Voting closed without any votes being cast for this proposal.",
    });
  }
  if (normalized === "awaiting on-chain result") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.awaitingOnChainResult",
      defaultMessage:
        "The contract does not currently contain a final result for this proposal.",
    });
  }
  if (normalized === "paused" || normalized === "vetoed") {
    return intl.formatMessage({
      id: "ui.proposalsTable.statusDescription.paused",
      defaultMessage:
        "This proposal is paused. Voting and execution actions are disabled.",
    });
  }

  return intl.formatMessage(
    {
      id: "ui.proposalsTable.statusDescription.default",
      defaultMessage: "Current proposal status: {status}.",
    },
    { status: stage },
  );
}

export function parsePeriodValue(
  value: string | undefined,
): TreasuryProposalPeriodId | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "proposal" ||
    normalized === "exploration" ||
    normalized === "voting" ||
    normalized === "cooldown"
  ) {
    return normalized;
  }
  return null;
}

export function parseVoteWeight(value: string | undefined | null): number {
  return parseMinaAmount(value);
}

export function formatBasisPointsPercent(
  value: string | undefined | null,
): string | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const percent = parsed / 100;
  return Number.isInteger(percent)
    ? `${percent}%`
    : `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function formatMinaWeight(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} MINA`;
}

export function resolveVoteSummary(
  entry: TreasuryProposalTableEntry,
): TreasuryProposalVoteSummary | undefined {
  if (entry.voteSummary) {
    return entry.voteSummary;
  }
  const voteTally = resolveDisplayVoteTally(entry);
  if (!voteTally) {
    return undefined;
  }
  return {
    yay: parseVoteWeight(voteTally.yayWeight),
    nay: parseVoteWeight(voteTally.nayWeight),
    abstain: parseVoteWeight(voteTally.abstainWeight),
  };
}

export function resolveDisplayVoteTally(
  entry: TreasuryProposalTableEntry,
): TreasuryProposalLatestVoteTally | null {
  const period = parsePeriodValue(entry.period);
  if (period === "voting") {
    return (
      entry.runningVoteTally ??
      entry.finalVoteTally ??
      entry.latestVoteTally ??
      null
    );
  }
  return (
    entry.finalVoteTally ??
    entry.runningVoteTally ??
    entry.latestVoteTally ??
    null
  );
}

export function resolveEligibleVotingWeight(
  entry: TreasuryProposalTableEntry,
): number | undefined {
  const parsed = parseVoteWeight(entry.stakingEpochDataLedgerTotalCurrency);
  return parsed > 0 ? parsed : undefined;
}

export function resolveParticipationRequirement(
  entry: TreasuryProposalTableEntry,
): string | null {
  const voteTally = resolveDisplayVoteTally(entry);
  return (
    formatBasisPointsPercent(entry.requiredParticipationBp) ??
    formatBasisPointsPercent(voteTally?.requiredParticipationBp)
  );
}

export function resolveApprovalRequirement(
  entry: TreasuryProposalTableEntry,
): string | null {
  const voteTally = resolveDisplayVoteTally(entry);
  return (
    formatBasisPointsPercent(entry.requiredApprovalBp) ??
    formatBasisPointsPercent(voteTally?.requiredApprovalBp)
  );
}

export function resolveRequiredParticipationWeight(
  entry: TreasuryProposalTableEntry,
): number | null {
  const voteTally = resolveDisplayVoteTally(entry);
  const directRequirement = parseVoteWeight(
    entry.requiredParticipation ?? voteTally?.requiredParticipation,
  );
  if (directRequirement > 0) {
    return directRequirement;
  }

  const eligibleVotingWeight = resolveEligibleVotingWeight(entry);
  const requiredParticipationBp = parseBasisPointsValue(
    entry.requiredParticipationBp ?? voteTally?.requiredParticipationBp,
  );
  if (!eligibleVotingWeight || requiredParticipationBp <= 0) {
    return null;
  }

  return (eligibleVotingWeight * requiredParticipationBp) / 10_000;
}

export function resolveRequiredApprovalBpValue(
  entry: TreasuryProposalTableEntry,
): number | null {
  const voteTally = resolveDisplayVoteTally(entry);
  const requiredApprovalBp = parseBasisPointsValue(
    entry.requiredApprovalBp ?? voteTally?.requiredApprovalBp,
  );
  return requiredApprovalBp > 0 ? requiredApprovalBp : null;
}

function parseUnsignedInteger(value: string | undefined | null): bigint | null {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? BigInt(normalized) : null;
}

function resolveRequiredParticipationWeightExact(
  entry: TreasuryProposalTableEntry,
): bigint | null {
  const voteTally = resolveDisplayVoteTally(entry);
  const directRequirement = parseUnsignedInteger(
    entry.requiredParticipation ?? voteTally?.requiredParticipation,
  );
  if (directRequirement !== null) {
    return directRequirement;
  }

  const eligibleVotingWeight = parseUnsignedInteger(
    entry.stakingEpochDataLedgerTotalCurrency,
  );
  const requiredParticipationBp = parseUnsignedInteger(
    entry.requiredParticipationBp ?? voteTally?.requiredParticipationBp,
  );
  if (eligibleVotingWeight === null || requiredParticipationBp === null) {
    return null;
  }

  return (eligibleVotingWeight * requiredParticipationBp) / 10_000n;
}

function resolveRequiredApprovalBpExact(
  entry: TreasuryProposalTableEntry,
): bigint | null {
  const voteTally = resolveDisplayVoteTally(entry);
  return parseUnsignedInteger(
    entry.requiredApprovalBp ?? voteTally?.requiredApprovalBp,
  );
}

export function formatRatioPercent(
  numerator: number,
  denominator: number,
): string | null {
  if (denominator <= 0) {
    return null;
  }
  const percent = (numerator / denominator) * 100;
  return Number.isInteger(percent)
    ? `${percent}%`
    : `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatVoteBarPercent(numerator: number, denominator: number): string {
  if (denominator <= 0 || numerator <= 0) {
    return "0.000%";
  }
  const percent = (numerator / denominator) * 100;
  if (percent < 0.001) {
    return "< 0.001%";
  }
  return `${percent.toFixed(3)}%`;
}

export function resolveParticipationActual(
  entry: TreasuryProposalTableEntry,
): string | null {
  const eligibleVotingWeight = resolveEligibleVotingWeight(entry);
  const summary = resolveVoteSummary(entry);
  if (!eligibleVotingWeight || !summary) {
    return null;
  }
  const totalParticipatingVotes = summary.yay + summary.nay + summary.abstain;
  if (totalParticipatingVotes <= 0) {
    return null;
  }
  return formatRatioPercent(totalParticipatingVotes, eligibleVotingWeight);
}

export function resolveApprovalActual(
  entry: TreasuryProposalTableEntry,
): string | null {
  const summary = resolveVoteSummary(entry);
  if (!summary) {
    return null;
  }
  return formatRatioPercent(summary.yay, summary.yay + summary.nay);
}

export function resolveDerivedStage(
  entry: TreasuryProposalTableEntry,
  statusDerivationPeriod?: TreasuryProposalPeriodId,
): string {
  const normalizedStage = entry.stage.trim().toLowerCase();
  const contractStatus = normalizeContractStatus(entry.contractStatus);
  if (
    entry.isPaused === true ||
    (entry.isPaused === undefined &&
      (contractStatus === "paused" ||
        (contractStatus === null &&
          (normalizedStage.includes("paused") ||
            normalizedStage.includes("vetoed")))))
  ) {
    return "PAUSED";
  }
  const effectivePeriod =
    statusDerivationPeriod ?? parsePeriodValue(entry.period) ?? null;

  if (contractStatus === "approved") {
    return "Passed";
  }
  if (contractStatus === "rejected") {
    return "Failed";
  }

  if (effectivePeriod === "proposal") {
    return "New";
  }
  if (effectivePeriod === "exploration") {
    return "Exploration";
  }

  if (contractStatus === "unknown" && effectivePeriod === "cooldown") {
    return "Awaiting on-chain result";
  }

  const latestVoteTally =
    effectivePeriod === "voting"
      ? (entry.runningVoteTally ?? entry.latestVoteTally)
      : (entry.finalVoteTally ??
        entry.runningVoteTally ??
        entry.latestVoteTally);
  if (!latestVoteTally) {
    if (effectivePeriod === "voting") {
      return "Waiting for votes";
    }
    if (effectivePeriod === "cooldown") {
      return "Abandoned";
    }
    return entry.stage;
  }

  if (effectivePeriod !== "voting" && effectivePeriod !== "cooldown") {
    return entry.stage;
  }

  const yayWeight = parseUnsignedInteger(latestVoteTally.yayWeight) ?? 0n;
  const nayWeight = parseUnsignedInteger(latestVoteTally.nayWeight) ?? 0n;
  const abstainWeight =
    parseUnsignedInteger(latestVoteTally.abstainWeight) ?? 0n;
  const hasVotes = yayWeight > 0n || nayWeight > 0n || abstainWeight > 0n;
  const hasDecisiveVotes = yayWeight > 0n || nayWeight > 0n;
  const totalParticipatingWeight = yayWeight + nayWeight + abstainWeight;
  const requiredParticipationWeight =
    resolveRequiredParticipationWeightExact(entry);
  const requiredApprovalBp = resolveRequiredApprovalBpExact(entry);
  const approvalBp =
    yayWeight + nayWeight > 0n
      ? (yayWeight * 10_000n) / (yayWeight + nayWeight)
      : 0n;
  const participationMet =
    requiredParticipationWeight !== null &&
    totalParticipatingWeight >= requiredParticipationWeight;
  const approvalMet =
    requiredApprovalBp !== null && approvalBp >= requiredApprovalBp;

  if (!hasVotes) {
    if (effectivePeriod === "cooldown") {
      return "Abandoned";
    }
    return "Waiting for votes";
  }

  if (latestVoteTally.createdByEventType === "proposalVotesTallied") {
    if (!hasDecisiveVotes || !participationMet || !approvalMet) {
      return "Failed";
    }
    return latestVoteTally.voteResult === "approved" ? "Passed" : "Failed";
  }

  if (latestVoteTally.createdByEventType === "proposalVoteDispatched") {
    if (effectivePeriod === "cooldown") {
      if (!hasDecisiveVotes || !participationMet) {
        return "Failing";
      }
      return approvalMet && yayWeight > nayWeight ? "Passing" : "Failing";
    }

    if (!hasDecisiveVotes || !participationMet) {
      return "Waiting for votes";
    }
    return approvalMet && yayWeight > nayWeight ? "Passing" : "Failing";
  }

  return entry.stage;
}

function normalizeContractStatus(
  value: TreasuryProposalContractStatus | string | undefined | null,
): TreasuryProposalContractStatus | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "paused"
  ) {
    return normalized;
  }
  return null;
}

export function TreasuryProposalsTable({
  entries,
  title,
  description,
  largeTitle = false,
  lifecycleId,
  lifecycleOptions,
  onLifecycleChange,
  className,
  initialPageSize = 10,
  loading = false,
  columns,
  onCreateProposalClick,
  onProposalClick,
  emptyActionLabel,
  statusDerivationPeriod,
  page: controlledPage,
  pageSize: controlledPageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
  sortableColumns,
}: TreasuryProposalsTableProps): JSX.Element {
  const intl = useTreasuryIntl();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const visibleColumnKeys = useMemo<TreasuryProposalTableColumnKey[]>(
    () => (columns && columns.length > 0 ? columns : DEFAULT_COLUMNS),
    [columns],
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    resolveInitialSortKey(visibleColumnKeys),
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const resolvedPage = controlledPage ?? page;
  const resolvedPageSize = controlledPageSize ?? pageSize;
  const resolvedSortKey = controlledSortKey ?? sortKey;
  const resolvedSortDirection = controlledSortDirection ?? sortDirection;
  const isServerControlledPagination =
    controlledPage !== undefined &&
    controlledPageSize !== undefined &&
    typeof onPageChange === "function" &&
    typeof onPageSizeChange === "function" &&
    typeof totalCount === "number";
  const isServerControlledSorting =
    controlledSortKey !== undefined &&
    controlledSortDirection !== undefined &&
    typeof onSortChange === "function";
  const isColumnSortable = (
    key: TreasuryProposalTableColumnKey,
  ): key is SortableProposalTableColumnKey =>
    isSortableColumnKey(key) &&
    (sortableColumns === undefined ||
      sortableColumns.includes(key as TreasuryProposalTableSortKey));

  const allColumns: ProposalColumn[] = [
    {
      key: "title",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.title",
        defaultMessage: "Title",
      }),
    },
    {
      key: "lifecycleId",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.lifecycleId",
        defaultMessage: "Lifecycle ID",
      }),
      className: "w-[7rem] min-w-[7rem] whitespace-nowrap",
    },
    {
      key: "proposer",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.proposer",
        defaultMessage: "Proposer",
      }),
    },
    {
      key: "requestedAmount",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.requestedAmount",
        defaultMessage: "Requested",
      }),
      className: "w-[9rem] min-w-[9rem] whitespace-nowrap pr-5 text-right",
    },
    {
      key: "stage",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.stage",
        defaultMessage: "Status",
      }),
      className: "w-[9rem] min-w-[9rem]",
    },
    {
      key: "period",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.period",
        defaultMessage: "Period",
      }),
    },
    {
      key: "voteStatus",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.voteStatus",
        defaultMessage: "Vote",
      }),
    },
    {
      key: "voteSummary",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.voteSummary",
        defaultMessage: "Votes",
      }),
      sortable: false,
    },
    {
      key: "acceptanceCriteria",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.acceptanceCriteria",
        defaultMessage: "Criteria",
      }),
      className: "w-[13rem] min-w-[13rem]",
      sortable: false,
    },
    {
      key: "createdAt",
      label: intl.formatMessage({
        id: "ui.proposalsTable.column.createdAt",
        defaultMessage: "Created at",
      }),
      className: "w-[11rem] min-w-[11rem] pl-5",
    },
  ];
  const visibleColumns = allColumns.filter((column) =>
    visibleColumnKeys.includes(column.key),
  );

  const resolvedEntries = useMemo<ResolvedTreasuryProposalTableEntry[]>(
    () =>
      entries.map((entry) => ({
        ...entry,
        stage: resolveDerivedStage(entry, statusDerivationPeriod),
        voteSummary: resolveVoteSummary(entry),
      })),
    [entries, statusDerivationPeriod],
  );

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return resolvedEntries;
    }

    return resolvedEntries.filter((entry) =>
      [
        entry.id,
        entry.lifecycleId,
        entry.proposalAddress,
        entry.title,
        entry.proposer,
        entry.requestedAmount,
        entry.stage,
        entry.period,
        entry.createdAt,
        entry.createdAtBlock,
        entry.voteStatus,
        entry.latestVoteTally?.createdByEventType,
        entry.latestVoteTally?.voteResult,
        entry.voteSummary
          ? `${entry.voteSummary.yay} ${entry.voteSummary.nay} ${entry.voteSummary.abstain}`
          : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query, resolvedEntries]);

  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries].sort((left, right) => {
      if (resolvedSortKey === "requestedAmount") {
        return (
          parseRequestedAmount(left.requestedAmount) -
          parseRequestedAmount(right.requestedAmount)
        );
      }
      return compareStrings(
        `${left[resolvedSortKey]}`,
        `${right[resolvedSortKey]}`,
      );
    });

    return resolvedSortDirection === "desc" ? sorted.reverse() : sorted;
  }, [filteredEntries, resolvedSortDirection, resolvedSortKey]);

  const filteredCount = isServerControlledPagination
    ? (totalCount ?? 0)
    : sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / resolvedPageSize));
  const currentPage = Math.min(resolvedPage, totalPages);
  const paginatedEntries = isServerControlledPagination
    ? sortedEntries
    : sortedEntries.slice(
        (currentPage - 1) * resolvedPageSize,
        currentPage * resolvedPageSize,
      );
  const rangeStart =
    filteredCount === 0 ? 0 : (currentPage - 1) * resolvedPageSize + 1;
  const rangeEnd = isServerControlledPagination
    ? paginatedEntries.length === 0
      ? 0
      : Math.min(rangeStart + paginatedEntries.length - 1, filteredCount)
    : Math.min(currentPage * resolvedPageSize, filteredCount);

  useEffect(() => {
    if (!isServerControlledPagination) {
      setPage(1);
      return;
    }
    onPageChange(1);
  }, [isServerControlledPagination, onPageChange, resolvedPageSize, query]);

  useEffect(() => {
    if (!isServerControlledPagination) {
      if (page > totalPages) {
        setPage(totalPages);
      }
      return;
    }
    if (controlledPage !== undefined && controlledPage > totalPages) {
      onPageChange(totalPages);
    }
  }, [
    controlledPage,
    isServerControlledPagination,
    onPageChange,
    page,
    totalPages,
  ]);

  useEffect(() => {
    if (
      !visibleColumnKeys.includes(
        resolvedSortKey as TreasuryProposalTableColumnKey,
      )
    ) {
      setSortKey(resolveInitialSortKey(visibleColumnKeys));
      setSortDirection("desc");
    }
  }, [resolvedSortKey, visibleColumnKeys]);

  const handleSort = (key: SortKey): void => {
    const nextDirection =
      resolvedSortKey === key
        ? resolvedSortDirection === "asc"
          ? "desc"
          : "asc"
        : "asc";

    if (isServerControlledSorting) {
      onSortChange(key, nextDirection);
      if (isServerControlledPagination) {
        onPageChange(1);
      }
      return;
    }
    setSortKey(key);
    setSortDirection(nextDirection);
  };

  const renderSortIcon = (key: SortKey): JSX.Element => {
    if (resolvedSortKey !== key) {
      return <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />;
    }
    if (resolvedSortDirection === "asc") {
      return <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />;
    }
    return <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />;
  };

  const resolvedEmptyActionLabel =
    emptyActionLabel ??
    intl.formatMessage({
      id: "ui.proposalsTable.emptyAction",
      defaultMessage: "Create proposal",
    });
  const resolvedEmptyMessage = query.trim()
    ? intl.formatMessage({
        id: "ui.proposalsTable.emptyFiltered",
        defaultMessage: "No proposals match the current filter.",
      })
    : intl.formatMessage({
        id: "ui.proposalsTable.emptyUnfiltered",
        defaultMessage: "No proposals available yet.",
      });

  const resolvedTitle =
    title ??
    intl.formatMessage({
      id: "ui.proposalsTable.title",
      defaultMessage: "Proposals",
    });

  const resolvedDescription =
    description ??
    intl.formatMessage({
      id: "ui.proposalsTable.description",
      defaultMessage:
        "Browse proposals with sorting, filtering, and pagination controls.",
    });

  const tableControls = (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={intl.formatMessage({
            id: "ui.proposalsTable.search.placeholder",
            defaultMessage: "Filter proposals",
          })}
          className="pl-9"
          disabled={loading}
          aria-label={intl.formatMessage({
            id: "ui.proposalsTable.search.label",
            defaultMessage: "Filter proposals",
          })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {intl.formatMessage({
            id: "ui.proposalsTable.pageSize",
            defaultMessage: "Rows",
          })}
        </span>
        <select
          value={resolvedPageSize}
          onChange={(event) => {
            const nextPageSize = Number(event.target.value);
            if (isServerControlledPagination) {
              onPageSizeChange(nextPageSize);
              onPageChange(1);
              return;
            }
            setPageSize(nextPageSize);
          }}
          className="h-10 rounded-md border border-input bg-background pl-3 pr-10 text-sm text-foreground"
          disabled={loading}
          aria-label={intl.formatMessage({
            id: "ui.proposalsTable.pageSize.label",
            defaultMessage: "Entries per page",
          })}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const tableHeading = (
    <div className={largeTitle ? "space-y-2 pt-6" : "space-y-1.5"}>
      {largeTitle &&
      lifecycleOptions &&
      lifecycleOptions.length > 0 &&
      onLifecycleChange ? (
        <label className="relative inline-flex items-center">
          <span className="sr-only">
            {intl.formatMessage({
              id: "ui.lifecycle.selectorLabel",
              defaultMessage: "Select lifecycle",
            })}
          </span>
          <select
            className="min-w-[9.75rem] appearance-none bg-transparent py-1 pr-5 text-[11px] font-medium uppercase tracking-[0.12em] text-foreground outline-none"
            value={lifecycleId === undefined ? "" : String(lifecycleId)}
            onChange={(event) => {
              onLifecycleChange(
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
              );
            }}
            aria-label={intl.formatMessage({
              id: "ui.lifecycle.selectorLabel",
              defaultMessage: "Select lifecycle",
            })}
          >
            <option value="">
              {intl.formatMessage({
                id: "ui.lifecycle.selectorAll",
                defaultMessage: "All lifecycles",
              })}
            </option>
            {lifecycleOptions.map((option) => (
              <option key={option} value={option}>
                {intl.formatMessage(
                  {
                    id: "ui.lifecycle.lifecycleId",
                    defaultMessage: "Lifecycle {id}",
                  },
                  { id: option },
                )}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-1 h-3.5 w-3.5 text-muted-foreground"
            strokeWidth={2.25}
            aria-hidden="true"
          />
        </label>
      ) : null}
      {largeTitle ? (
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {resolvedTitle}
        </h2>
      ) : (
        <CardTitle className="text-lg font-semibold tracking-tight sm:text-[1.35rem]">
          {resolvedTitle}
        </CardTitle>
      )}
      <CardDescription
        className={
          largeTitle
            ? "max-w-3xl text-base leading-relaxed text-muted-foreground"
            : "max-w-2xl text-[15px] leading-6 text-foreground/70"
        }
      >
        {resolvedDescription}
      </CardDescription>
    </div>
  );

  return (
    <TooltipProvider>
      <div className={cn(className)}>
        {largeTitle ? (
          <>
            {tableHeading}
            <div className="mt-8 flex justify-end">{tableControls}</div>
          </>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            {tableHeading}
            {tableControls}
          </div>
        )}

        <Card
          className={cn("rounded-xl shadow-none", largeTitle ? "mt-3" : "mt-5")}
        >
          <CardContent className="px-0 pb-0 pt-0.5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {visibleColumns.map((column) => (
                    <TableHead key={column.key} className={column.className}>
                      {column.sortable === false ||
                      !isColumnSortable(column.key) ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground",
                            column.className === "text-right"
                              ? "ml-auto flex"
                              : "",
                          )}
                        >
                          {column.label}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleSort(
                              column.key as SortableProposalTableColumnKey,
                            )
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground",
                            column.className === "text-right"
                              ? "ml-auto flex"
                              : "",
                          )}
                        >
                          {column.label}
                          {renderSortIcon(
                            column.key as SortableProposalTableColumnKey,
                          )}
                        </button>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: resolvedPageSize }).map((_, index) => (
                    <TableRow
                      key={`loading-${index}`}
                      className="hover:bg-transparent"
                    >
                      {visibleColumns.map((column, index) => (
                        <TableCell
                          key={`${column.key}-${index}`}
                          className={cn(
                            column.key === "title" && "min-w-[16rem]",
                            column.className,
                          )}
                        >
                          {column.key === "title" ? (
                            <div className="space-y-2 py-1">
                              <Skeleton className="h-4 w-[min(100%,16rem)]" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          ) : column.key === "stage" ||
                            column.key === "voteStatus" ? (
                            <Skeleton className="h-6 w-20 rounded-full" />
                          ) : column.key === "voteSummary" ? (
                            <div className="space-y-2">
                              <Skeleton className="h-2.5 w-full rounded-full" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                          ) : column.key === "acceptanceCriteria" ? (
                            <div className="space-y-2 py-1">
                              <Skeleton className="h-4 w-28" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                          ) : column.key === "createdAt" ? (
                            <div className="space-y-2 py-1">
                              <Skeleton className="h-4 w-36" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                          ) : (
                            <Skeleton
                              className={cn(
                                "h-4 w-24",
                                column.className === "text-right" && "ml-auto",
                              )}
                            />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : paginatedEntries.length > 0 ? (
                  paginatedEntries.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className={cn(
                        onProposalClick &&
                          "cursor-pointer focus-within:bg-muted/50 hover:bg-muted/50",
                      )}
                      onClick={
                        onProposalClick
                          ? () => onProposalClick(entry)
                          : undefined
                      }
                      onKeyDown={
                        onProposalClick
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onProposalClick(entry);
                              }
                            }
                          : undefined
                      }
                      tabIndex={onProposalClick ? 0 : undefined}
                    >
                      {visibleColumns.map((column) => (
                        <TableCell
                          key={`${entry.id}-${column.key}`}
                          className={cn(
                            column.key === "title" && "min-w-[16rem]",
                            column.key === "requestedAmount" && "font-medium",
                            column.className,
                          )}
                        >
                          {column.key === "title" ? (
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                {entry.title}
                              </p>
                              <p className="break-all font-mono text-xs text-muted-foreground">
                                {entry.proposalAddress ?? entry.id}
                              </p>
                            </div>
                          ) : column.key === "stage" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant={resolveStageVariant(entry.stage)}
                                  className={cn(
                                    "flex w-full justify-center py-1 text-center",
                                    resolveStageBadgeClassName(entry.stage),
                                  )}
                                >
                                  {entry.stage}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-64 text-center"
                              >
                                {resolveStageDescription(intl, entry.stage)}
                              </TooltipContent>
                            </Tooltip>
                          ) : column.key === "voteStatus" ? (
                            <VoteStatusBadge status={entry.voteStatus} />
                          ) : column.key === "voteSummary" ? (
                            <VoteSummaryChart
                              summary={entry.voteSummary}
                              eligibleVotingWeight={resolveEligibleVotingWeight(
                                entry,
                              )}
                            />
                          ) : column.key === "acceptanceCriteria" ? (
                            <AcceptanceCriteriaCell
                              participationActual={resolveParticipationActual(
                                entry,
                              )}
                              participationRequirement={resolveParticipationRequirement(
                                entry,
                              )}
                              approvalActual={resolveApprovalActual(entry)}
                              approvalRequirement={resolveApprovalRequirement(
                                entry,
                              )}
                            />
                          ) : column.key === "lifecycleId" ? (
                            <span className="font-mono text-sm text-foreground">
                              {entry.lifecycleId ?? "-"}
                            </span>
                          ) : column.key === "createdAt" ? (
                            <CreatedAtCell
                              intl={intl}
                              timestamp={entry.createdAt}
                              blockHeight={entry.createdAtBlock}
                            />
                          ) : column.key === "requestedAmount" ? (
                            (formatMinaAmountWithSuffix(
                              entry.requestedAmount,
                            ) ?? "-")
                          ) : (
                            entry[column.key]
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={visibleColumns.length} className="py-0">
                      <div
                        className={cn(
                          TABLE_VIEWPORT_MIN_HEIGHT_CLASS,
                          "flex flex-col items-center justify-center gap-3 px-6 py-8 text-center",
                        )}
                      >
                        <p className="text-sm text-muted-foreground">
                          {resolvedEmptyMessage}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={onCreateProposalClick}
                        >
                          <SquarePen
                            className="mr-1.5 h-4 w-4"
                            aria-hidden="true"
                          />
                          {resolvedEmptyActionLabel}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {(loading || paginatedEntries.length > 0) && (
              <div className="flex flex-col gap-3 border-t px-2 py-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  {loading ? (
                    <>
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-32" />
                    </>
                  ) : (
                    <>
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
                            count: filteredCount,
                          },
                        )}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextPage = Math.max(1, currentPage - 1);
                      if (isServerControlledPagination) {
                        onPageChange(nextPage);
                        return;
                      }
                      setPage(nextPage);
                    }}
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
                    onClick={() => {
                      const nextPage = Math.min(totalPages, currentPage + 1);
                      if (isServerControlledPagination) {
                        onPageChange(nextPage);
                        return;
                      }
                      setPage(nextPage);
                    }}
                    disabled={
                      loading ||
                      currentPage === totalPages ||
                      filteredCount === 0
                    }
                  >
                    {intl.formatMessage({
                      id: "ui.proposalsTable.next",
                      defaultMessage: "Next",
                    })}
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function CreatedAtCell({
  intl,
  timestamp,
  blockHeight,
}: {
  intl: ReturnType<typeof useTreasuryIntl>;
  timestamp: string;
  blockHeight?: number;
}): JSX.Element {
  const parsedTimestamp = parseDateValue(timestamp);
  const localizedTimestamp = parsedTimestamp
    ? intl.formatDate(parsedTimestamp, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : timestamp;

  return (
    <div className="space-y-1">
      <p className="whitespace-nowrap text-sm text-foreground">
        {localizedTimestamp}
      </p>
      <p className="font-mono text-xs text-muted-foreground">
        {blockHeight ? `#${blockHeight}` : "-"}
      </p>
    </div>
  );
}

function VoteStatusBadge({ status }: { status?: string }): JSX.Element {
  if (!status) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  const normalized = status.toLowerCase();
  const className = normalized.includes("yay")
    ? "border-emerald-600 bg-emerald-50 text-emerald-600"
    : normalized.includes("nay")
      ? "border-rose-600 bg-rose-50 text-rose-600"
      : normalized.includes("abstain")
        ? "border-slate-200 bg-slate-100 text-slate-700"
        : "border-border bg-background text-foreground/80";

  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  );
}

export function VoteSummaryChart({
  summary,
  eligibleVotingWeight,
}: {
  summary?: TreasuryProposalVoteSummary;
  eligibleVotingWeight?: number;
}): JSX.Element {
  const normalizedSummary: TreasuryProposalVoteSummary = summary ?? {
    yay: 0,
    nay: 0,
    abstain: 0,
  };
  const total =
    normalizedSummary.yay + normalizedSummary.nay + normalizedSummary.abstain;

  const normalizedEligibleVotingWeight =
    eligibleVotingWeight && eligibleVotingWeight > 0
      ? eligibleVotingWeight
      : total;
  const yayWidth = total > 0 ? (normalizedSummary.yay / total) * 100 : 0;
  const nayWidth = total > 0 ? (normalizedSummary.nay / total) * 100 : 0;
  const abstainWidth =
    total > 0 ? (normalizedSummary.abstain / total) * 100 : 0;
  const formatPercent = (value: number): string =>
    formatVoteBarPercent(value, total);
  const formatEligiblePercent = (value: number): string =>
    formatVoteBarPercent(value, normalizedEligibleVotingWeight);

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="space-y-2 min-w-[11rem]">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-emerald-600"
                style={{ width: `${yayWidth}%` }}
              />
              <div className="bg-rose-600" style={{ width: `${nayWidth}%` }} />
              <div
                className="bg-slate-400"
                style={{ width: `${abstainWidth}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full bg-emerald-600"
                  aria-hidden="true"
                />
                Yay {formatPercent(normalizedSummary.yay)}
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full bg-rose-600"
                  aria-hidden="true"
                />
                Nay {formatPercent(normalizedSummary.nay)}
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full bg-slate-400"
                  aria-hidden="true"
                />
                Abstain {formatPercent(normalizedSummary.abstain)}
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm space-y-2">
          <div className="space-y-1">
            <p className="font-medium text-foreground">Out of votes cast</p>
            <p>
              Yay {formatPercent(normalizedSummary.yay)} · Nay{" "}
              {formatPercent(normalizedSummary.nay)} · Abstain{" "}
              {formatPercent(normalizedSummary.abstain)}
            </p>
            <div className="space-y-1 text-muted-foreground">
              <p>Yay {formatMinaWeight(normalizedSummary.yay)}</p>
              <p>Nay {formatMinaWeight(normalizedSummary.nay)}</p>
              <p>Abstain {formatMinaWeight(normalizedSummary.abstain)}</p>
            </div>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              Out of eligible voting weight
            </p>
            <p>
              Yay {formatEligiblePercent(normalizedSummary.yay)} · Nay{" "}
              {formatEligiblePercent(normalizedSummary.nay)} · Abstain{" "}
              {formatEligiblePercent(normalizedSummary.abstain)}
            </p>
            <p className="text-muted-foreground">
              Total eligible: {formatMinaWeight(normalizedEligibleVotingWeight)}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AcceptanceCriteriaCell({
  participationActual,
  participationRequirement,
  approvalActual,
  approvalRequirement,
}: {
  participationActual?: string | null;
  participationRequirement?: string | null;
  approvalActual?: string | null;
  approvalRequirement?: string | null;
}): JSX.Element {
  return (
    <div className="space-y-2 text-xs leading-4">
      <CriteriaMeter
        label="Participation"
        actual={participationActual}
        requirement={participationRequirement}
      />
      <CriteriaMeter
        label="Approval"
        actual={approvalActual}
        requirement={approvalRequirement}
      />
    </div>
  );
}

function CriteriaMeter({
  label,
  actual,
  requirement,
}: {
  label: string;
  actual?: string | null;
  requirement?: string | null;
}): JSX.Element {
  const actualPercent = actual ? Number(actual.replace("%", "").trim()) : null;
  const requirementPercent = requirement
    ? Number(requirement.replace("%", "").trim())
    : null;
  const isMet =
    actualPercent !== null &&
    Number.isFinite(actualPercent) &&
    requirementPercent !== null &&
    Number.isFinite(requirementPercent)
      ? actualPercent >= requirementPercent
      : null;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">
          <span
            className={cn(
              isMet === true && "text-emerald-600",
              isMet === false && "text-rose-600",
            )}
          >
            {actual ?? "-"}
          </span>{" "}
          / {requirement ?? "-"}
        </span>
      </div>
    </div>
  );
}

export function TreasuryProposalPeriodTable(
  props: Omit<TreasuryProposalsTableProps, "columns">,
): JSX.Element {
  return (
    <TreasuryProposalsTable
      {...props}
      columns={DEFAULT_PERIOD_COLUMNS}
      statusDerivationPeriod="proposal"
    />
  );
}

export function TreasuryExplorationPeriodTable(
  props: Omit<TreasuryProposalsTableProps, "columns">,
): JSX.Element {
  return (
    <TreasuryProposalsTable
      {...props}
      columns={DEFAULT_PERIOD_COLUMNS}
      statusDerivationPeriod="exploration"
    />
  );
}

export function TreasuryVotingPeriodTable(
  props: Omit<TreasuryProposalsTableProps, "columns">,
): JSX.Element {
  return (
    <TreasuryProposalsTable
      {...props}
      columns={VOTING_PERIOD_COLUMNS}
      statusDerivationPeriod="voting"
    />
  );
}

export function TreasuryCooldownPeriodTable(
  props: Omit<TreasuryProposalsTableProps, "columns">,
): JSX.Element {
  return (
    <TreasuryProposalsTable
      {...props}
      columns={COOLDOWN_PERIOD_COLUMNS}
      statusDerivationPeriod="cooldown"
    />
  );
}
