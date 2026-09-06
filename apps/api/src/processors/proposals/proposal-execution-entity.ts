import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { Check } from "typeorm";
import { UINT32_NUMBER_TRANSFORMER } from "@repo/indexer";
import { ProposalEntity } from "./proposal-entity.js";

@Entity({ name: "processor_proposal_executions" })
@Index(
  "ux_processor_proposal_executions_archive_event_id",
  ["archiveEventId"],
  {
    unique: true,
  },
)
@Index("ix_processor_proposal_executions_proposal_public_key", [
  "proposalPublicKey",
])
@Check(
  "CK_processor_proposal_executions_lifecycle_id_uint32",
  `"lifecycle_id" BETWEEN 0 AND 4294967295`,
)
export class ProposalExecutionEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

  @Column({
    type: "text",
    name: "archive_event_id",
  })
  archiveEventId!: string;

  @Column({
    type: "text",
    name: "proposal_public_key",
  })
  proposalPublicKey!: string;

  @Column({
    type: "bigint",
    name: "lifecycle_id",
    transformer: UINT32_NUMBER_TRANSFORMER,
  })
  lifecycleId!: number;

  @Column({
    type: "text",
    name: "recipient",
  })
  recipient!: string;

  @Column({
    type: "text",
    name: "amount_to_pay_out",
  })
  amountToPayOut!: string;

  @Column({
    type: "text",
    name: "proposal_amount",
  })
  proposalAmount!: string;

  @Column({
    type: "text",
    name: "bond_amount",
  })
  bondAmount!: string;

  @Column({
    type: "text",
    name: "sender_public_key",
  })
  senderPublicKey!: string;

  @Column({
    type: "text",
    name: "paid_out_amount",
  })
  paidOutAmount!: string;

  @Column({
    type: "text",
    name: "remaining_amount",
  })
  remainingAmount!: string;

  @Column({
    type: "integer",
    name: "block_height",
    nullable: true,
  })
  blockHeight!: number | null;

  @Column({
    type: "integer",
    name: "block_event_index",
    default: 0,
  })
  blockEventIndex!: number;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

  @ManyToOne(() => ProposalEntity, (proposal) => proposal.executions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "proposal_public_key",
    referencedColumnName: "proposalPublicKey",
  })
  proposal!: Relation<ProposalEntity>;

  @CreateDateColumn({
    type: "timestamptz",
    name: "created_at",
  })
  createdAt!: Date;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}
