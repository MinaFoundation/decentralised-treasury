import assert from "node:assert";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { PrivateKey } from "o1js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { createDevelopmentStakingLedger } from "../src/lib/development-staking-ledger.js";
import { runCli } from "./utils/cli-test-utils.js";

const MINI_LEDGER_PATH = fileURLToPath(
  new URL("../../../packages/sdk/test/test-ledger-mini.json", import.meta.url),
);
const STAKING_LEDGER_FIXTURE_LIFECYCLE_ID = "cli-staking-ledger-mini-fixture";
const EXPECTED_MINI_LEDGER_ROOT =
  "3982835709504547613460178343351902306072230308795146598392355811214701294803";

function developmentLedgerOptions(
  publicKeys: string[],
  outputPath: string,
  balances: { treasuryOwnerBalance?: string; voterBalance?: string } = {},
) {
  return {
    outputPath,
    treasuryOwnerPublicKey: publicKeys[0]!,
    voter1PublicKey: publicKeys[1]!,
    voter2PublicKey: publicKeys[2]!,
    voter3PublicKey: publicKeys[3]!,
    voter4PublicKey: publicKeys[4]!,
    voter5PublicKey: publicKeys[5]!,
    treasuryOwnerBalance: balances.treasuryOwnerBalance ?? "1000",
    voterBalance: balances.voterBalance ?? "100",
  };
}

