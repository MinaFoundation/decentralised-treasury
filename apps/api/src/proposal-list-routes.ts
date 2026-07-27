import type { EventsApiServerOptions } from "@repo/indexer";
import type { DataSource } from "typeorm";

const DEFAULT_PROPOSAL_LIST_LIMIT = 20;
const DEFAULT_PROPOSAL_LIST_MAX = 200;

interface ProposalListRoutesOptions {
  dataSource: DataSource;
  pageLimitDefault?: number;
  pageLimitMax?: number;
}

interface ProposalListQueryRow {
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
}

interface ProposalListVoteTallyRow {
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

interface ProposalVoteRow {
  id: string | number;
  proposal_public_key: string;
  voter_public_key: string;
  vote: string;
  vote_weight: string;
  block_height: number | null;
  is_nullified: boolean | number;
  status: string;
  created_at: string | Date;
}

interface ProposalExecutionRow {
  id: string | number;
  proposal_public_key: string;
  recipient: string;
  amount_to_pay_out: string;
  bond_amount: string;
  sender_public_key: string;
  paid_out_amount: string;
  remaining_amount: string;
  block_height: number | null;
  status: string;
  created_at: string | Date;
}

class RequestValidationError extends Error {}
type ProposalListSortDirection = "ASC" | "DESC";

const PROPOSAL_LIST_SORT_COLUMNS = {
  lifecycleId: `proposals."lifecycle_id"`,
  senderPublicKey: `proposals."sender_public_key"`,
  amount: `proposals."amount"`,
  createdAt: `proposals."created_at"`,
} as const;

function parsePositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
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

function parseOptionalLifecycleId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new RequestValidationError(
      "lifecycleId must be a non-negative integer",
    );
  }
  return Number.parseInt(value, 10);
}

function parseSortValues(value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value;
  }
  throw new RequestValidationError(
    "sort must be a string or repeated query parameter",
  );
}

function parseProposalListOrderBy(value: unknown): string {
  const sortValues = parseSortValues(value);
  if (sortValues.length === 0) {
    return `proposals."lifecycle_id" DESC,
            proposals."created_at_block_height" DESC NULLS LAST,
            proposals."created_at" DESC,
            proposals."id" DESC`;
  }

  const clauses = sortValues.map((sortValue) => {
    const [field, directionCandidate] = sortValue.split(",");
    const column =
      PROPOSAL_LIST_SORT_COLUMNS[
        field as keyof typeof PROPOSAL_LIST_SORT_COLUMNS
      ];
    if (!column) {
      throw new RequestValidationError(`unsupported sort field: ${field}`);
    }
    const normalizedDirection = (directionCandidate ?? "ASC")
      .trim()
      .toUpperCase();
    if (normalizedDirection !== "ASC" && normalizedDirection !== "DESC") {
      throw new RequestValidationError(
        `unsupported sort direction: ${directionCandidate}`,
      );
    }
    const direction = normalizedDirection as ProposalListSortDirection;
    const nullsClause =
      field === "senderPublicKey"
        ? direction === "ASC"
          ? " NULLS FIRST"
          : " NULLS LAST"
        : "";
    return `${column} ${direction}${nullsClause}`;
  });

  clauses.push(`proposals."id" DESC`);
  return clauses.join(", ");
}

function toIsoString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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
    "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return (
    message.includes("processor_proposals") &&
    (message.includes("does not exist") || message.includes("relation"))
  );
}

async function proposalExists(
  dataSource: DataSource,
  proposalPublicKey: string,
): Promise<boolean> {
  const rows = (await dataSource.query(
    `SELECT 1
    FROM "processor_proposals"
    WHERE "proposal_public_key" = $1
    LIMIT 1`,
    [proposalPublicKey],
  )) as Array<{ "?column?"?: number }>;
  return rows.length > 0;
}

