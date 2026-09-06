import { ArchiveEventEntity, type ArchiveEventData } from "@repo/indexer";

const DECIMAL_BIGINT_PATTERN = /^(0|[1-9]\d*)$/;
const INDEXER_EVENT_STATUSES = ["pending", "canonical", "orphaned"] as const;

type IndexerEventStatus = (typeof INDEXER_EVENT_STATUSES)[number];

export interface IndexerEventsApiClientConfig {
  indexerApiUrl: string;
}

export interface FetchIndexerEventsPageInput {
  handledEventTypes: string[];
  changeSequenceAfter: string;
  limit: number;
}

export type SequencedArchiveEvent = ArchiveEventEntity & {
  changeSequence: string;
};

export interface IndexerEventsPage {
  items: SequencedArchiveEvent[];
  nextCursor: { changeSequenceAfter: string } | null;
}

export interface IndexerEventsSource {
  fetchEventsPage(
    input: FetchIndexerEventsPageInput,
  ): Promise<IndexerEventsPage>;
}

export class IndexerEventsApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IndexerEventsApiError";
  }
}

interface IndexerApiEvent {
  id: string;
  changeSequence: string;
  status: IndexerEventStatus;
  pendingSeenAtHeight: number | null;
  blockHeight: number | null;
  blockTimestamp: string | null;
  globalSlotSinceGenesis: number | null;
  stateHash: string | null;
  parentHash: string | null;
  chainStatus: string | null;
  eventType: string;
  txHash: string;
  accountUpdateId: string;
  accountUpdateIndex: number;
  eventIndex: number;
  blockEventIndex: number;
  rawEventData: ArchiveEventData;
  indexedAt: string;
  updatedAt: string;
}

interface IndexerApiEventsResponse {
  items: IndexerApiEvent[];
  nextCursor: {
    changeSequenceAfter: string;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeBigIntString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_BIGINT_PATTERN.test(value);
}

function requireBigIntString(value: unknown, field: string): string {
  if (isNonNegativeBigIntString(value)) {
    return value;
  }
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return String(value);
  }
  throw contractError(`${field} must be a nonnegative bigint value`);
}

function contractError(message: string): IndexerEventsApiError {
  return new IndexerEventsApiError(
    "INDEXER_RESPONSE_CONTRACT_INVALID",
    `Indexer API response is invalid: ${message}`,
  );
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw contractError(`${field} must be a string`);
  }
  return value;
}

function requireEventStatus(value: unknown, field: string): IndexerEventStatus {
  if (
    typeof value !== "string" ||
    !INDEXER_EVENT_STATUSES.includes(value as IndexerEventStatus)
  ) {
    throw contractError(
      `${field} must be one of: ${INDEXER_EVENT_STATUSES.join(", ")}`,
    );
  }
  return value as IndexerEventStatus;
}

function requireInteger(
  record: Record<string, unknown>,
  field: string,
): number {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw contractError(`${field} must be a nonnegative safe integer`);
  }
  return value as number;
}

function requireNullableInteger(
  record: Record<string, unknown>,
  field: string,
): number | null {
  if (record[field] === null) {
    return null;
  }
  return requireInteger(record, field);
}

function requireNullableNonemptyString(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field];
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw contractError(`${field} must be a nonempty trimmed string or null`);
  }
  return value;
}

function requireIsoDateString(
  record: Record<string, unknown>,
  field: string,
  nullable = false,
): string | null {
  const value = record[field];
  if (nullable && value === null) {
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw contractError(`${field} must be a valid ISO date string`);
  }
  return value;
}

function validateOptionalString(
  record: Record<string, unknown>,
  field: string,
): void {
  const value = record[field];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw contractError(`rawEventData.${field} must be a string or null`);
  }
}

function validateRawEventData(value: unknown): ArchiveEventData {
  if (!isRecord(value)) {
    throw contractError("rawEventData must be an object");
  }
  for (const field of [
    "accountUpdateId",
    "eventType",
    "eventName",
    "name",
    "type",
  ]) {
    validateOptionalString(value, field);
  }

  const data = value.data;
  if (
    data !== undefined &&
    data !== null &&
    (!Array.isArray(data) || data.some((entry) => typeof entry !== "string"))
  ) {
    throw contractError(
      "rawEventData.data must be an array of strings or null",
    );
  }

  const transactionInfo = value.transactionInfo;
  if (transactionInfo !== undefined && transactionInfo !== null) {
    if (!isRecord(transactionInfo)) {
      throw contractError(
        "rawEventData.transactionInfo must be an object or null",
      );
    }
    validateOptionalString(transactionInfo, "hash");
    const sequenceNumber = transactionInfo.sequenceNumber;
    if (
      sequenceNumber !== undefined &&
      sequenceNumber !== null &&
      (!Number.isSafeInteger(sequenceNumber) || (sequenceNumber as number) < 0)
    ) {
      throw contractError(
        "rawEventData.transactionInfo.sequenceNumber must be a nonnegative safe integer or null",
      );
    }
    const ids = transactionInfo.zkappAccountUpdateIds;
    if (
      ids !== undefined &&
      ids !== null &&
      (!Array.isArray(ids) || ids.some((entry) => !Number.isSafeInteger(entry)))
    ) {
      throw contractError(
        "rawEventData.transactionInfo.zkappAccountUpdateIds must be an array of safe integers or null",
      );
    }
  }

  return value as ArchiveEventData;
}

