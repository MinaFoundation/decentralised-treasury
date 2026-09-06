import { DataSource } from "typeorm";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  IndexerCursorEntity,
  IndexerRuntimeStatusEntity,
} from "../entities.js";

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
    entities: [
      ArchiveEventEntity,
      ArchiveEventRejectionEntity,
      IndexerCursorEntity,
      IndexerRuntimeStatusEntity,
    ],
  });
}
