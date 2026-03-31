import { EVENTS_QUERY, NETWORK_STATE_QUERY } from "./queries.js";

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
    const data = await this.post<EventsResponse>(EVENTS_QUERY, {
      input: {
        address: this.config.treasuryOwnerContractAddress,
        tokenId: this.config.treasuryOwnerTokenId,
        status: options.status,
        from: options.from,
        to: options.to,
      },
    });
    return data.events ?? [];
  }
}
