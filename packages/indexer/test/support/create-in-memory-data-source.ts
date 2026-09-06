import "reflect-metadata";
import { DataType, newDb } from "pg-mem";
import { DataSource } from "typeorm";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  IndexerCursorEntity,
  IndexerRuntimeStatusEntity,
} from "../../src/index.js";

export interface InMemoryDataSourceOptions {
  onIndexerAdvisoryLock?: () => void;
}

export function createInMemoryDataSource(
  schema = "public",
  options: InMemoryDataSourceOptions = {},
): DataSource {
  const db = newDb();
  db.public.registerFunction({
    name: "version",
    args: [],
    returns: DataType.text,
    implementation: () => "PostgreSQL 16.0 pg-mem",
  });
  db.public.registerFunction({
    name: "current_database",
    args: [],
    returns: DataType.text,
    implementation: () => "pg_mem",
  });
  db.public.registerFunction({
    name: "current_schema",
    args: [],
    returns: DataType.text,
    implementation: () => schema,
  });
  db.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => {
      options.onIndexerAdvisoryLock?.();
      return 1;
    },
  });

  const dataSource = db.adapters.createTypeormDataSource({
    type: "postgres",
    schema,
    synchronize: false,
    entities: [
      ArchiveEventEntity,
      ArchiveEventRejectionEntity,
      IndexerCursorEntity,
      IndexerRuntimeStatusEntity,
    ],
  });
  const synchronize = dataSource.synchronize.bind(dataSource);
  dataSource.synchronize = async (dropBeforeSync?: boolean) => {
    await dataSource.query(
      "CREATE SEQUENCE IF NOT EXISTS archive_event_change_sequence_seq",
    );
    return synchronize(dropBeforeSync);
  };
  return dataSource;
}
