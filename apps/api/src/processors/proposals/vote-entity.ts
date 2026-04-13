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
import { VoteTallyEntity } from "./vote-tally-entity.js";

export type VoteLabel = "dummy" | "yay" | "nay" | "abstain";

@Entity({ name: "processor_votes" })
@Index("ix_processor_votes_proposal_public_key", ["proposalPublicKey"])
@Index(
  "ix_processor_votes_proposal_public_key_voter_public_key",
  ["proposalPublicKey", "voterPublicKey"],
)
@Index(
  "ux_processor_votes_archive_event_id",
  ["archiveEventId"],
  { unique: true },
)
export class VoteEntity {
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
    nullable: true,
  })
  blockHeight!: number | null;

  @Column({
    type: "boolean",
    name: "is_nullified",
    default: false,
  })
  isNullified!: boolean;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

  @ManyToOne(() => ProposalEntity, {
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "proposal_public_key",
    referencedColumnName: "proposalPublicKey",
  })
  proposal!: Relation<ProposalEntity>;

  @ManyToOne(() => VoteTallyEntity, (voteTally) => voteTally.votes, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn([
    {
      name: "proposal_public_key",
      referencedColumnName: "proposalPublicKey",
    },
    {
      name: "block_height",
      referencedColumnName: "blockHeight",
    },
  ])
  voteTally!: Relation<VoteTallyEntity> | null;

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
