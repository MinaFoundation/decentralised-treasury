import assert from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { KeyvSqlite } from "@keyv/sqlite";
import { PersistentVotingLedger } from "@repo/sdk/src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { SqliteStakingLedgerToVotingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { createSqliteVotingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import {
  prepareVotingLedgerForLifecycle,
  type PreparedLightnetFixture,
} from "./utils/prepared-lightnet-fixture.js";

const MINI_LEDGER_PATH = fileURLToPath(
  new URL("../../../packages/sdk/test/test-ledger-mini.json", import.meta.url),
);

async function readLedgerState(
  dbPath: string,
  lifecycleId: string,
  publicKey: string,
) {
  const staking = new SqliteStakingLedgerService({ lifecycleId, dbPath });
  await staking.start();
  let stakingRoot: string;
  let stakingBalance: string;
  try {
    stakingRoot = (await staking.getRootHash()).toString();
    const account = await staking.getAccountByPublicKey(publicKey);
    assert(account, `missing staking account ${publicKey}`);
    stakingBalance = account.account.balance.toString();
  } finally {
    await staking.close();
  }

  const store = new KeyvSqlite({ uri: dbPath });
  const storage = createSqliteVotingLedgerStorage(lifecycleId, store);
  const voting = new PersistentVotingLedger(
    storage.votingAccountStorage,
    storage.merkleTreeStorage,
  );
  try {
    const votingAccount = await voting.getVotingAccount(publicKey);
    return {
      stakingRoot,
      stakingBalance,
      votingRoot: (await voting.getRoot()).toString(),
      votingBalance: votingAccount.balance.toString(),
    };
  } finally {
    await voting.close();
    await store.disconnect();
  }
}

it("copies real prepared ledgers into the selected lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prepared-lightnet-fixture-"));
  const sourceDirectory = join(directory, "source");
  const sourcePath = join(sourceDirectory, "0.sqlite");
  const originalSqliteDataDirectory = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = sourceDirectory;

  try {
    const staking = new SqliteStakingLedgerService({
      lifecycleId: "0",
      dbPath: sourcePath,
    });
    await staking.start();
    await staking.hydrateAccounts({
      stakingLedgerPath: MINI_LEDGER_PATH,
      endIndex: 9,
    });
    await staking.hydrateMerkleTree({ endIndex: 9 });
    await staking.close();

    const transform = new SqliteStakingLedgerToVotingLedgerService({
      lifecycleId: "0",
    });
    await transform.start();
    await transform.traceDigest();
    await transform.close();

    const firstEntry = JSON.parse(
      await readFile(MINI_LEDGER_PATH, "utf8"),
    ) as Array<{
      pk: string;
    }>;
    const publicKey = firstEntry[0]!.pk;
    const sourceState = await readLedgerState(sourcePath, "0", publicKey);
    const sourceBytes = await readFile(sourcePath);

    const fixture = {
      artifactLifecycleId: "0",
      votingLedgerSqlitePath: sourcePath,
    } as PreparedLightnetFixture;
    const { sqliteDbPath } = await prepareVotingLedgerForLifecycle(
      fixture,
      "7",
      join(directory, "run"),
    );

    assert.deepEqual(
      await readLedgerState(sqliteDbPath, "7", publicKey),
      sourceState,
    );
    assert.deepEqual(await readFile(sourcePath), sourceBytes);
  } finally {
    if (originalSqliteDataDirectory === undefined) {
      delete process.env.SQLITE_DATA_DIRECTORY;
    } else {
      process.env.SQLITE_DATA_DIRECTORY = originalSqliteDataDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
