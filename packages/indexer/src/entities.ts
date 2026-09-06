import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { ValueTransformer } from "typeorm";
import type { ArchiveEventData } from "./archive/client.js";

const BIGINT_STRING_TRANSFORMER: ValueTransformer = {
  to: (value: string) => value,
  from: (value: unknown) => String(value),
};

export const MAX_UINT32_NUMBER = 4_294_967_295;

function toUInt32Number(value: unknown): number {
  const parsed =
    typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
          ? BigInt(value)
          : null;
  if (parsed === null || parsed < 0n || parsed > BigInt(MAX_UINT32_NUMBER)) {
    throw new TypeError("UInt32 column value must be in the UInt32 range");
  }
  return Number(parsed);
}

export const UINT32_NUMBER_TRANSFORMER: ValueTransformer = {
  to: (value: unknown) =>
    value === null || value === undefined
      ? value
      : toUInt32Number(value).toString(),
  from: (value: unknown) =>
    value === null || value === undefined ? value : toUInt32Number(value),
};

@Entity({ name: "archive_events" })
@Index(
  "ux_archive_events_identity",
  ["txHash", "accountUpdateId", "accountUpdateIndex", "eventIndex"],
  { unique: true },
)
@Index("ix_archive_events_updated_at_id", ["updatedAt", "id"])
@Index("ux_archive_events_change_sequence", ["changeSequence"], {
  unique: true,
})
@Index("ix_archive_events_event_type_updated_at_id", [
  "eventType",
  "updatedAt",
  "id",
])
@Index("ix_archive_events_event_type_change_sequence", [
  "eventType",
  "changeSequence",
])
@Index("ix_archive_events_status_pending_seen_at_height", [
  "status",
  "pendingSeenAtHeight",
])
@Index("ix_archive_events_state_hash", ["stateHash"])
@Check(
  "CK_archive_events_global_slot_since_genesis_uint32",
  `"global_slot_since_genesis" IS NULL OR "global_slot_since_genesis" BETWEEN 0 AND 4294967295`,
)
export class ArchiveEventEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

  @Column({
    type: "bigint",
    name: "change_sequence",
    default: () => "nextval('archive_event_change_sequence_seq')",
    transformer: BIGINT_STRING_TRANSFORMER,
  })
  changeSequence!: string;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

  @Column({
    type: "integer",
    name: "pending_seen_at_height",
    nullable: true,
  })
  pendingSeenAtHeight!: number | null;

  @Column({
    type: "integer",
    name: "block_height",
    nullable: true,
  })
  blockHeight!: number | null;

  @Column({
    type: "timestamptz",
    name: "block_timestamp",
    nullable: true,
  })
  blockTimestamp!: Date | null;

  @Column({
    type: "bigint",
    name: "global_slot_since_genesis",
    nullable: true,
    transformer: UINT32_NUMBER_TRANSFORMER,
  })
  globalSlotSinceGenesis!: number | null;

  @Column({
    type: "text",
    name: "state_hash",
    nullable: true,
  })
  stateHash!: string | null;

  @Column({
    type: "text",
    name: "parent_hash",
    nullable: true,
  })
  parentHash!: string | null;

  @Column({
    type: "text",
    name: "chain_status",
    nullable: true,
  })
  chainStatus!: string | null;

  @Column({
    type: "text",
    name: "event_type",
  })
  eventType!: string;

  @Column({
    type: "text",
    name: "tx_hash",
  })
  txHash!: string;

  @Column({
    type: "text",
    name: "account_update_id",
  })
  accountUpdateId!: string;

  @Column({
    type: "integer",
    name: "account_update_index",
  })
  accountUpdateIndex!: number;

  @Column({
    type: "integer",
    name: "event_index",
  })
  eventIndex!: number;

  @Column({
    type: "integer",
    name: "block_event_index",
  })
  blockEventIndex!: number;

  @Column({
    type: "jsonb",
    name: "raw_event_data",
  })
  rawEventData!: ArchiveEventData;

  @CreateDateColumn({
    type: "timestamptz",
    name: "indexed_at",
  })
  indexedAt!: Date;

  // NOTE: the real column is timestamptz(3) - see the
  // cursor-timestamp-millisecond-precision migration, which is the source of
  // truth here (synchronize is off). The precision is deliberately not declared
  // on the decorator because the unit tests build their schema from the entities
  // against pg-mem, which cannot express a precision on timestamptz.
  //
  // Millisecond precision on purpose. Postgres timestamptz defaults to
  // microseconds, which a JavaScript Date cannot represent: the processor reads
  // this value, truncates it to milliseconds on the way through Date, and sends
  // it back as its keyset cursor. `updated_at > cursor` was then true for the
  // very row the cursor pointed at, so that event was refetched and reprocessed
  // on every poll, forever. Matching the column to what the client can express
  // makes the comparison exact.
  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}

