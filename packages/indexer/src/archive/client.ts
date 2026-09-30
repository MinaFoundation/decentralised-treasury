import {
  BLOCKS_QUERY,
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
    sequenceNumber?: number | null;
    zkappAccountUpdateIds?: number[] | null;
  } | null;
}

export interface ArchiveBlockInfo {
  height: number;
  timestamp?: string | null;
  globalSlotSinceGenesis?: number | null;
  stateHash?: string | null;
  parentHash?: string | null;
  chainStatus?: string | null;
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

export interface ArchiveChainBlock {
  blockHeight: number;
  stateHash: string;
  parentHash: string;
}

export interface PendingArchiveSnapshot {
  events: ArchiveEventOutput[];
  height: number;
  ambiguous: boolean;
  ancestry: ArchiveChainBlock[];
}

/** Select one maximum-height tip and follow every parent to the canonical anchor. */
export function selectPendingChain(
  blocks: ArchiveChainBlock[],
  anchor: ArchiveChainBlock,
  height: number,
): ArchiveChainBlock[] {
  const byHash = new Map(blocks.map((block) => [block.stateHash, block]));
  const tips = blocks.filter((block) => block.blockHeight === height);
  if (tips.length !== 1)
    throw new Error("Archive selected tip is missing or ambiguous");
  const tip = tips[0]!;
  const chain: ArchiveChainBlock[] = [];
  let current = tip;
  while (current.blockHeight > anchor.blockHeight) {
    if (!current.stateHash || !current.parentHash) {
      throw new Error(
        "Archive ancestry is missing; enable ENABLE_BLOCK_TRANSACTION_DETAILS",
      );
    }
    chain.push(current);
    const parent =
      current.parentHash === anchor.stateHash
        ? anchor
        : byHash.get(current.parentHash);
    if (!parent || parent.blockHeight !== current.blockHeight - 1) {
      throw new Error("Archive pending ancestry is incomplete");
    }
    current = parent;
  }
  if (current.stateHash !== anchor.stateHash)
    throw new Error("Archive pending branch does not reach canonical anchor");
  return chain.reverse();
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
  ) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(archiveNodeUrl);
    } catch {
      throw new Error("archiveNodeUrl must be a valid absolute URL");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("archiveNodeUrl must use http or https");
    }
    if (
      typeof config.treasuryOwnerContractAddress !== "string" ||
      !config.treasuryOwnerContractAddress ||
      config.treasuryOwnerContractAddress.trim() !==
        config.treasuryOwnerContractAddress
    ) {
      throw new Error(
        "treasuryOwnerContractAddress must be a nonempty trimmed string",
      );
    }
    if (
      !Number.isSafeInteger(config.archiveRequestTimeoutMs) ||
      config.archiveRequestTimeoutMs <= 0
    ) {
      throw new Error(
        "archiveRequestTimeoutMs must be a positive safe integer",
      );
    }
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
      !Number.isSafeInteger(canonical) ||
      canonical === null ||
      canonical < 0 ||
      !Number.isSafeInteger(pending) ||
      pending === null ||
      pending < 0
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

  private async fetchBlocks(
    from: number,
    to: number,
    canonical?: boolean,
  ): Promise<ArchiveChainBlock[]> {
    const data = await this.post<{ blocks: ArchiveChainBlock[] }>(
      BLOCKS_QUERY,
      {
        query: {
          blockHeight_gte: from,
          blockHeight_lt: to + 1,
          inBestChain: true,
          ...(canonical === undefined ? {} : { canonical }),
        },
        limit: 1000,
      },
    );
    if (
      !Array.isArray(data.blocks) ||
      data.blocks.length >= 1000 ||
      data.blocks.some(
        (block) =>
          !block ||
          !Number.isSafeInteger(block.blockHeight) ||
          block.blockHeight < from ||
          block.blockHeight > to ||
          typeof block.stateHash !== "string" ||
          !block.stateHash ||
          typeof block.parentHash !== "string",
      )
    ) {
      throw new Error("Archive blocks response is invalid or truncated");
    }
    return data.blocks;
  }

  public async fetchPendingSnapshot(
    batchSize: number,
  ): Promise<PendingArchiveSnapshot> {
    const heights = await this.getMaxBlockHeights();
    const canonical = heights.canonicalMaxBlockHeight;
    const height = Math.max(canonical, heights.pendingMaxBlockHeight);
    const anchors = await this.fetchBlocks(canonical, canonical, true);
    if (anchors.length !== 1)
      throw new Error("Archive canonical anchor is missing or ambiguous");
    const anchor = anchors[0]!;
    const blocks: ArchiveChainBlock[] = [anchor];
    for (let from = canonical + 1; from <= height; from += 100) {
      blocks.push(
        ...(await this.fetchBlocks(from, Math.min(from + 99, height))),
      );
    }
    const competingTips = blocks.filter(
      (block) => block.blockHeight === height,
    );
    if (competingTips.length === 0)
      throw new Error("Archive selected tip is missing");
    // Archive 0.0.9 filters event tips independently and cannot pin events to a
    // chosen hash. Publish only canonical data until a unique tip is available.
    const chain =
      competingTips.length === 1
        ? selectPendingChain(blocks, anchor, height)
        : [];
    const observedTips = competingTips
      .map((block) => block.stateHash)
      .sort()
      .join(",");
    const selected = new Map(chain.map((block) => [block.stateHash, block]));
    const events: ArchiveEventOutput[] = [];
    for (
      let from = canonical + 1;
      chain.length && from <= height;
      from += batchSize
    ) {
      const rows = await this.fetchEvents({
        status: "PENDING",
        from,
        to: Math.min(from + batchSize - 1, height),
      });
      for (const row of rows) {
        if (!row.blockInfo?.stateHash)
          throw new Error("Archive pending event has no block identity");
        const block = selected.get(row.blockInfo.stateHash);
        if (!block) continue;
        if (
          row.blockInfo.height !== block.blockHeight ||
          row.blockInfo.parentHash !== block.parentHash
        ) {
          throw new Error("Archive event differs from selected ancestry");
        }
        events.push(row);
      }
    }
    // All event pages must describe the same selected tip and canonical anchor.
    const after = await this.getMaxBlockHeights();
    const tips = await this.fetchBlocks(height, height);
    tips.sort((a, b) =>
      a.stateHash < b.stateHash ? -1 : a.stateHash > b.stateHash ? 1 : 0,
    );
    const anchorsAfter = await this.fetchBlocks(canonical, canonical, true);
    if (
      after.canonicalMaxBlockHeight !== canonical ||
      Math.max(after.pendingMaxBlockHeight, canonical) !== height ||
      tips
        .map((block) => block.stateHash)
        .sort()
        .join(",") !== observedTips ||
      anchorsAfter[0]?.stateHash !== anchor.stateHash
    ) {
      throw new Error("Archive branch changed during pending snapshot");
    }
    return {
      events,
      height,
      ambiguous: competingTips.length > 1,
      ancestry: [anchor, ...chain],
    };
  }

  public async fetchEvents(
    options: FetchEventsOptions,
  ): Promise<ArchiveEventOutput[]> {
    if (options.status !== "PENDING" && options.status !== "CANONICAL") {
      throw new Error("status must be PENDING or CANONICAL");
    }
    if (!Number.isSafeInteger(options.from) || options.from < 0) {
      throw new Error("from must be a nonnegative safe integer");
    }
    if (!Number.isSafeInteger(options.to) || options.to < options.from) {
      throw new Error(
        "to must be a safe integer greater than or equal to from",
      );
    }
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
        // with an overlap of 0. The endpoint must preserve this exclusive bound:
        // repository ingestion rejects observations outside our complete range.
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
          data = await this.post<EventsResponse>(
            EVENTS_QUERY_FALLBACK,
            variables,
          );
        } else {
          throw error;
        }
      }
    }
    if (!Array.isArray(data.events)) {
      throw new Error("Archive events response must include an events array");
    }
    return data.events;
  }

  private isMissingBlockTimestampFieldError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return /Cannot query field ["']timestamp["']/i.test(error.message);
  }
}
