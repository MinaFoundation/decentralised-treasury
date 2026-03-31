import "reflect-metadata";
import { ArchiveEventEntity, IndexerCursorEntity } from "@repo/indexer";
import { ProcessorOffsetEntity } from "@repo/processor";
import { DataSource } from "typeorm";
import { ProposalEntity } from "../processors/proposals/proposal-entity.js";

const DEFAULT_DATABASE_SCHEMA = "public";

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
  ],
});
