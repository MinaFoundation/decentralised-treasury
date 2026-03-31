import { ArchiveEventEntity, IndexerCursorEntity } from "@repo/indexer";
import { ProcessorOffsetEntity } from "@repo/processor";
import "reflect-metadata";
import { DataType, newDb } from "pg-mem";
import { DataSource, type EntitySchema } from "typeorm";

type InMemoryEntitySchema = Function | string | EntitySchema;

export function createInMemoryDataSource(
  schema = "public",
  outputEntitySchemas: InMemoryEntitySchema[] = [],
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

  const entities: InMemoryEntitySchema[] = [
    ArchiveEventEntity,
    IndexerCursorEntity,
    ProcessorOffsetEntity,
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
