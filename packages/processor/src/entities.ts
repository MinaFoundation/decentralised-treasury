import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "processor_offsets" })
export class ProcessorOffsetEntity {
  @PrimaryColumn({
    type: "text",
    name: "processor_name",
  })
  processorName!: string;

  // Real column is timestamptz(3), set by migration; see the note on
  // ArchiveEventEntity.updatedAt for why it is not declared here.
  @Column({
    type: "timestamptz",
    name: "last_seen_updated_at",
  })
  lastSeenUpdatedAt!: Date;

  @Column({
    type: "bigint",
    name: "last_seen_event_id",
    transformer: {
      to: (value: string) => value,
      from: (value: string | number) => String(value),
    },
  })
  lastSeenEventId!: string;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}
