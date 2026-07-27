import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

import type {
  TreasuryProposalTableEntry,
  TreasuryProposalTableSortDirection,
  TreasuryProposalTableSortKey,
} from "@repo/ui/treasury-proposals-table";
import type {
  TreasuryProposalDetailProposal,
  TreasuryProposalExecutionRow,
  TreasuryProposalVoteRow,
} from "@repo/ui/treasury-proposal-detail";
import {
  fetchStakingLedgerTotalCurrency,
  formatNanominaBalance,
} from "./mina-accounts";

export interface ProposalApiItem {
  id: string;
  title?: string;
  lifecycleId?: number;
  proposalPublicKey?: string;
  senderPublicKey?: string;
  proposer?: string;
  amount?: string;
  requestedAmount?: string;
  recipient?: string | null;
  status?: string;
  stage?: string;
  period?: string;
  createdAt?: string;
  createdAtBlockHeight?: number;
  createdAtBlockTimestamp?: string | null;
  stakingEpochDataLedgerTotalCurrency?: string | null;
  stakingEpochDataLedgerHash?: string | null;
  zkAppUriHash?: string | null;
  requiredParticipationBp?: string | null;
  requiredApprovalBp?: string | null;
  requiredParticipation?: string | null;
  paidOutAmount?: string | null;
  contents?: string | null;
  updatedAt?: string | null;
  latestVoteTally?: TreasuryProposalTableEntry["latestVoteTally"];
  isPaused?: boolean;
}

interface ProposalListResponse {
  items?: ProposalApiItem[];
  nextOffset?: number | null;
  lifecycleId?: number;
  limit?: number;
  offset?: number;
  total?: number;
}

interface ProposalVotesResponse {
  total?: number;
  nextOffset?: number | null;
  limit?: number;
  offset?: number;
  items?: Array<{
    id: string;
    proposalPublicKey?: string;
    voterPublicKey?: string;
    vote?: string;
    voteWeight?: string;
    blockHeight?: number | null;
    isNullified?: boolean;
    status?: string | null;
    createdAt?: string | null;
  }>;
}

interface ProposalExecutionsResponse {
  total?: number;
  nextOffset?: number | null;
  limit?: number;
  offset?: number;
  items?: Array<{
    id: string;
    proposalPublicKey?: string;
    recipient?: string;
    amountToPayOut?: string;
    bondAmount?: string | null;
    senderPublicKey?: string | null;
    paidOutAmount?: string;
    remainingAmount?: string;
    blockHeight?: number | null;
    status?: string | null;
    createdAt?: string | null;
  }>;
}

export interface FetchProposalItemsOptions {
  lifecycleId?: number;
  limit?: number;
  offset?: number;
  sortKey?: TreasuryProposalTableSortKey;
  sortDirection?: TreasuryProposalTableSortDirection;
}

export interface ProposalItemsPage {
  items: ProposalApiItem[];
  total: number;
  nextOffset: number | null;
  limit: number;
  offset: number;
}

export interface FetchProposalDetailRowsOptions {
  limit?: number;
  offset?: number;
}

export interface ProposalVotesPage {
  items: TreasuryProposalVoteRow[];
  total: number;
  nextOffset: number | null;
  limit: number;
  offset: number;
}

export interface ProposalExecutionsPage {
  items: TreasuryProposalExecutionRow[];
  total: number;
  nextOffset: number | null;
  limit: number;
  offset: number;
}

const PROPOSAL_LIST_SORT_KEY_MAP: Partial<
  Record<TreasuryProposalTableSortKey, string>
> = {
  lifecycleId: "lifecycleId",
  proposer: "senderPublicKey",
  requestedAmount: "amount",
  createdAt: "createdAt",
};

function appendProposalListSort(
  url: URL,
  sortKey: TreasuryProposalTableSortKey | undefined,
  sortDirection: TreasuryProposalTableSortDirection | undefined,
): void {
  const apiSortKey = sortKey ? PROPOSAL_LIST_SORT_KEY_MAP[sortKey] : undefined;
  if (!apiSortKey) {
    return;
  }
  url.searchParams.append(
    "sort",
    `${apiSortKey},${(sortDirection ?? "desc").toUpperCase()}`,
  );
}

