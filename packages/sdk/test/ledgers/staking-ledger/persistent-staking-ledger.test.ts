import { it } from "node:test";
import assert from "node:assert";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import { Account, packToFields } from "../../../src/provable/account.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";
import { Provable } from "o1js";

it("should create a staking ledger backed by sqlite storage", async () => {
  const lifecycleId = "test-lifecycle";
  const sqliteStore = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const storage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqliteStore,
  );
  const stakingLedger = new PersistentStakingLedger(
    storage.accountStorage,
    storage.merkleTreeStorage,
  );

  const accounts = await stakingLedger.readStakingLedger(
    "test/test-ledger.json",
  );

  await stakingLedger.hydrateAccounts(accounts, 0, 199);
  await stakingLedger.hydrateMerkleTree(accounts, 0, 199);

  const expectedAccount1 = accounts[25];
  const index1 = BigInt(25);
  const account1 = await stakingLedger.getAccount(index1);
  const witness1 = await stakingLedger.getWitness(index1);
  const calculatedIndex1 = witness1.calculateIndex().toBigInt();
  const calculatedRoot1 = witness1.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account1)),
    ),
    accountLedgerHashPrefixes,
  );

  const emptyWitness = await stakingLedger.getWitness(1009n);
  const emptyCalculatedRoot = emptyWitness.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(Account.empty())),
    ),
    accountLedgerHashPrefixes,
  );
  Provable.log("empty calculated root", emptyCalculatedRoot.toString());

  const root = await stakingLedger.merkleTree.getRoot();
  assert(
    account1?.pk.toBase58() === expectedAccount1?.pk.toBase58(),
    "account does not match",
  );
  assert(calculatedIndex1 === index1, "index does not match");
  assert(calculatedRoot1.toString() === root.toString(), "root does not match");

  assert(
    emptyCalculatedRoot.toString() === root.toString(),
    "root does not match",
  );

  await stakingLedger.close();
  await sqliteStore.disconnect();
});
