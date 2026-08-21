import { MigrationInterface, QueryRunner } from "typeorm";

export class CursorTimestampMillisecondPrecision1787306501353
  implements MigrationInterface
{
  name = "CursorTimestampMillisecondPrecision1787306501353";

  // Postgres timestamptz defaults to microsecond precision; a JavaScript Date
  // only carries milliseconds. The processor reads archive_events.updated_at,
  // loses the sub-millisecond part passing it through Date, and stores that as
  // its keyset cursor. The next query then asks for updated_at > cursor, which
  // is still true for the row the cursor points at, so the processor refetched
  // and reprocessed the same event on every poll and never advanced.
  //
  // Narrowing both columns to millisecond precision makes the stored cursor
  // exactly representable, so the comparison excludes the row it should.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "archive_events" ALTER COLUMN "updated_at" TYPE TIMESTAMP(3) WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "processor_offsets" ALTER COLUMN "last_seen_updated_at" TYPE TIMESTAMP(3) WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "processor_offsets" ALTER COLUMN "last_seen_updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "archive_events" ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE`,
    );
  }
}