function extractTitleFromMarkdown(
  contents: string | null | undefined,
): string | undefined {
  const normalized = contents?.replace(/^\uFEFF/, "");
  if (!normalized) {
    return undefined;
  }

  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+?)(?:\s+#+\s*|#*\s*)$/);
    if (headingMatch?.[1]) {
      return headingMatch[1].trim();
    }
  }

  return undefined;
}

export function inferProposalPeriod(value: string | undefined): string {
  const normalized = value?.toLowerCase() ?? "";
  if (
    normalized.length === 0 ||
    normalized === "pending" ||
    normalized === "canonical" ||
    normalized === "orphaned" ||
    normalized === "unknown"
  ) {
    // Default to proposal while lifecycle context is still hydrating.
    return "Proposal";
  }

  if (
    normalized.includes("proposal") ||
    normalized.includes("submitted") ||
    normalized.includes("draft") ||
    normalized.includes("ready for review")
  ) {
    return "Proposal";
  }

  if (normalized.includes("exploration") || normalized.includes("review")) {
    return "Exploration";
  }

  if (
    normalized.includes("cooldown") ||
    normalized.includes("approved") ||
    normalized.includes("passed") ||
    normalized.includes("failed") ||
    normalized.includes("rejected") ||
    normalized.includes("abandoned") ||
    normalized.includes("paused") ||
    normalized.includes("vetoed") ||
    normalized.includes("execut")
  ) {
    return "Cooldown";
  }

  if (
    normalized.includes("voting") ||
    normalized.includes("waiting for votes") ||
    normalized.includes("passing") ||
    normalized.includes("failing")
  ) {
    return "Voting";
  }

  return "Proposal";
}

function inferPausedState(
  stage: string | undefined,
  explicitIsPaused: boolean | undefined,
): boolean | undefined {
  if (explicitIsPaused !== undefined) {
    return explicitIsPaused;
  }
  const normalized = stage?.trim().toLowerCase() ?? "";
  if (normalized.includes("paused") || normalized.includes("vetoed")) {
    return true;
  }
  return undefined;
}

export function mapProposalItemToEntry(
  item: ProposalApiItem,
): TreasuryProposalTableEntry {
  const stage = item.stage ?? item.status ?? "Unknown";
  const period = item.period ?? inferProposalPeriod(stage);
  const title =
    extractTitleFromMarkdown(item.contents) ?? item.title ?? item.id;
  const isPaused = inferPausedState(stage, item.isPaused);

  return {
    id: item.id,
    title,
    lifecycleId: item.lifecycleId,
    proposalAddress: item.proposalPublicKey,
    proposer: item.senderPublicKey ?? item.proposer ?? "-",
    requestedAmount: item.amount ?? item.requestedAmount ?? "-",
    stage,
    period,
    createdAt: item.createdAt ?? "-",
    createdAtBlock: item.createdAtBlockHeight,
    stakingEpochDataLedgerTotalCurrency:
      item.stakingEpochDataLedgerTotalCurrency,
    requiredParticipationBp: item.requiredParticipationBp,
    requiredApprovalBp: item.requiredApprovalBp,
    requiredParticipation: item.requiredParticipation,
    latestVoteTally: item.latestVoteTally,
    isPaused,
  };
}

export function mapProposalItemToDetailProposal(
  item: ProposalApiItem,
): TreasuryProposalDetailProposal {
  const entry = mapProposalItemToEntry(item);

  return {
    ...entry,
    recipient: item.recipient,
    zkAppUriHash: item.zkAppUriHash,
    stakingEpochDataLedgerHash: item.stakingEpochDataLedgerHash,
    paidOutAmount: item.paidOutAmount,
    contents: item.contents,
    updatedAt: item.updatedAt,
    createdAtBlockTimestamp: item.createdAtBlockTimestamp,
  };
}

export async function fetchProposalSearchResults(
  apiUrl: string,
  query: string,
  limit = 8,
): Promise<TreasuryProposalTableEntry[]> {
  const searchUrl = new URL(resolveEndpointUrl(apiUrl, "/proposals/search"));
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", String(limit));
  searchUrl.searchParams.set("offset", "0");

  const response = await fetch(searchUrl.toString());
  if (!response.ok) {
    throw new Error(`Proposal search failed: ${response.status}`);
  }

  const payload = (await response.json()) as ProposalListResponse;
  return (payload.items ?? []).map(mapProposalItemToEntry);
}

