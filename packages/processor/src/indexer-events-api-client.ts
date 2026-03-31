import { ArchiveEventEntity, type ArchiveEventData } from "@repo/indexer";

export interface IndexerEventsApiClientConfig {
  indexerApiUrl: string;
}

export interface FetchIndexerEventsPageInput {
  handledEventTypes: string[];
  updatedAfter: Date;
  eventIdAfter: string;
  limit: number;
}

interface IndexerApiEvent {
  id: string;
  status: string;
  pendingSeenAtHeight: number | null;
  eventType: string;
  txHash: string;
  accountUpdateId: string;
  accountUpdateIndex: number;
  eventIndex: number;
  rawEventData: ArchiveEventData;
  indexedAt: string;
  updatedAt: string;
}

interface IndexerApiEventsResponse {
  items: IndexerApiEvent[];
  nextCursor: {
    updatedAfter: string;
    eventIdAfter: string;
  } | null;
}

export class IndexerEventsApiClient {
  public constructor(private readonly config: IndexerEventsApiClientConfig) {}

  public async fetchEventsPage(
    input: FetchIndexerEventsPageInput,
  ): Promise<ArchiveEventEntity[]> {
    const url = new URL("/v1/indexer/events", this.config.indexerApiUrl);
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("updatedAfter", input.updatedAfter.toISOString());
    url.searchParams.set("eventIdAfter", input.eventIdAfter);
    url.searchParams.set("includeUnknown", "false");
    if (input.handledEventTypes.length) {
      url.searchParams.set("eventTypes", input.handledEventTypes.join(","));
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Indexer API events request failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as IndexerApiEventsResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((item) => this.mapIndexerApiEvent(item));
  }

  private mapIndexerApiEvent(item: IndexerApiEvent): ArchiveEventEntity {
    const event = new ArchiveEventEntity();
    event.id = String(item.id);
    event.status = item.status;
    event.pendingSeenAtHeight = item.pendingSeenAtHeight;
    event.eventType = item.eventType;
    event.txHash = item.txHash;
    event.accountUpdateId = item.accountUpdateId;
    event.accountUpdateIndex = item.accountUpdateIndex;
    event.eventIndex = item.eventIndex;
    event.rawEventData = item.rawEventData;
    event.indexedAt = new Date(item.indexedAt);
    event.updatedAt = new Date(item.updatedAt);
    return event;
  }
}
