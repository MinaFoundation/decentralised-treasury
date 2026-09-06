import { Check, Column, Entity, Index, PrimaryColumn } from "typeorm";
import { UINT32_NUMBER_TRANSFORMER } from "@repo/indexer";

@Entity({ name: "processor_proposal_event_facts" })
@Index("ix_processor_proposal_event_facts_proposal_source_order", [
  "proposalPublicKey",
  "blockHeight",
  "blockEventIndex",
  "archiveEventId",
])
@Index("ix_processor_proposal_event_facts_state_hash", ["stateHash"])
@Check(
  "CK_processor_proposal_facts_global_slot_uint32",
  `"global_slot_since_genesis" IS NULL OR "global_slot_since_genesis" BETWEEN 0 AND 4294967295`,
)
export class ProposalEventFactEntity {
  @PrimaryColumn({
    type: "text",
    name: "archive_event_id",
  })
  archiveEventId!: string;

  @Column({
    type: "bigint",
    name: "change_sequence",
  })
  changeSequence!: string;

  @Column({
    type: "text",
    name: "event_type",
  })
  eventType!: string;

  @Column({
    type: "text",
    name: "proposal_public_key",
  })
  proposalPublicKey!: string;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

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
    type: "integer",
    name: "block_event_index",
  })
  blockEventIndex!: number;

  @Column({
    type: "text",
    name: "tx_hash",
  })
  txHash!: string;

  @Column({
    type: "jsonb",
    name: "decoded_payload",
  })
  decodedPayload!: Record<string, unknown>;

  @Column({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}
