import { MigrationInterface, QueryRunner } from "typeorm";

function getConfiguredSchema(queryRunner: QueryRunner): string {
  const schema = String(
    (queryRunner.connection.options as { schema?: string }).schema ?? "public",
  );
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("DATABASE_SCHEMA must be a valid SQL identifier");
  }
  return schema;
}

export class ConfigureProcessorSchema1775649313439 implements MigrationInterface {
  public readonly name = "ConfigureProcessorSchema1775649313439";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = getConfiguredSchema(queryRunner);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await queryRunner.query(`SET search_path TO "${schema}", public`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    getConfiguredSchema(queryRunner);
    await queryRunner.query(`SET search_path TO public`);
  }
}
