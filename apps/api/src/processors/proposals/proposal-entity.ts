import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { UINT32_NUMBER_TRANSFORMER } from "@repo/indexer";
import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { VoteEntity } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";
import { VoteTallyEntity } from "./vote-tally-entity.js";

export const PROPOSAL_CONTRACT_STATUSES = [
  "unknown",
  "approved",
  "rejected",
  "paused",
] as const;

export type ProposalContractStatus =
  (typeof PROPOSAL_CONTRACT_STATUSES)[number];

export type ProposalContractStatusFinality = "pending" | "canonical";

@Entity({ name: "processor_proposals" })
@Index("ux_processor_proposals_proposal_public_key", ["proposalPublicKey"], {
  unique: true,
})
@Check(
  "CK_processor_proposals_contract_status",
  `"contract_status" IN ('unknown', 'approved', 'rejected', 'paused')`,
)
@Check(
  "CK_processor_proposals_contract_status_finality",
  `"contract_status_finality" IN ('pending', 'canonical')`,
)
@Check(
  "CK_processor_proposals_creation_observation_status",
  `"creation_observation_status" IN ('pending', 'canonical', 'orphaned')`,
)
@Check(
  "CK_processor_proposals_lifecycle_id_uint32",
  `"lifecycle_id" BETWEEN 0 AND 4294967295`,
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
    type: "bigint",
    name: "lifecycle_id",
    transformer: UINT32_NUMBER_TRANSFORMER,
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

  /**
   * Contract status reconstructed from active proposal events. `status`
   * remains the creation-event observation status for API compatibility.
   */
  @Column({
    type: "text",
    name: "contract_status",
    default: "unknown",
  })
  contractStatus!: ProposalContractStatus;

  @Column({
    type: "text",
    name: "contract_status_finality",
    default: "pending",
  })
  contractStatusFinality!: ProposalContractStatusFinality;

  @Column({
    type: "text",
    name: "contract_status_source_event_id",
    nullable: true,
  })
  contractStatusSourceEventId!: string | null;

  @Column({
    type: "integer",
    name: "contract_status_block_height",
    nullable: true,
  })
  contractStatusBlockHeight!: number | null;

  @Column({
    type: "text",
    name: "creation_observation_status",
    default: "pending",
  })
  creationObservationStatus!: string;

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

  @OneToMany(() => VoteEntity, (vote) => vote.proposal)
  votes!: Relation<VoteEntity[]>;

  @OneToMany(() => VoteNullifierEntity, (nullifier) => nullifier.proposal)
  voteNullifiers!: Relation<VoteNullifierEntity[]>;

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
