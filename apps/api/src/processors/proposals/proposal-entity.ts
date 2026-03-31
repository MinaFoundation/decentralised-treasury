import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

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
    name: "zkapp_uri_hash",
  })
  zkAppUriHash!: string;

  @Column({
    type: "text",
    name: "status",
  })
  status!: string;

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
