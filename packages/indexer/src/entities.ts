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
