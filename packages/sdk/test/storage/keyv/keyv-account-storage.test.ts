import { it } from "node:test";
import { Account } from "../../../src/provable/account.js";
import { KeyvAccountStorage } from "../../../src/storage/keyv/keyv-account-storage.js";
import { KeyvSqliteCounter } from "../../../src/storage/sqlite/keyv-sqlite-counter.js";
import assert from "node:assert";
import { PrivateKey } from "o1js";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";

it("should create a keyv account storage", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const counter = new KeyvSqliteCounter(store);
  const accountStorage = new KeyvAccountStorage(keyv, "test-namespace", counter);

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
  await store.disconnect();
});
