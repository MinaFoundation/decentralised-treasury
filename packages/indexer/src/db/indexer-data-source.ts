import { DataSource } from "typeorm";
import { ArchiveEventEntity, IndexerCursorEntity } from "../entities.js";

export interface IndexerDatabaseConfig {
  databaseUrl: string;
  databaseSchema: string;
}

export function createIndexerDataSource(
  config: IndexerDatabaseConfig,
): DataSource {
  return new DataSource({
    type: "postgres",
    url: config.databaseUrl,
    schema: config.databaseSchema,
    synchronize: false,
    entities: [ArchiveEventEntity, IndexerCursorEntity],
  });
}
