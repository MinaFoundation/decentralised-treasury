import "reflect-metadata";
import { DataType, newDb } from "pg-mem";
import { DataSource } from "typeorm";
import { ArchiveEventEntity, IndexerCursorEntity } from "../../src/index.js";

export function createInMemoryDataSource(schema = "public"): DataSource {
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

  return db.adapters.createTypeormDataSource({
    type: "postgres",
    schema,
    synchronize: false,
    entities: [ArchiveEventEntity, IndexerCursorEntity],
  });
}
