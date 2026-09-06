import "reflect-metadata";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  IndexerCursorEntity,
  IndexerRuntimeStatusEntity,
} from "@repo/indexer";
import {
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "@repo/processor";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { ProposalExecutionEntity } from "../processors/proposals/proposal-execution-entity.js";
import { ProposalContentEntity } from "../processors/proposals/proposal-content-entity.js";
import { ProposalEventFactEntity } from "../processors/proposals/proposal-event-fact-entity.js";
import { ProposalProjectionReplayEntity } from "../processors/proposals/proposal-projection-replay-entity.js";
import { ProposalEntity } from "../processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../processors/proposals/vote-entity.js";
import { ensureDatabaseSchema } from "./ensure-database-schema.js";

const DEFAULT_DATABASE_SCHEMA = "public";
const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIRECTORY_PATH = dirname(THIS_FILE_PATH);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const databaseSchema = process.env.DATABASE_SCHEMA ?? DEFAULT_DATABASE_SCHEMA;

export default (async (): Promise<DataSource> => {
  // TypeORM creates its migrations table before it runs the first migration.
  // Create the configured schema first so a fresh custom-schema deployment works.
  await ensureDatabaseSchema(databaseUrl, databaseSchema);

  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    schema: databaseSchema,
    synchronize: false,
    entities: [
      ArchiveEventEntity,
      ArchiveEventRejectionEntity,
      IndexerCursorEntity,
      IndexerRuntimeStatusEntity,
      ProcessorOffsetEntity,
      ProcessorEventFailureEntity,
      ProcessorRuntimeStatusEntity,
      ProposalEntity,
      ProposalContentEntity,
      ProposalExecutionEntity,
      ProposalEventFactEntity,
      ProposalProjectionReplayEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ],
    migrations: [join(THIS_DIRECTORY_PATH, "migrations", "*.{ts,js}")],
  });
})();
