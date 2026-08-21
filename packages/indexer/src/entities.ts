import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { ArchiveEventData } from "./archive/client.js";

@Entity({ name: "archive_events" })
@Index(
  "ux_archive_events_identity",
  ["txHash", "accountUpdateId", "accountUpdateIndex", "eventIndex"],
  { unique: true },
)
@Index("ix_archive_events_updated_at_id", ["updatedAt", "id"])
@Index("ix_archive_events_event_type_updated_at_id", ["eventType", "updatedAt", "id"])
@Index("ix_archive_events_status_pending_seen_at_height", ["status", "pendingSeenAtHeight"])
export class ArchiveEventEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

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