it("hydrates staking ledger via cli from-file command", async (context) => {
  const lifecycleId = STAKING_LEDGER_FIXTURE_LIFECYCLE_ID;
  const directory = await mkdtemp(join(tmpdir(), "treasury-staking-ledger-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  const sqliteDataDirectory = join(directory, "sqlite");
  const dbPath = join(sqliteDataDirectory, `${lifecycleId}.sqlite`);

  await runCli(
    [
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
    ],
    { envOverrides: { SQLITE_DATA_DIRECTORY: sqliteDataDirectory } },
  );

  const service = new SqliteStakingLedgerService({ lifecycleId, dbPath });
  await service.start();
  const root = await service.getRootHash();
  await service.close();

  assert.strictEqual(root.toString(), EXPECTED_MINI_LEDGER_ROOT);
});

it("creates and verifies a development staking snapshot", async (context) => {
  const directory = await mkdtemp(
    join(tmpdir(), "treasury-development-ledger-"),
  );
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );

  const publicKeys = Array.from({ length: 6 }, () =>
    PrivateKey.random().toPublicKey().toBase58(),
  );
  const snapshotPath = join(directory, "staking-ledger.json");
  const sqliteDataDirectory = join(directory, "sqlite");

  const createOutput = await runCli([
    "staking-ledger",
    "create-development-snapshot",
    "--output-path",
    snapshotPath,
    "--treasury-owner-public-key",
    publicKeys[0]!,
    "--voter-1-public-key",
    publicKeys[1]!,
    "--voter-2-public-key",
    publicKeys[2]!,
    "--voter-3-public-key",
    publicKeys[3]!,
    "--voter-4-public-key",
    publicKeys[4]!,
    "--voter-5-public-key",
    publicKeys[5]!,
  ]);
  const result = JSON.parse(createOutput) as {
    accountCount: number;
    ledgerHashBase58: string;
    stakingEpochDataLedgerHash: string;
    stakingEpochDataLedgerTotalCurrency: string;
  };

  assert.equal(result.accountCount, 6);
  assert.equal(result.stakingEpochDataLedgerTotalCurrency, "1500000000000");

  const accounts = JSON.parse(await readFile(snapshotPath, "utf8")) as Array<{
    pk: string;
    delegate: string;
    balance: string;
  }>;
  assert.deepEqual(
    accounts.map(({ balance }) => balance),
    ["1000", "100", "100", "100", "100", "100"],
  );
  assert.deepEqual(
    accounts.map(({ pk }) => pk),
    publicKeys,
  );
  assert(accounts.every(({ pk, delegate }) => pk === delegate));

  await runCli(
    [
      "staking-ledger",
      "from-file",
      "--lifecycle-id",
      "0",
      "--staking-ledger-path",
      snapshotPath,
    ],
    { envOverrides: { SQLITE_DATA_DIRECTORY: sqliteDataDirectory } },
  );

  const service = new SqliteStakingLedgerService({
    lifecycleId: "0",
    dbPath: join(sqliteDataDirectory, "0.sqlite"),
  });
  await service.start();
  try {
    const importedAccounts = await service.getAllAccounts();
    assert.deepEqual(
      importedAccounts.map(({ balance }) => balance.toBigInt()),
      [1_000_000_000_000n, ...Array<bigint>(5).fill(100_000_000_000n)],
    );
    assert.equal(
      importedAccounts.reduce(
        (total, { balance }) => total + balance.toBigInt(),
        0n,
      ),
      BigInt(result.stakingEpochDataLedgerTotalCurrency),
    );
  } finally {
    await service.close();
  }

  const rootOutput = await runCli(
    [
      "staking-ledger",
      "get-root-hash",
      "--lifecycle-id",
      "0",
      "--expected-root-hash",
      result.ledgerHashBase58,
      "--output-format",
      "json",
    ],
    { envOverrides: { SQLITE_DATA_DIRECTORY: sqliteDataDirectory } },
  );
  const root = JSON.parse(rootOutput) as {
    ledgerHashBase58: string;
    stakingEpochDataLedgerHash: string;
  };

  assert.equal(root.ledgerHashBase58, result.ledgerHashBase58);
  assert.equal(
    root.stakingEpochDataLedgerHash,
    result.stakingEpochDataLedgerHash,
  );

  await runCli(
    ["staking-ledger-to-voting-ledger", "trace-digest", "--lifecycle-id", "0"],
    {
      envOverrides: {
        PROOFS_ENABLED: "false",
        SQLITE_DATA_DIRECTORY: sqliteDataDirectory,
      },
    },
  );
});

it("rejects invalid development staking snapshot inputs", async (context) => {
  const directory = await mkdtemp(
    join(tmpdir(), "treasury-development-ledger-invalid-"),
  );
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );

  const publicKeys = Array.from({ length: 6 }, () =>
    PrivateKey.random().toPublicKey().toBase58(),
  );
  const outputPath = join(directory, "staking-ledger.json");

  const duplicateKeys = [...publicKeys];
  duplicateKeys[5] = duplicateKeys[1]!;
  await assert.rejects(
    createDevelopmentStakingLedger(
      developmentLedgerOptions(duplicateKeys, outputPath),
    ),
    /must all be different/,
  );

  for (const invalidBalance of ["0", "1.0000000001", "-1", "one"]) {
    await assert.rejects(
      createDevelopmentStakingLedger(
        developmentLedgerOptions(publicKeys, outputPath, {
          voterBalance: invalidBalance,
        }),
      ),
      /must be at least 100 MINA|must be a non-negative MINA amount/,
    );
  }

  for (const balanceOption of ["treasuryOwnerBalance", "voterBalance"] as const) {
    for (const balance of ["0.0000001", "99.999999999"]) {
      await assert.rejects(
        createDevelopmentStakingLedger(
          developmentLedgerOptions(publicKeys, outputPath, {
            [balanceOption]: balance,
          }),
        ),
        /must be at least 100 MINA/,
      );
    }
  }

  await assert.rejects(
    createDevelopmentStakingLedger(
      developmentLedgerOptions(publicKeys, outputPath, {
        treasuryOwnerBalance: "18446744073.709551616",
      }),
    ),
    /must fit a UInt64 nanomina amount/,
  );

  await assert.rejects(
    createDevelopmentStakingLedger(
      developmentLedgerOptions(publicKeys, outputPath, {
        treasuryOwnerBalance: "18446744073.709551615",
        voterBalance: "100",
      }),
    ),
    /total currency must fit a UInt64 nanomina amount/,
  );
});
