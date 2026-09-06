import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "processor_proposal_contents" })
@Index("ix_processor_proposal_contents_proposal_public_key", [
  "proposalPublicKey",
])
export class ProposalContentEntity {
  @PrimaryColumn({
    type: "text",
    name: "proposal_public_key",
  })
  proposalPublicKey!: string;

  @PrimaryColumn({
    type: "text",
    name: "zkapp_uri_hash",
  })
  zkAppUriHash!: string;

  @Column({
    type: "text",
    name: "contents",
  })
  contents!: string;

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
