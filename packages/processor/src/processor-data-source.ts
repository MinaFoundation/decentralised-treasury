import { ArchiveEventEntity } from "@repo/indexer";
import { DataSource, type EntitySchema } from "typeorm";
import {
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "./entities.js";

export type ProcessorEntitySchema = Function | string | EntitySchema;

export interface ProcessorDatabaseConfig {
  databaseUrl: string;
  databaseSchema: string;
}

export const PROCESSOR_INTERNAL_ENTITIES: ProcessorEntitySchema[] = [
  ArchiveEventEntity,
  ProcessorOffsetEntity,
  ProcessorEventFailureEntity,
  ProcessorRuntimeStatusEntity,
];

export function createProcessorDataSource(
  config: ProcessorDatabaseConfig,
  outputEntitySchemas: ProcessorEntitySchema[],
): DataSource {
  const entities = [...PROCESSOR_INTERNAL_ENTITIES];
  for (const outputEntitySchema of outputEntitySchemas) {
    if (!entities.includes(outputEntitySchema)) {
      entities.push(outputEntitySchema);
    }
  }

  return new DataSource({
    type: "postgres",
    url: config.databaseUrl,
    schema: config.databaseSchema,
    synchronize: false,
    entities,
  });
}
