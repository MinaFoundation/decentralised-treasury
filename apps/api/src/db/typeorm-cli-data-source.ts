import "reflect-metadata";
import { ArchiveEventEntity, IndexerCursorEntity } from "@repo/indexer";
import { ProcessorOffsetEntity } from "@repo/processor";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { ProposalExecutionEntity } from "../processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../processors/proposals/vote-entity.js";

const DEFAULT_DATABASE_SCHEMA = "public";
const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIRECTORY_PATH = dirname(THIS_FILE_PATH);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const databaseSchema = process.env.DATABASE_SCHEMA ?? DEFAULT_DATABASE_SCHEMA;

export default new DataSource({
  type: "postgres",
  url: databaseUrl,
  schema: databaseSchema,
  synchronize: false,
  entities: [
    ArchiveEventEntity,
    IndexerCursorEntity,
    ProcessorOffsetEntity,
    ProposalEntity,
    ProposalExecutionEntity,
    VoteEntity,
    VoteNullifierEntity,
    VoteTallyEntity,
  ],
  migrations: [join(THIS_DIRECTORY_PATH, "migrations", "*.{ts,js}")],
});
