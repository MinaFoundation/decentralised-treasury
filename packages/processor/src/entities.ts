import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type ProcessorEventFailureState =
  | "retrying"
  | "blocked"
  | "resolved"
  | "superseded";

export type ProcessorLifecycleState =
  | "starting"
  | "running"
  | "idle"
  | "degraded"
  | "blocked"
  | "stopping"
  | "stopped";

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

  @Column({
    type: "bigint",
    name: "last_seen_change_sequence",
    transformer: {
      to: (value: string) => value,
      from: (value: string | number) => String(value),
    },
  })
  lastSeenChangeSequence!: string;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}

@Entity({ name: "processor_event_failures" })
@Check("CK_processor_event_failures_attempt_count", '"attempt_count" >= 0')
@Index("ix_processor_event_failures_processor_state_failed_at", [
  "processorName",
  "state",
  "lastFailedAt",
])
export class ProcessorEventFailureEntity {
  @PrimaryColumn({
    type: "text",
    name: "processor_name",
  })
  processorName!: string;

  @PrimaryColumn({
    type: "bigint",
    name: "archive_event_id",
    transformer: {
      to: (value: string) => value,
      from: (value: string | number) => String(value),
    },
  })
  archiveEventId!: string;

  @PrimaryColumn({
    type: "bigint",
    name: "change_sequence",
    transformer: {
      to: (value: string) => value,
      from: (value: string | number) => String(value),
    },
  })
  changeSequence!: string;

  @Column({
    type: "text",
  })
  state!: ProcessorEventFailureState;

  @Column({
    type: "integer",
    name: "attempt_count",
  })
  attemptCount!: number;

  @Column({
    type: "timestamptz",
    name: "retry_after",
    nullable: true,
  })
  retryAfter!: Date | null;

  @Column({
    type: "text",
    name: "error_code",
  })
  errorCode!: string;

  @Column({
    type: "text",
    name: "bounded_error_message",
  })
  boundedErrorMessage!: string;

  @Column({
    type: "jsonb",
    name: "event_snapshot",
  })
  eventSnapshot!: Record<string, unknown>;

  @CreateDateColumn({
    type: "timestamptz",
    name: "first_failed_at",
  })
  firstFailedAt!: Date;

  @Column({
    type: "timestamptz",
    name: "last_failed_at",
  })
  lastFailedAt!: Date;

  @Column({
    type: "timestamptz",
    name: "resolved_at",
    nullable: true,
  })
  resolvedAt!: Date | null;
}

@Entity({ name: "processor_runtime_status" })
export class ProcessorRuntimeStatusEntity {
  @PrimaryColumn({
    type: "text",
    name: "processor_name",
  })
  processorName!: string;

  @Column({
    type: "text",
    name: "lifecycle_state",
  })
  lifecycleState!: ProcessorLifecycleState;

  @Column({
    type: "timestamptz",
    name: "started_at",
    nullable: true,
  })
  startedAt!: Date | null;

  @Column({
    type: "timestamptz",
    name: "heartbeat_at",
  })
  heartbeatAt!: Date;

  @Column({
    type: "timestamptz",
    name: "last_success_at",
    nullable: true,
  })
  lastSuccessAt!: Date | null;

  @Column({
    type: "timestamptz",
    name: "last_error_at",
    nullable: true,
  })
  lastErrorAt!: Date | null;

  @Column({
    type: "text",
    name: "last_error_code",
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({
    type: "text",
    name: "bounded_last_error",
    nullable: true,
  })
  boundedLastError!: string | null;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}
