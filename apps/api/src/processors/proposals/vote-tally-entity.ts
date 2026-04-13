import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { ProposalEntity } from "./proposal-entity.js";
import { VoteEntity } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";

export type VoteTallyVoteResult = "approved" | "rejected";
export type VoteTallyCreatedByEventType =
  | "proposalVoteDispatched"
  | "proposalVotesTallied";

@Entity({ name: "processor_vote_tallies" })
@Index(
  "ux_processor_vote_tallies_proposal_public_key_block_height",
  ["proposalPublicKey", "blockHeight"],
  { unique: true },
)
@Index("ix_processor_vote_tallies_proposal_public_key", ["proposalPublicKey"])
export class VoteTallyEntity {
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
    name: "block_height",
  })
  blockHeight!: number;

  @Column({
    type: "text",
    name: "yay_weight",
    default: "0",
  })
  yayWeight!: string;

  @Column({
    type: "text",
    name: "nay_weight",
    default: "0",
  })
  nayWeight!: string;

  @Column({
    type: "text",
    name: "abstain_weight",
    default: "0",
  })
  abstainWeight!: string;

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
    name: "total_participating_votes",
    nullable: true,
  })
  totalParticipatingVotes!: string | null;

  @Column({
    type: "text",
    name: "approval_bp",
    nullable: true,
  })
  approvalBp!: string | null;

  @Column({
    type: "text",
    name: "vote_result",
    nullable: true,
  })
  voteResult!: VoteTallyVoteResult | null;

  @Column({
    type: "text",
    name: "created_by_event_type",
    nullable: true,
  })
  createdByEventType!: VoteTallyCreatedByEventType | null;

  @ManyToOne(() => ProposalEntity, (proposal) => proposal.voteTallies, {
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "proposal_public_key",
    referencedColumnName: "proposalPublicKey",
  })
  proposal!: Relation<ProposalEntity>;

  @OneToMany(() => VoteEntity, (vote) => vote.voteTally)
  votes!: Relation<VoteEntity[]>;

  @OneToMany(() => VoteNullifierEntity, (nullifier) => nullifier.voteTally)
  nullifiers!: Relation<VoteNullifierEntity[]>;

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
