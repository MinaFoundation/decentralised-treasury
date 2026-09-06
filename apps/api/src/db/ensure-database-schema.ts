import { DataSource } from "typeorm";
import { quoteSqlIdentifier } from "../database-schema.js";

export async function ensureDatabaseSchema(
  databaseUrl: string,
  databaseSchema: string,
): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseSchema)) {
    throw new Error("DATABASE_SCHEMA must be a valid SQL identifier");
  }

  const bootstrapDataSource = new DataSource({
    type: "postgres",
    url: databaseUrl,
  });

  await bootstrapDataSource.initialize();
  try {
    await bootstrapDataSource.query(
      `CREATE SCHEMA IF NOT EXISTS ${quoteSqlIdentifier(databaseSchema)}`,
    );
  } finally {
    await bootstrapDataSource.destroy();
  }
}
