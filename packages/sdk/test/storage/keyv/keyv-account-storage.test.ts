import { it } from "node:test";
import { Account } from "../../../src/provable/account.js";
import { KeyvAccountStorage } from "../../../src/storage/keyv/keyv-account-storage.js";
import assert from "node:assert";
import { PrivateKey } from "o1js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

const createKeyvClient = (lifecycleId: string) => {
  return createSqliteKeyv(getSqliteDbPath(lifecycleId));
};

it("should create a keyv account storage", async () => {
  const lifecycleId = `test-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const accountStorage = new KeyvAccountStorage(
    keyv,
    "test-namespace",
    counter,
  );

  const account = Account.empty();
  account.pk = PrivateKey.random().toPublicKey();
  account.delegate = account.pk;

  await accountStorage.setAccount(0n, account);
  const storedAccount = await accountStorage.getAccount(0n);

  assert(
    storedAccount?.pk.toBase58() === account.pk.toBase58(),
    "account does not match",
  );

  await accountStorage.close();
});
