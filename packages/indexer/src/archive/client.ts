import {
  EVENTS_QUERY,
  EVENTS_QUERY_FALLBACK,
  NETWORK_STATE_QUERY,
} from "./queries.js";

const ARCHIVE_DEFAULT_TOKEN_ID = "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf";

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
  treasuryOwnerTokenId: string;
  archiveRequestTimeoutMs: number;
}

export class ArchiveClient {
  private supportsBlockTimestamp: boolean | null = null;
  private readonly normalizedTreasuryOwnerTokenId: string;

  public constructor(
    private readonly archiveNodeUrl: string,
    private readonly config: ArchiveClientConfig,
  ) {
    this.normalizedTreasuryOwnerTokenId = normalizeArchiveTokenId(
      config.treasuryOwnerTokenId,
    );
  }

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
        tokenId: this.normalizedTreasuryOwnerTokenId,
        status: options.status,
        from: options.from,
        to: options.to,
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

function normalizeArchiveTokenId(tokenId: string): string {
  return tokenId === "1" ? ARCHIVE_DEFAULT_TOKEN_ID : tokenId;
}
