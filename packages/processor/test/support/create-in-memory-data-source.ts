import { ArchiveEventEntity, IndexerCursorEntity } from "@repo/indexer";
import "reflect-metadata";
import { DataType, newDb } from "pg-mem";
import { DataSource, type EntitySchema } from "typeorm";
import {
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "../../src/entities.js";

type InMemoryEntitySchema = Function | string | EntitySchema;

interface InMemoryDataSourceOptions {
  onProcessorAdvisoryLock?: () => void;
}

export function createInMemoryDataSource(
  schema = "public",
  outputEntitySchemas: InMemoryEntitySchema[] = [],
  options: InMemoryDataSourceOptions = {},
): DataSource {
  const db = newDb();
  db.public.none("CREATE SEQUENCE archive_event_change_sequence_seq START 1");
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
    name: "hashtext",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 0,
  });
  db.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => {
      options.onProcessorAdvisoryLock?.();
      return 1;
    },
  });

  const entities: InMemoryEntitySchema[] = [
    ArchiveEventEntity,
    IndexerCursorEntity,
    ProcessorOffsetEntity,
    ProcessorEventFailureEntity,
    ProcessorRuntimeStatusEntity,
  ];
  for (const outputEntitySchema of outputEntitySchemas) {
    if (!entities.includes(outputEntitySchema)) {
      entities.push(outputEntitySchema);
    }
  }

  return db.adapters.createTypeormDataSource({
    type: "postgres",
    schema,
    synchronize: false,
    entities,
  });
}