@Entity({ name: "indexer_cursors" })
export class IndexerCursorEntity {
  @PrimaryColumn({
    type: "text",
    name: "cursor_name",
  })
  cursorName!: string;

  @Column({
    type: "integer",
    name: "last_processed_block_height",
  })
  lastProcessedBlockHeight!: number;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}

@Entity({ name: "archive_event_rejections" })
@Index(
  "ux_archive_event_rejections_observation",
  ["archiveStatus", "observationHash"],
  { unique: true },
)
@Index("ix_archive_event_rejections_last_seen_at", ["lastSeenAt"])
@Index("ix_archive_event_rejections_resolution_status", ["resolutionStatus"])
@Check(
  "CK_archive_event_rejections_resolution_status",
  `"resolution_status" IN ('unresolved', 'resolved')`,
)
export class ArchiveEventRejectionEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

  @Column({
    type: "text",
    name: "archive_status",
  })
  archiveStatus!: string;

  @Column({
    type: "integer",
    name: "block_height",
    nullable: true,
  })
  blockHeight!: number | null;

  @Column({
    type: "integer",
    name: "block_event_index",
    nullable: true,
  })
  blockEventIndex!: number | null;

  @Column({
    type: "text",
    name: "reason_code",
  })
  reasonCode!: string;

  @Column({
    type: "text",
    name: "reason",
  })
  reason!: string;

  @Column({
    type: "text",
    name: "observation_hash",
  })
  observationHash!: string;

  @Column({
    type: "jsonb",
    name: "raw_observation",
  })
  rawObservation!: unknown;

  @Column({
    type: "text",
    name: "resolution_status",
    default: "unresolved",
  })
  resolutionStatus!: "unresolved" | "resolved";

  @Column({
    type: "timestamptz",
    name: "resolved_at",
    nullable: true,
  })
  resolvedAt!: Date | null;

  @Column({
    type: "integer",
    name: "occurrence_count",
    default: 1,
  })
  occurrenceCount!: number;

  @CreateDateColumn({
    type: "timestamptz",
    name: "first_seen_at",
  })
  firstSeenAt!: Date;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "last_seen_at",
  })
  lastSeenAt!: Date;
}

export type IndexerRuntimeState = "idle" | "running" | "succeeded" | "failed";

@Entity({ name: "indexer_runtime_status" })
@Check(
  "CK_indexer_runtime_status_state",
  `"state" IN ('idle', 'running', 'succeeded', 'failed')`,
)
export class IndexerRuntimeStatusEntity {
  @PrimaryColumn({
    type: "text",
    name: "operation_name",
  })
  operationName!: string;

  @Column({
    type: "text",
    name: "state",
  })
  state!: IndexerRuntimeState;

  @Column({
    type: "timestamptz",
    name: "last_started_at",
    nullable: true,
  })
  lastStartedAt!: Date | null;

  @Column({
    type: "timestamptz",
    name: "last_succeeded_at",
    nullable: true,
  })
  lastSucceededAt!: Date | null;

  @Column({
    type: "timestamptz",
    name: "last_failed_at",
    nullable: true,
  })
  lastFailedAt!: Date | null;

  @Column({
    type: "text",
    name: "last_error",
    nullable: true,
  })
  lastError!: string | null;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}
