import type { DataSource } from "typeorm";

const DEFAULT_DATABASE_SCHEMA = "public";

export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function resolveDatabaseSchema(
  dataSource: DataSource,
  configuredSchema?: string,
): string {
  const dataSourceSchema = (dataSource.options as { schema?: unknown }).schema;
  if (typeof configuredSchema === "string" && configuredSchema.length > 0) {
    return configuredSchema;
  }
  if (typeof dataSourceSchema === "string" && dataSourceSchema.length > 0) {
    return dataSourceSchema;
  }
  return DEFAULT_DATABASE_SCHEMA;
}

export function qualifyTableName(schema: string, table: string): string {
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
}
