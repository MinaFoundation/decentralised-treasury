import type { EventsApiServerOptions } from "@repo/indexer";
import type { DataSource } from "typeorm";

const DEFAULT_PROPOSAL_SEARCH_LIMIT = 20;

export const PROPOSAL_SEARCH_QUERY_REQUIRED_ERROR = "q must be a non-empty string";

interface ProposalSearchRoutesOptions {
  dataSource: DataSource;
  pageLimitDefault?: number;
  pageLimitMax?: number;
}

interface ProposalSearchQueryRow {
  id: string | number;
  proposal_public_key: string;
  lifecycle_id: string | number;
  amount: string;
  recipient: string;
  sender_public_key: string | null;
  zkapp_uri_hash: string;
  staking_epoch_data_ledger_hash: string | null;
  staking_epoch_data_ledger_total_currency: string | null;
  required_participation_bp: string | null;
  required_approval_bp: string | null;
  required_participation: string | null;
  status: string;
  is_paused: boolean | number;
  paid_out_amount: string;
  contents: string | null;
  created_at_block_height: number | null;
  created_at_block_timestamp: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  search_rank: string | number | null;
  exact_phrase_match?: number | boolean;
}

interface ProposalSearchVoteTallyRow {
  proposal_public_key: string;
  block_height: number;
  yay_weight: string;
  nay_weight: string;
  abstain_weight: string;
  created_by_event_type: string | null;
  required_participation_bp: string | null;
  required_approval_bp: string | null;
  required_participation: string | null;
  total_participating_votes: string | null;
  approval_bp: string | null;
  vote_result: string | null;
}

class RequestValidationError extends Error {}

function parseSearchQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestValidationError(PROPOSAL_SEARCH_QUERY_REQUIRED_ERROR);
  }
  return value.trim();
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RequestValidationError("limit must be a positive integer");
  }
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RequestValidationError("offset must be a non-negative integer");
  }
  return parsed;
}

function toIsoString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isMissingProcessorProposalsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = "code" in error ? (error as { code?: unknown }).code : null;
  if (maybeCode === "42P01") {
    return true;
  }
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return (
    message.includes("processor_proposals") &&
    (message.includes("does not exist") || message.includes("relation"))
  );
}

function isUnsupportedTextSearch(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  return (
    message.includes("to_tsvector") ||
    message.includes("plainto_tsquery") ||
    message.includes("ts_rank_cd") ||
    message.includes("not supported") ||
    message.includes("Unknown function")
  );
}

function tokenizeSearchQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    ),
  );
}

