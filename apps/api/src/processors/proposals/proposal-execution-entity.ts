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
import { ProposalEntity } from "./proposal-entity.js";

@Entity({ name: "processor_proposal_executions" })
@Index("ux_processor_proposal_executions_archive_event_id", ["archiveEventId"], {
  unique: true,
})
@Index("ix_processor_proposal_executions_proposal_public_key", ["proposalPublicKey"])
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
    type: "integer",
    name: "lifecycle_id",
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
