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
import type { VoteLabel } from "./vote-entity.js";

@Entity({ name: "processor_vote_nullifiers" })
@Index("ix_processor_vote_nullifiers_proposal_public_key", [
  "proposalPublicKey",
])
@Index(
  "ux_processor_vote_nullifiers_proposal_public_key_voter_public_key",
  ["proposalPublicKey", "voterPublicKey"],
  { unique: true },
)
@Index("ux_processor_vote_nullifiers_source_event_id", ["sourceEventId"], {
  unique: true,
})
export class VoteNullifierEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

  @Column({
    type: "text",
    name: "source_event_id",
  })
  sourceEventId!: string;

  @Column({
    type: "text",
    name: "proposal_public_key",
  })
  proposalPublicKey!: string;

  @Column({
    type: "text",
    name: "voter_public_key",
  })
  voterPublicKey!: string;

  @Column({
    type: "text",
    name: "vote",
  })
  vote!: VoteLabel;

  @Column({
    type: "text",
    name: "vote_weight",
  })
  voteWeight!: string;

  @Column({
    type: "integer",
    name: "block_height",
  })
  blockHeight!: number;

  @ManyToOne(() => ProposalEntity, (proposal) => proposal.voteNullifiers, {
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