export async function fetchLatestProposal(
  apiUrl: string,
): Promise<TreasuryProposalTableEntry | null> {
  const proposalsUrl = new URL(resolveEndpointUrl(apiUrl, "/proposals"));
  proposalsUrl.searchParams.set("limit", "1");
  proposalsUrl.searchParams.set("offset", "0");

  const response = await fetch(proposalsUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch latest proposal: ${response.status}`);
  }

  const payload = (await response.json()) as ProposalListResponse;
  const firstItem = payload.items?.[0];
  return firstItem ? mapProposalItemToEntry(firstItem) : null;
}

export async function fetchProposals(
  apiUrl: string,
  lifecycleId?: number,
  limit = 200,
): Promise<TreasuryProposalTableEntry[]> {
  const page = await fetchProposalItemsPage(apiUrl, {
    lifecycleId,
    limit,
    offset: 0,
  });
  return page.items.map(mapProposalItemToEntry);
}

export async function fetchProposalItems(
  apiUrl: string,
  lifecycleId?: number,
  limit = 200,
): Promise<ProposalApiItem[]> {
  const page = await fetchProposalItemsPage(apiUrl, {
    lifecycleId,
    limit,
    offset: 0,
  });
  return page.items;
}

export async function fetchProposalItem(
  apiUrl: string,
  proposalPublicKey: string,
): Promise<ProposalApiItem | null> {
  const proposalUrl = resolveEndpointUrl(
    apiUrl,
    `/proposals/${encodeURIComponent(proposalPublicKey)}`,
  );
  const response = await fetch(proposalUrl);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal detail: ${response.status}`);
  }
  return (await response.json()) as ProposalApiItem;
}

export async function fetchProposalItemsPage(
  apiUrl: string,
  options: FetchProposalItemsOptions = {},
): Promise<ProposalItemsPage> {
  const proposalsUrl = new URL(resolveEndpointUrl(apiUrl, "/proposals"));
  if (options.lifecycleId !== undefined) {
    proposalsUrl.searchParams.set("lifecycleId", String(options.lifecycleId));
  }
  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;
  proposalsUrl.searchParams.set("limit", String(limit));
  proposalsUrl.searchParams.set("offset", String(offset));
  appendProposalListSort(proposalsUrl, options.sortKey, options.sortDirection);

  const response = await fetch(proposalsUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch proposals: ${response.status}`);
  }

  const payload = (await response.json()) as ProposalListResponse;
  return {
    items: payload.items ?? [],
    total: payload.total ?? payload.items?.length ?? 0,
    nextOffset: payload.nextOffset ?? null,
    limit: payload.limit ?? limit,
    offset: payload.offset ?? offset,
  };
}

export async function fetchProposalVotes(
  apiUrl: string,
  proposalPublicKey: string,
): Promise<TreasuryProposalVoteRow[]> {
  const page = await fetchProposalVotesPage(apiUrl, proposalPublicKey, {
    limit: 200,
    offset: 0,
  });
  return page.items;
}

export async function fetchProposalVotesPage(
  apiUrl: string,
  proposalPublicKey: string,
  options: FetchProposalDetailRowsOptions = {},
): Promise<ProposalVotesPage> {
  const proposalVotesUrl = new URL(
    resolveEndpointUrl(
      apiUrl,
      `/proposals/${encodeURIComponent(proposalPublicKey)}/votes`,
    ),
  );
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  proposalVotesUrl.searchParams.set("limit", String(limit));
  proposalVotesUrl.searchParams.set("offset", String(offset));
  const response = await fetch(proposalVotesUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal votes: ${response.status}`);
  }

  const payload = (await response.json()) as ProposalVotesResponse;
  const items = (payload.items ?? []).map((item) => ({
    id: item.id,
    voterPublicKey: item.voterPublicKey ?? "-",
    vote: item.vote ?? "-",
    voteWeight: item.voteWeight ?? "0",
    blockHeight: item.blockHeight ?? null,
    isNullified: item.isNullified,
    status: item.status ?? null,
  }));
  return {
    items,
    total: payload.total ?? items.length,
    nextOffset: payload.nextOffset ?? null,
    limit: payload.limit ?? limit,
    offset: payload.offset ?? offset,
  };
}

export async function fetchProposalExecutions(
  apiUrl: string,
  proposalPublicKey: string,
): Promise<TreasuryProposalExecutionRow[]> {
  const page = await fetchProposalExecutionsPage(apiUrl, proposalPublicKey, {
    limit: 200,
    offset: 0,
  });
  return page.items;
}

