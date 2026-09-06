import type { EntityManager } from "typeorm";
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import {
  qualifyTableName,
  resolveDatabaseSchema,
} from "../../database-schema.js";

export type ProposalProjectionReplayState = "collecting" | "complete";

@Entity({ name: "processor_proposal_projection_replay" })
export class ProposalProjectionReplayEntity {
  @PrimaryColumn({
    type: "text",
    name: "projection_name",
  })
  projectionName!: string;

  @Column({
    type: "bigint",
    name: "target_change_sequence",
  })
  targetChangeSequence!: string;

  @Column({
    type: "text",
    name: "state",
  })
  state!: ProposalProjectionReplayState;

  @Column({
    type: "timestamptz",
    name: "completed_at",
    nullable: true,
  })
  completedAt!: Date | null;

  @UpdateDateColumn({
    type: "timestamptz",
    name: "updated_at",
  })
  updatedAt!: Date;
}

export async function rewindProposalProjectionReplay(
  manager: EntityManager,
  processorName: string,
): Promise<void> {
  const schema = resolveDatabaseSchema(manager.connection);
  const offsetsTable = qualifyTableName(schema, "processor_offsets");
  const replayTable = qualifyTableName(
    schema,
    "processor_proposal_projection_replay",
  );
  await manager.query(
    `UPDATE ${offsetsTable}
     SET "last_seen_change_sequence" = 0
     WHERE "processor_name" = $1
       AND EXISTS (
         SELECT 1
         FROM ${replayTable}
         WHERE "projection_name" = 'proposal'
           AND "state" = 'collecting'
       )`,
    [processorName],
  );
}
