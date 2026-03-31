import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "processor_test_projections" })
@Index("ux_processor_test_projections_event_key", ["eventKey"], { unique: true })
export class TestProjectionEntity {
  @PrimaryGeneratedColumn({
    type: "bigint",
    name: "id",
  })
  id!: string;

  @Column({
    type: "text",
    name: "event_key",
  })
  eventKey!: string;

  @Column({
    type: "text",
    name: "payload",
  })
  payload!: string;

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