function validateEvent(value: unknown, index: number): IndexerApiEvent {
  if (!isRecord(value)) {
    throw contractError(`items[${index}] must be an object`);
  }

  const id = requireBigIntString(value.id, `items[${index}].id`);
  const changeSequence = value.changeSequence;
  if (!isNonNegativeBigIntString(changeSequence)) {
    throw contractError(
      `items[${index}].changeSequence must be a nonnegative bigint string`,
    );
  }

  return {
    id,
    changeSequence,
    status: requireEventStatus(value.status, `items[${index}].status`),
    pendingSeenAtHeight: requireNullableInteger(value, "pendingSeenAtHeight"),
    blockHeight: requireNullableInteger(value, "blockHeight"),
    blockTimestamp: requireIsoDateString(value, "blockTimestamp", true),
    globalSlotSinceGenesis: requireNullableInteger(
      value,
      "globalSlotSinceGenesis",
    ),
    stateHash: requireNullableNonemptyString(value, "stateHash"),
    parentHash: requireNullableNonemptyString(value, "parentHash"),
    chainStatus: requireNullableNonemptyString(value, "chainStatus"),
    eventType: requireString(value, "eventType"),
    txHash: requireString(value, "txHash"),
    accountUpdateId: requireString(value, "accountUpdateId"),
    accountUpdateIndex: requireInteger(value, "accountUpdateIndex"),
    eventIndex: requireInteger(value, "eventIndex"),
    blockEventIndex: requireInteger(value, "blockEventIndex"),
    rawEventData: validateRawEventData(value.rawEventData),
    indexedAt: requireIsoDateString(value, "indexedAt") as string,
    updatedAt: requireIsoDateString(value, "updatedAt") as string,
  };
}

function validateResponse(
  value: unknown,
  changeSequenceAfter: string,
): IndexerApiEventsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw contractError("the response must contain an items array");
  }

  const items = value.items.map(validateEvent);
  let previousSequence = BigInt(changeSequenceAfter);
  for (const [index, item] of items.entries()) {
    const sequence = BigInt(item.changeSequence);
    if (sequence <= previousSequence) {
      throw contractError(
        `items[${index}].changeSequence must be strictly increasing and greater than the request cursor`,
      );
    }
    previousSequence = sequence;
  }

  const cursorValue = value.nextCursor;
  let nextCursor: IndexerApiEventsResponse["nextCursor"];
  if (cursorValue === null) {
    nextCursor = null;
  } else if (
    isRecord(cursorValue) &&
    isNonNegativeBigIntString(cursorValue.changeSequenceAfter)
  ) {
    nextCursor = { changeSequenceAfter: cursorValue.changeSequenceAfter };
  } else {
    throw contractError(
      "nextCursor must be null or contain a nonnegative bigint changeSequenceAfter string",
    );
  }

  const lastItem = items.at(-1);
  if (lastItem && nextCursor?.changeSequenceAfter !== lastItem.changeSequence) {
    throw contractError("nextCursor must equal the last item changeSequence");
  }
  if (!lastItem && nextCursor !== null) {
    throw contractError("nextCursor must be null for an empty page");
  }

  return { items, nextCursor };
}

export class IndexerEventsApiClient implements IndexerEventsSource {
  public constructor(private readonly config: IndexerEventsApiClientConfig) {}

  public async fetchEventsPage(
    input: FetchIndexerEventsPageInput,
  ): Promise<IndexerEventsPage> {
    if (!isNonNegativeBigIntString(input.changeSequenceAfter)) {
      throw new TypeError(
        "changeSequenceAfter must be a nonnegative bigint string",
      );
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new TypeError("limit must be a positive safe integer");
    }

    const url = new URL("/events", this.config.indexerApiUrl);
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("changeSequenceAfter", input.changeSequenceAfter);
    url.searchParams.set("includeUnknown", "false");
    if (input.handledEventTypes.length) {
      url.searchParams.set("eventTypes", input.handledEventTypes.join(","));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });
    } catch (error) {
      throw new IndexerEventsApiError(
        "INDEXER_REQUEST_FAILED",
        `Indexer API events request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new IndexerEventsApiError(
        "INDEXER_HTTP_ERROR",
        `Indexer API events request failed: ${response.status} ${response.statusText}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new IndexerEventsApiError(
        "INDEXER_RESPONSE_CONTRACT_INVALID",
        `Indexer API response is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const validated = validateResponse(payload, input.changeSequenceAfter);
    return {
      items: validated.items.map((item) => this.mapIndexerApiEvent(item)),
      nextCursor: validated.nextCursor,
    };
  }

  private mapIndexerApiEvent(item: IndexerApiEvent): SequencedArchiveEvent {
    const event = new ArchiveEventEntity() as SequencedArchiveEvent;
    event.id = item.id;
    event.changeSequence = item.changeSequence;
    event.status = item.status;
    event.pendingSeenAtHeight = item.pendingSeenAtHeight;
    event.blockHeight = item.blockHeight;
    event.blockTimestamp = item.blockTimestamp
      ? new Date(item.blockTimestamp)
      : null;
    event.globalSlotSinceGenesis = item.globalSlotSinceGenesis;
    event.stateHash = item.stateHash;
    event.parentHash = item.parentHash;
    event.chainStatus = item.chainStatus;
    event.eventType = item.eventType;
    event.txHash = item.txHash;
    event.accountUpdateId = item.accountUpdateId;
    event.accountUpdateIndex = item.accountUpdateIndex;
    event.eventIndex = item.eventIndex;
    event.blockEventIndex = item.blockEventIndex;
    event.rawEventData = item.rawEventData;
    event.indexedAt = new Date(item.indexedAt);
    event.updatedAt = new Date(item.updatedAt);
    return event;
  }
}
