import {
  EVENTS_QUERY,
  EVENTS_QUERY_FALLBACK,
  NETWORK_STATE_QUERY,
} from "./queries.js";
import { TokenId } from "o1js";

const ARCHIVE_DEFAULT_TOKEN_ID = TokenId.toBase58(TokenId.default);

export type ArchiveBlockStatus = "PENDING" | "CANONICAL";

interface GraphQLError {
  message?: string;
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLError[];
}

export interface ArchiveEventData {
  accountUpdateId?: string | null;
  data?: string[] | null;
  eventType?: string | null;
  eventName?: string | null;
  name?: string | null;
  type?: string | null;
  transactionInfo?: {
    hash?: string | null;
    zkappAccountUpdateIds?: number[] | null;
  } | null;
}

export interface ArchiveBlockInfo {
  height: number;
  timestamp?: string | null;
}

export interface ArchiveEventOutput {
  blockInfo: ArchiveBlockInfo;
  eventData?: ArchiveEventData[] | null;
}

interface NetworkStateResponse {
  networkState?: {
    maxBlockHeight?: {
      canonicalMaxBlockHeight?: number | null;
      pendingMaxBlockHeight?: number | null;
    } | null;
  } | null;
}

interface EventsResponse {
  events?: ArchiveEventOutput[] | null;
}

export interface ArchiveMaxHeights {
  canonicalMaxBlockHeight: number;
  pendingMaxBlockHeight: number;
}

export interface FetchEventsOptions {
  status: ArchiveBlockStatus;
  from: number;
  to: number;
}

export interface ArchiveClientConfig {
  treasuryOwnerContractAddress: string;
  archiveRequestTimeoutMs: number;
}

export class ArchiveClient {
  private supportsBlockTimestamp: boolean | null = null;

  public constructor(
    private readonly archiveNodeUrl: string,
    private readonly config: ArchiveClientConfig,
  ) {}

  private async post<TData>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<TData> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.archiveRequestTimeoutMs,
    );

    try {
      const response = await fetch(this.archiveNodeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Archive request failed: ${response.status} ${response.statusText}`,
        );
      }

      const payload = (await response.json()) as GraphQLResponse<TData>;
      if (payload.errors?.length) {
        const message =
          payload.errors
            .map((error) => error.message)
            .filter((value): value is string => Boolean(value))
            .join("; ") || "Archive returned an unknown GraphQL error";
        throw new Error(message);
      }
      if (!payload.data) {
        throw new Error("Archive response did not include data");
      }
      return payload.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async getMaxBlockHeights(): Promise<ArchiveMaxHeights> {
    const data = await this.post<NetworkStateResponse>(NETWORK_STATE_QUERY);
    const maxBlockHeight = data.networkState?.maxBlockHeight;
    const canonical = maxBlockHeight?.canonicalMaxBlockHeight;
    const pending = maxBlockHeight?.pendingMaxBlockHeight;

    if (
      !Number.isFinite(canonical) ||
      canonical === null ||
      !Number.isFinite(pending) ||
      pending === null
    ) {
      throw new Error(
        "Archive networkState.maxBlockHeight is missing canonical/pending heights",
      );
    }

    return {
      canonicalMaxBlockHeight: canonical,
      pendingMaxBlockHeight: pending,
    };
  }

  public async fetchEvents(options: FetchEventsOptions): Promise<ArchiveEventOutput[]> {
    const variables = {
      input: {
        address: this.config.treasuryOwnerContractAddress,
        // TreasuryOwner events are emitted by the owner account update under
        // Mina's default token. Proposal child account actions use the derived
        // token id, but those are fetched by the separate SDK/proof pipeline.
        tokenId: ARCHIVE_DEFAULT_TOKEN_ID,
        status: options.status,
        from: options.from,
        // The archive treats `to` as EXCLUSIVE. Passing our inclusive upper
        // bound straight through silently dropped every event in the last block
        // of each batch, and the cursor then advanced past it. Verified against
        // archive-node-api on devnet with an event at block 546331:
        //
        //   from=546320 to=546331 -> 0 events
        //   from=546320 to=546332 -> 1 event
        //
        // The pendingOverlapBlocks rescan hid this, because the block stopped
        // being last on a later pass - but only after a delay, and not at all
        // with an overlap of 0. Requesting one past our bound is also correct if
        // the archive is ever inclusive: the extra block is simply upserted, and
        // the cursor is still set from our own `to`.
        to: options.to + 1,
      },
    };

    let data: EventsResponse;
    if (this.supportsBlockTimestamp === false) {
      data = await this.post<EventsResponse>(EVENTS_QUERY_FALLBACK, variables);
    } else {
      try {
        data = await this.post<EventsResponse>(EVENTS_QUERY, variables);
        this.supportsBlockTimestamp = true;
      } catch (error) {
        if (
          this.supportsBlockTimestamp !== true &&
          this.isMissingBlockTimestampFieldError(error)
        ) {
          this.supportsBlockTimestamp = false;
          data = await this.post<EventsResponse>(EVENTS_QUERY_FALLBACK, variables);
        } else {
          throw error;
        }
      }
    }
    return data.events ?? [];
  }

  private isMissingBlockTimestampFieldError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return /Cannot query field ["']timestamp["']/i.test(error.message);
  }
}
