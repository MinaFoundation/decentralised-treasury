import assert from "node:assert";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { runCli } from "./utils/cli-test-utils.js";

const MINI_LEDGER_PATH = fileURLToPath(
  new URL("../../sdk/test/test-ledger-mini.json", import.meta.url),
);
const FIXTURES_DIRECTORY = fileURLToPath(new URL("./fixtures", import.meta.url));
const STAKING_LEDGER_FIXTURE_LIFECYCLE_ID = "cli-staking-ledger-mini-fixture";
const EXPECTED_MINI_LEDGER_ROOT =
  "3982835709504547613460178343351902306072230308795146598392355811214701294803";

it("hydrates staking ledger via cli from-file command", async () => {
  const lifecycleId = STAKING_LEDGER_FIXTURE_LIFECYCLE_ID;
  const sqliteDataDirectory = join(FIXTURES_DIRECTORY, ".data", "sqlite");
  const dbPath = join(
    sqliteDataDirectory,
    `${lifecycleId}.sqlite`,
  );

  await rm(dbPath, { force: true });
  await runCli([
    "staking-ledger",
    "from-file",
    "--lifecycle-id",
    lifecycleId,
    "--staking-ledger-path",
    MINI_LEDGER_PATH,
    "--start-index",
    "0",
    "--end-index",
    "9",
  ]);

  const service = new SqliteStakingLedgerService({ lifecycleId, dbPath });
  await service.start();
  const root = await service.getRootHash();
  await service.close();

  assert.strictEqual(root.toString(), EXPECTED_MINI_LEDGER_ROOT);
});