function buildSearchableTextFromRow(row: ProposalSearchQueryRow): string {
  return [
    row.id,
    row.proposal_public_key,
    row.lifecycle_id,
    row.amount,
    row.recipient,
    row.sender_public_key,
    row.zkapp_uri_hash,
    row.staking_epoch_data_ledger_hash,
    row.staking_epoch_data_ledger_total_currency,
    row.required_participation_bp,
    row.required_approval_bp,
    row.required_participation,
    row.status,
    row.is_paused,
    row.paid_out_amount,
    row.contents,
    row.created_at_block_height,
    toIsoString(row.created_at_block_timestamp),
    toIsoString(row.created_at),
    toIsoString(row.updated_at),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ");
}

function buildSearchableTextExpression(alias: string): string {
  return `concat_ws(' ',
    coalesce(${alias}."id"::text, ''),
    coalesce(${alias}."proposal_public_key", ''),
    coalesce(${alias}."lifecycle_id"::text, ''),
    coalesce(${alias}."amount", ''),
    coalesce(${alias}."recipient", ''),
    coalesce(${alias}."sender_public_key", ''),
    coalesce(${alias}."zkapp_uri_hash", ''),
    coalesce(${alias}."staking_epoch_data_ledger_hash", ''),
    coalesce(${alias}."staking_epoch_data_ledger_total_currency", ''),
    coalesce(${alias}."required_participation_bp", ''),
    coalesce(${alias}."required_approval_bp", ''),
    coalesce(${alias}."required_participation", ''),
    coalesce(${alias}."status", ''),
    coalesce(${alias}."is_paused"::text, ''),
    coalesce(${alias}."paid_out_amount", ''),
    coalesce(${alias}."contents", ''),
    coalesce(${alias}."created_at_block_height"::text, ''),
    coalesce(cast(${alias}."created_at_block_timestamp" as varchar), ''),
    coalesce(cast(${alias}."created_at" as varchar), ''),
    coalesce(cast(${alias}."updated_at" as varchar), '')
  )`;
}

async function loadLatestVoteTallies(
  dataSource: DataSource,
  proposalPublicKeys: string[],
): Promise<Map<string, ProposalSearchVoteTallyRow>> {
  if (proposalPublicKeys.length === 0) {
    return new Map();
  }

  const placeholders = proposalPublicKeys.map((_, index) => `$${index + 1}`).join(", ");
  const rows = (await dataSource.query(
    `SELECT
      "proposal_public_key",
      "block_height",
      "yay_weight",
      "nay_weight",
      "abstain_weight",
      "created_by_event_type",
      "required_participation_bp",
      "required_approval_bp",
      "required_participation",
      "total_participating_votes",
      "approval_bp",
      "vote_result"
    FROM "processor_vote_tallies"
    WHERE "proposal_public_key" IN (${placeholders})
    ORDER BY "proposal_public_key" ASC, "block_height" DESC, "id" DESC`,
    proposalPublicKeys,
  )) as ProposalSearchVoteTallyRow[];

  const latestTallies = new Map<string, ProposalSearchVoteTallyRow>();
  for (const row of rows) {
    if (!latestTallies.has(row.proposal_public_key)) {
      latestTallies.set(row.proposal_public_key, row);
    }
  }
  return latestTallies;
}

async function queryProposalsWithFullTextSearch(
  dataSource: DataSource,
  query: string,
  phrasePattern: string,
  limit: number,
  offset: number,
): Promise<ProposalSearchQueryRow[]> {
  const searchableTextExpression = buildSearchableTextExpression("p");
  return (await dataSource.query(
    `WITH searchable AS (
      SELECT
        p."id",
        p."proposal_public_key",
        p."lifecycle_id",
        p."amount",
        p."recipient",
        p."sender_public_key",
        p."zkapp_uri_hash",
        p."staking_epoch_data_ledger_hash",
        p."staking_epoch_data_ledger_total_currency",
        p."required_participation_bp",
        p."required_approval_bp",
        p."required_participation",
        p."status",
        p."is_paused",
        p."paid_out_amount",
        p."contents",
        p."created_at_block_height",
        p."created_at_block_timestamp",
        p."created_at",
        p."updated_at",
        ${searchableTextExpression} AS "searchable_text"
      FROM "processor_proposals" p
    )
    SELECT
      "id",
      "proposal_public_key",
      "lifecycle_id",
      "amount",
      "recipient",
      "sender_public_key",
      "zkapp_uri_hash",
      "staking_epoch_data_ledger_hash",
      "staking_epoch_data_ledger_total_currency",
      "required_participation_bp",
      "required_approval_bp",
      "required_participation",
      "status",
      "is_paused",
      "paid_out_amount",
      "contents",
      "created_at_block_height",
      "created_at_block_timestamp",
      "created_at",
      "updated_at",
      CASE
        WHEN "searchable_text" ILIKE $2 THEN 1
        ELSE 0
      END AS "exact_phrase_match",
      ts_rank_cd(
        to_tsvector('simple', "searchable_text"),
        plainto_tsquery('simple', $1)
      ) AS "search_rank"
    FROM searchable
    WHERE (
      to_tsvector('simple', "searchable_text") @@ plainto_tsquery('simple', $1)
      OR "searchable_text" ILIKE $2
    )
    ORDER BY
      "exact_phrase_match" DESC,
      "search_rank" DESC,
      "created_at_block_height" DESC NULLS LAST,
      "id" DESC
    LIMIT $3
    OFFSET $4`,
    [query, phrasePattern, limit, offset],
  )) as ProposalSearchQueryRow[];
}

async function queryProposalsWithSubstringFallback(
  dataSource: DataSource,
  query: string,
  limit: number,
  offset: number,
): Promise<ProposalSearchQueryRow[]> {
  const rows = (await dataSource.query(
    `SELECT
      "id",
      "proposal_public_key",
      "lifecycle_id",
      "amount",
      "recipient",
      "sender_public_key",
      "zkapp_uri_hash",
      "staking_epoch_data_ledger_hash",
      "staking_epoch_data_ledger_total_currency",
      "required_participation_bp",
      "required_approval_bp",
      "required_participation",
      "status",
      "is_paused",
      "paid_out_amount",
      "contents",
      "created_at_block_height",
      "created_at_block_timestamp",
      "created_at",
      "updated_at"
    FROM "processor_proposals"
    ORDER BY
      "created_at_block_height" DESC NULLS LAST,
      "id" DESC`,
  )) as ProposalSearchQueryRow[];
  const tokens = tokenizeSearchQuery(query);
  const normalizedQuery = query.toLowerCase();

  return rows
    .map((row) => {
      const searchableText = buildSearchableTextFromRow(row).toLowerCase();
      const exactPhraseMatch = searchableText.includes(normalizedQuery);
      const tokenMatch =
        tokens.length > 0 &&
        tokens.every((token) => searchableText.includes(token.toLowerCase()));
      return {
        ...row,
        exact_phrase_match: exactPhraseMatch,
        search_rank: exactPhraseMatch ? 1 : 0,
        matches: exactPhraseMatch || tokenMatch,
      };
    })
    .filter((row) => row.matches)
    .sort((a, b) => {
      const exactPhraseDiff =
        Number(Boolean(b.exact_phrase_match)) - Number(Boolean(a.exact_phrase_match));
      if (exactPhraseDiff !== 0) {
        return exactPhraseDiff;
      }
      const blockHeightDiff =
        (b.created_at_block_height ?? Number.NEGATIVE_INFINITY) -
        (a.created_at_block_height ?? Number.NEGATIVE_INFINITY);
      if (blockHeightDiff !== 0) {
        return blockHeightDiff;
      }
      return Number(b.id) - Number(a.id);
    })
    .slice(offset, offset + limit)
    .map(({ matches: _matches, ...row }) => row);
}

export function createProposalSearchRoutes({
  dataSource,
  pageLimitDefault = DEFAULT_PROPOSAL_SEARCH_LIMIT,
  pageLimitMax = DEFAULT_PROPOSAL_SEARCH_LIMIT,
}: ProposalSearchRoutesOptions): NonNullable<EventsApiServerOptions["registerRoutes"]> {
  return (app) => {
    app.get("/proposals/search", async (request, response) => {
      let query: string;
      let limit: number;
      let offset: number;

      try {
        query = parseSearchQuery(request.query.q);
        limit = parsePositiveInt(request.query.limit, pageLimitDefault, pageLimitMax);
        offset = parseNonNegativeInt(request.query.offset, 0);
      } catch (error) {
        if (error instanceof RequestValidationError) {
          response.status(400).json({
            error: error.message,
          });
          return;
        }
        console.error("[indexer-api] failed to parse proposal search query", error);
        response.status(500).json({
          error: "Internal server error",
        });
        return;
      }

      const phrasePattern = `%${query}%`;

      try {
        let rows: ProposalSearchQueryRow[];
        try {
          rows = await queryProposalsWithFullTextSearch(
            dataSource,
            query,
            phrasePattern,
            limit + 1,
            offset,
          );
        } catch (error) {
          if (!isUnsupportedTextSearch(error)) {
            throw error;
          }
          rows = await queryProposalsWithSubstringFallback(
            dataSource,
            query,
            limit + 1,
            offset,
          );
        }

        const hasMore = rows.length > limit;
        const visibleRows = rows.slice(0, limit);
        const latestTallies = await loadLatestVoteTallies(
          dataSource,
          visibleRows.map((row) => row.proposal_public_key),
        );
        const items = visibleRows.map((row) => {
          const latestVoteTally = latestTallies.get(row.proposal_public_key);
          return {
            id: String(row.id),
            proposalPublicKey: row.proposal_public_key,
            lifecycleId: Number(row.lifecycle_id),
            amount: row.amount,
            recipient: row.recipient,
            senderPublicKey: row.sender_public_key,
            zkAppUriHash: row.zkapp_uri_hash,
            stakingEpochDataLedgerHash: row.staking_epoch_data_ledger_hash,
            stakingEpochDataLedgerTotalCurrency: row.staking_epoch_data_ledger_total_currency,
            requiredParticipationBp: row.required_participation_bp,
            requiredApprovalBp: row.required_approval_bp,
            requiredParticipation: row.required_participation,
            status: row.status,
            isPaused: Boolean(row.is_paused),
            paidOutAmount: row.paid_out_amount,
            contents: row.contents,
            createdAtBlockHeight: row.created_at_block_height,
            createdAtBlockTimestamp: toIsoString(row.created_at_block_timestamp),
            createdAt: toIsoString(row.created_at),
            updatedAt: toIsoString(row.updated_at),
            searchRank: Number(row.search_rank ?? 0),
            latestVoteTally: latestVoteTally
            ? {
                blockHeight: latestVoteTally.block_height,
                yayWeight: latestVoteTally.yay_weight,
                nayWeight: latestVoteTally.nay_weight,
                abstainWeight: latestVoteTally.abstain_weight,
                createdByEventType: latestVoteTally.created_by_event_type,
                requiredParticipationBp: latestVoteTally.required_participation_bp,
                requiredApprovalBp: latestVoteTally.required_approval_bp,
                requiredParticipation: latestVoteTally.required_participation,
                totalParticipatingVotes: latestVoteTally.total_participating_votes,
                approvalBp: latestVoteTally.approval_bp,
                voteResult: latestVoteTally.vote_result,
              }
            : null,
        };
        });

        response.json({
          query,
          limit,
          offset,
          items,
          nextOffset: hasMore ? offset + limit : null,
        });
      } catch (error) {
        if (isMissingProcessorProposalsTable(error)) {
          response.status(503).json({
            error: "proposal search API is unavailable",
          });
          return;
        }
        console.error("[indexer-api] failed to search proposals", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });
  };
}