export async function fetchProposalExecutionsPage(
  apiUrl: string,
  proposalPublicKey: string,
  options: FetchProposalDetailRowsOptions = {},
): Promise<ProposalExecutionsPage> {
  const proposalExecutionsUrl = new URL(
    resolveEndpointUrl(
      apiUrl,
      `/proposals/${encodeURIComponent(proposalPublicKey)}/executions`,
    ),
  );
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  proposalExecutionsUrl.searchParams.set("limit", String(limit));
  proposalExecutionsUrl.searchParams.set("offset", String(offset));
  const response = await fetch(proposalExecutionsUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal executions: ${response.status}`);
  }

  const payload = (await response.json()) as ProposalExecutionsResponse;
  const items = (payload.items ?? []).map((item) => ({
    id: item.id,
    recipient: item.recipient ?? "-",
    amountToPayOut: item.amountToPayOut ?? "0",
    bondAmount: item.bondAmount ?? null,
    senderPublicKey: item.senderPublicKey ?? null,
    paidOutAmount: item.paidOutAmount ?? "0",
    remainingAmount: item.remainingAmount ?? "0",
    blockHeight: item.blockHeight ?? null,
    status: item.status ?? null,
  }));
  return {
    items,
    total: payload.total ?? items.length,
    nextOffset: payload.nextOffset ?? null,
    limit: payload.limit ?? limit,
    offset: payload.offset ?? offset,
  };
}

interface StakingLedgerAccountResponse {
  delegatePublicKey?: string | null;
  balance?: string | null;
}

interface VotingLedgerAccountResponse {
  voteWeight?: string | null;
}

async function parseOptionalJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T | null;
}

export async function fetchWalletLifecycleAccountInfo(
  apiUrl: string,
  lifecycleId: number,
  publicKey: string,
): Promise<{ delegatedTo?: string; votingWeight?: string }> {
  const stakingUrl = new URL(
    resolveEndpointUrl(
      apiUrl,
      `/staking-ledger/lifecycles/${lifecycleId}/accounts/${publicKey}`,
    ),
  );
  const votingUrl = new URL(
    resolveEndpointUrl(
      apiUrl,
      `/voting-ledger/lifecycles/${lifecycleId}/accounts/${publicKey}`,
    ),
  );

  const [stakingResponse, votingResponse] = await Promise.all([
    fetch(stakingUrl.toString()),
    fetch(votingUrl.toString()),
  ]);

  if (!stakingResponse.ok) {
    throw new Error(
      `Failed to fetch staking account: ${stakingResponse.status}`,
    );
  }

  if (!votingResponse.ok) {
    throw new Error(`Failed to fetch voting account: ${votingResponse.status}`);
  }

  const stakingAccount =
    await parseOptionalJson<StakingLedgerAccountResponse>(stakingResponse);
  const votingAccount =
    await parseOptionalJson<VotingLedgerAccountResponse>(votingResponse);

  return {
    delegatedTo: stakingAccount?.delegatePublicKey ?? undefined,
    votingWeight: formatNanominaBalance(votingAccount?.voteWeight ?? "0"),
  };
}

export async function fetchLifecycleProposalEstimateContext(
  apiUrl: string,
  minaNodeUrl: string,
  lifecycleId: number,
  treasuryOwnerPublicKey: string,
): Promise<{ treasuryBalance: string; eligibleVotingWeight: string }> {
  const stakingAccountUrl = new URL(
    resolveEndpointUrl(
      apiUrl,
      `/staking-ledger/lifecycles/${lifecycleId}/accounts/${treasuryOwnerPublicKey}`,
    ),
  );

  const [stakingAccountResponse, stakingLedgerTotalCurrency] =
    await Promise.all([
      fetch(stakingAccountUrl.toString()),
      fetchStakingLedgerTotalCurrency(minaNodeUrl),
    ]);

  if (!stakingAccountResponse.ok) {
    throw new Error(
      `Failed to fetch staking treasury account: ${stakingAccountResponse.status}`,
    );
  }

  const stakingAccount = await parseOptionalJson<StakingLedgerAccountResponse>(
    stakingAccountResponse,
  );

  return {
    treasuryBalance: formatNanominaBalance(stakingAccount?.balance ?? "0"),
    eligibleVotingWeight: stakingLedgerTotalCurrency,
  };
}
