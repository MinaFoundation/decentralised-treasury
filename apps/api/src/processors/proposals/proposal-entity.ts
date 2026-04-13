import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { VoteTallyEntity } from "./vote-tally-entity.js";

@Entity({ name: "processor_proposals" })
@Index(
  "ux_processor_proposals_proposal_public_key",
  ["proposalPublicKey"],
  { unique: true },
)
export class ProposalEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

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
    name: "amount",
  })
  amount!: string;

  @Column({
    type: "text",
    name: "recipient",
  })
  recipient!: string;

  @Column({
    type: "text",
    name: "sender_public_key",
    nullable: true,
  })
  senderPublicKey!: string | null;

  @Column({
    type: "text",
    name: "zkapp_uri_hash",
  })
  zkAppUriHash!: string;

  @Column({
    type: "text",
    name: "staking_epoch_data_ledger_hash",
    nullable: true,
  })
  stakingEpochDataLedgerHash!: string | null;

  @Column({
    type: "text",
    name: "staking_epoch_data_ledger_total_currency",
    nullable: true,
  })
  stakingEpochDataLedgerTotalCurrency!: string | null;

  @Column({
    type: "text",
    name: "required_participation_bp",
    nullable: true,
  })
  requiredParticipationBp!: string | null;

  @Column({
    type: "text",
    name: "required_approval_bp",
    nullable: true,
  })
  requiredApprovalBp!: string | null;

  @Column({
    type: "text",
    name: "required_participation",
    nullable: true,
  })
  requiredParticipation!: string | null;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

  @Column({
    type: "boolean",
    name: "is_paused",
    default: false,
  })
  isPaused!: boolean;

  @Column({
    type: "text",
    name: "paid_out_amount",
    default: "0",
  })
  paidOutAmount!: string;

  @Column({
    type: "text",
    name: "contents",
    nullable: true,
  })
  contents!: string | null;

  @Column({
    type: "integer",
    name: "created_at_block_height",
    nullable: true,
  })
  createdAtBlockHeight!: number | null;

  @Column({
    type: "timestamptz",
    name: "created_at_block_timestamp",
    nullable: true,
  })
  createdAtBlockTimestamp!: Date | null;

  @OneToMany(() => VoteTallyEntity, (voteTally) => voteTally.proposal)
  voteTallies!: Relation<VoteTallyEntity[]>;

  @OneToMany(() => ProposalExecutionEntity, (execution) => execution.proposal)
  executions!: Relation<ProposalExecutionEntity[]>;

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