async function loadLatestVoteTallies(
  dataSource: DataSource,
  proposalPublicKeys: string[],
): Promise<Map<string, ProposalListVoteTallyRow>> {
  if (proposalPublicKeys.length === 0) {
    return new Map();
  }

  const placeholders = proposalPublicKeys
    .map((_, index) => `$${index + 1}`)
    .join(", ");
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
    ORDER BY "proposal_public_key" ASC, "block_height" DESC, "created_at" DESC, "id" DESC`,
    proposalPublicKeys,
  )) as ProposalListVoteTallyRow[];

  const latestTallies = new Map<string, ProposalListVoteTallyRow>();
  for (const row of rows) {
    if (!latestTallies.has(row.proposal_public_key)) {
      latestTallies.set(row.proposal_public_key, row);
    }
  }
  return latestTallies;
}

function mapProposalRow(
  row: ProposalListQueryRow,
  latestVoteTally: ProposalListVoteTallyRow | undefined,
) {
  return {
    id: String(row.id),
    proposalPublicKey: row.proposal_public_key,
    lifecycleId: Number(row.lifecycle_id),
    amount: row.amount,
    recipient: row.recipient,
    senderPublicKey: row.sender_public_key,
    zkAppUriHash: row.zkapp_uri_hash,
    stakingEpochDataLedgerHash: row.staking_epoch_data_ledger_hash,
    stakingEpochDataLedgerTotalCurrency:
      row.staking_epoch_data_ledger_total_currency,
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
}

export function createProposalListRoutes({
  dataSource,
  pageLimitDefault = DEFAULT_PROPOSAL_LIST_LIMIT,
  pageLimitMax = DEFAULT_PROPOSAL_LIST_MAX,
}: ProposalListRoutesOptions) {
  const resolvedPageLimitDefault = Math.max(1, pageLimitDefault);
  const resolvedPageLimitMax = Math.max(resolvedPageLimitDefault, pageLimitMax);

  return (
    app: Parameters<NonNullable<EventsApiServerOptions["registerRoutes"]>>[0],
  ) => {
    app.get("/proposals", async (request, response) => {
      try {
        const lifecycleId = parseOptionalLifecycleId(request.query.lifecycleId);
        const limit = parsePositiveInt(
          request.query.limit,
          resolvedPageLimitDefault,
          resolvedPageLimitMax,
        );
        const offset = parseNonNegativeInt(request.query.offset, 0);
        const orderByClause = parseProposalListOrderBy(request.query.sort);
        const queryParameters: Array<number> = [];
        const whereClause =
          lifecycleId === null
            ? ""
            : (() => {
                queryParameters.push(lifecycleId);
                return `WHERE proposals."lifecycle_id" = $${queryParameters.length}`;
              })();
        const countParameters = [...queryParameters];
        const totalCountRow = (await dataSource.query(
          `SELECT COUNT(*)::int AS count
          FROM "processor_proposals" proposals
          ${whereClause}`,
          countParameters,
        )) as Array<{ count: number | string }>;
        const total = Number(totalCountRow[0]?.count ?? 0);
        queryParameters.push(limit + 1, offset);

        const rows = (await dataSource.query(
          `SELECT
            proposals."id",
            proposals."proposal_public_key",
            proposals."lifecycle_id",
            proposals."amount",
            proposals."recipient",
            proposals."sender_public_key",
            proposals."zkapp_uri_hash",
            proposals."staking_epoch_data_ledger_hash",
            proposals."staking_epoch_data_ledger_total_currency",
            proposals."required_participation_bp",
            proposals."required_approval_bp",
            proposals."required_participation",
            proposals."status",
            proposals."is_paused",
            proposals."paid_out_amount",
            proposals."contents",
            proposals."created_at_block_height",
            proposals."created_at_block_timestamp",
            proposals."created_at",
            proposals."updated_at"
          FROM "processor_proposals" proposals
          ${whereClause}
          ORDER BY ${orderByClause}
          LIMIT $${queryParameters.length - 1}
          OFFSET $${queryParameters.length}`,
          queryParameters,
        )) as ProposalListQueryRow[];

        const hasMore = rows.length > limit;
        const visibleRows = rows.slice(0, limit);
        const latestTallies = await loadLatestVoteTallies(
          dataSource,
          visibleRows.map((row) => row.proposal_public_key),
        );
        const items = visibleRows.map((row) =>
          mapProposalRow(row, latestTallies.get(row.proposal_public_key)),
        );

        response.json({
          lifecycleId,
          limit,
          offset,
          total,
          items,
          nextOffset: hasMore ? offset + limit : null,
        });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          response.status(400).json({
            error: error.message,
          });
          return;
        }
        if (isMissingProcessorProposalsTable(error)) {
          response.status(503).json({
            error: "proposal list API is unavailable",
          });
          return;
        }
        console.error("[indexer-api] failed to list proposals", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });

    app.get("/proposals/:proposalPublicKey", async (request, response) => {
      try {
        const { proposalPublicKey } = request.params;
        const rows = (await dataSource.query(
          `SELECT
            proposals."id",
            proposals."proposal_public_key",
            proposals."lifecycle_id",
            proposals."amount",
            proposals."recipient",
            proposals."sender_public_key",
            proposals."zkapp_uri_hash",
            proposals."staking_epoch_data_ledger_hash",
            proposals."staking_epoch_data_ledger_total_currency",
            proposals."required_participation_bp",
            proposals."required_approval_bp",
            proposals."required_participation",
            proposals."status",
            proposals."is_paused",
            proposals."paid_out_amount",
            proposals."contents",
            proposals."created_at_block_height",
            proposals."created_at_block_timestamp",
            proposals."created_at",
            proposals."updated_at"
          FROM "processor_proposals" proposals
          WHERE proposals."proposal_public_key" = $1
             OR CAST(proposals."id" AS TEXT) = $1
          LIMIT 1`,
          [proposalPublicKey],
        )) as ProposalListQueryRow[];
        const row = rows[0];
        if (!row) {
          response.status(404).json({
            error: "Proposal not found",
          });
          return;
        }

        const latestTallies = await loadLatestVoteTallies(dataSource, [
          row.proposal_public_key,
        ]);
        response.json(
          mapProposalRow(row, latestTallies.get(row.proposal_public_key)),
        );
      } catch (error) {
        if (isMissingProcessorProposalsTable(error)) {
          response.status(503).json({
            error: "proposal detail API is unavailable",
          });
          return;
        }
        console.error("[indexer-api] failed to fetch proposal detail", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });

    app.get(
      "/proposals/:proposalPublicKey/votes",
      async (request, response) => {
        try {
          const { proposalPublicKey } = request.params;
          const exists = await proposalExists(dataSource, proposalPublicKey);
          if (!exists) {
            response.status(404).json({
              error: "Proposal not found",
            });
            return;
          }

          const limit = parsePositiveInt(
            request.query.limit,
            resolvedPageLimitDefault,
            resolvedPageLimitMax,
          );
          const offset = parseNonNegativeInt(request.query.offset, 0);
          const totalCountRow = (await dataSource.query(
            `SELECT COUNT(*)::int AS count
          FROM "processor_votes"
          WHERE "proposal_public_key" = $1
            AND "is_nullified" = false
            AND "status" <> 'orphaned'`,
            [proposalPublicKey],
          )) as Array<{ count: number | string }>;
          const total = Number(totalCountRow[0]?.count ?? 0);
          const rows = (await dataSource.query(
            `SELECT
            "id",
            "proposal_public_key",
            "voter_public_key",
            "vote",
            "vote_weight",
            "block_height",
            "is_nullified",
            "status",
            "created_at"
          FROM "processor_votes"
          WHERE "proposal_public_key" = $1
            AND "is_nullified" = false
            AND "status" <> 'orphaned'
          ORDER BY "block_height" DESC NULLS LAST, "created_at" DESC, "id" DESC
          LIMIT $2 OFFSET $3`,
            [proposalPublicKey, limit + 1, offset],
          )) as ProposalVoteRow[];

          const hasMore = rows.length > limit;
          const visibleRows = rows.slice(0, limit);
          response.json({
            proposalPublicKey,
            limit,
            offset,
            total,
            items: visibleRows.map((row) => ({
              id: String(row.id),
              proposalPublicKey: row.proposal_public_key,
              voterPublicKey: row.voter_public_key,
              vote: row.vote,
              voteWeight: row.vote_weight,
              blockHeight: row.block_height,
              isNullified: Boolean(row.is_nullified),
              status: row.status,
              createdAt: toIsoString(row.created_at),
            })),
            nextOffset: hasMore ? offset + limit : null,
          });
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({
              error: error.message,
            });
            return;
          }
          if (isMissingProcessorProposalsTable(error)) {
            response.status(503).json({
              error: "proposal votes API is unavailable",
            });
            return;
          }
          console.error("[indexer-api] failed to list proposal votes", error);
          response.status(500).json({
            error: "Internal server error",
          });
        }
      },
    );

    app.get(
      "/proposals/:proposalPublicKey/executions",
      async (request, response) => {
        try {
          const { proposalPublicKey } = request.params;
          const exists = await proposalExists(dataSource, proposalPublicKey);
          if (!exists) {
            response.status(404).json({
              error: "Proposal not found",
            });
            return;
          }

          const limit = parsePositiveInt(
            request.query.limit,
            resolvedPageLimitDefault,
            resolvedPageLimitMax,
          );
          const offset = parseNonNegativeInt(request.query.offset, 0);
          const totalCountRow = (await dataSource.query(
            `SELECT COUNT(*)::int AS count
          FROM "processor_proposal_executions"
          WHERE "proposal_public_key" = $1
            AND "status" <> 'orphaned'`,
            [proposalPublicKey],
          )) as Array<{ count: number | string }>;
          const total = Number(totalCountRow[0]?.count ?? 0);
          const rows = (await dataSource.query(
            `SELECT
            "id",
            "proposal_public_key",
            "recipient",
            "amount_to_pay_out",
            "bond_amount",
            "sender_public_key",
            "paid_out_amount",
            "remaining_amount",
            "block_height",
            "status",
            "created_at"
          FROM "processor_proposal_executions"
          WHERE "proposal_public_key" = $1
            AND "status" <> 'orphaned'
          ORDER BY "block_height" DESC NULLS LAST, "created_at" DESC, "id" DESC
          LIMIT $2 OFFSET $3`,
            [proposalPublicKey, limit + 1, offset],
          )) as ProposalExecutionRow[];

          const hasMore = rows.length > limit;
          const visibleRows = rows.slice(0, limit);
          response.json({
            proposalPublicKey,
            limit,
            offset,
            total,
            items: visibleRows.map((row) => ({
              id: String(row.id),
              proposalPublicKey: row.proposal_public_key,
              recipient: row.recipient,
              amountToPayOut: row.amount_to_pay_out,
              bondAmount: row.bond_amount,
              senderPublicKey: row.sender_public_key,
              paidOutAmount: row.paid_out_amount,
              remainingAmount: row.remaining_amount,
              blockHeight: row.block_height,
              status: row.status,
              createdAt: toIsoString(row.created_at),
            })),
            nextOffset: hasMore ? offset + limit : null,
          });
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({
              error: error.message,
            });
            return;
          }
          if (isMissingProcessorProposalsTable(error)) {
            response.status(503).json({
              error: "proposal executions API is unavailable",
            });
            return;
          }
          console.error(
            "[indexer-api] failed to list proposal executions",
            error,
          );
          response.status(500).json({
            error: "Internal server error",
          });
        }
      },
    );
  };
}
