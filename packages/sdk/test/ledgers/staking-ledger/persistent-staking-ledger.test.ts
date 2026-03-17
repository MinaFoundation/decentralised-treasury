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
import { LedgerHashBase58, Provable } from "o1js";

// staking ledger root extracted from lightnet's network state
const expectedRoot = LedgerHashBase58.fromBase58(
  "jxmhCFQdZbE22Xik8bHqcWP9e5wsMRhNhf4ttQ8hZUdVqMn1j7T", // 12034099690484263947933237198482912306287086365215556860993847175760583881948
).toString();

it("should create a staking ledger backed by sqlite storage", async () => {
  const lifecycleId = "test-lifecycle";
  const initialStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const initialLedger = new PersistentStakingLedger(
    initialStorage.accountStorage,
    initialStorage.merkleTreeStorage,
  );

  const accounts = await initialLedger.readStakingLedger(
    "test/test-ledger.json",
  );

  await initialLedger.hydrateAccounts(accounts, 0, 199);
  await initialLedger.hydrateMerkleTree(accounts, 0, 199);
  await initialLedger.close();

  const resumedStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const resumedLedger = new PersistentStakingLedger(
    resumedStorage.accountStorage,
    resumedStorage.merkleTreeStorage,
  );

  await resumedLedger.hydrateAccounts(accounts, 149);
  await resumedLedger.hydrateMerkleTree(accounts, 149);

  const pk1Base58 = "B62qrXNTaMKoftG15zBGad2tijoHbMLzASP2oV9gUtspL8jeDDfrYX4";
  const index1 = BigInt(25);
  const account1 = await resumedLedger.getAccount(index1);
  const witness1 = await resumedLedger.getWitness(index1);
  const calculatedIndex1 = witness1.calculateIndex().toBigInt();
  const calculatedRoot1 = witness1.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account1)),
    ),
    accountLedgerHashPrefixes,
  );

  const pk2Base58 = "B62qo4gj1rRJhDoiCweFaPfsoLMrcd1CGtXcYcWZ9Bo9fDGjRHBW5oN";
  const index2 = BigInt(1008);
  const account2 = await resumedLedger.getAccount(index2);
  const witness2 = await resumedLedger.getWitness(index2);
  const calculatedIndex2 = witness2.calculateIndex().toBigInt();
  const calculatedRoot2 = witness2.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account2)),
    ),
    accountLedgerHashPrefixes,
  );

  const emptyWitness = await resumedLedger.getWitness(1009n);
  const emptyCalculatedRoot = emptyWitness.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(Account.empty())),
    ),
    accountLedgerHashPrefixes,
  );
  Provable.log("empty calculated root", emptyCalculatedRoot.toString());

  const root = await resumedLedger.merkleTree.getRoot();
  assert(account1?.pk.toBase58() === pk1Base58, "account does not match");
  assert(calculatedIndex1 === index1, "index does not match");
  assert(calculatedRoot1.toString() === expectedRoot, "root does not match");
  assert(root.toString() === expectedRoot, "root does not match");

  assert(account2?.pk.toBase58() === pk2Base58, "account does not match");
  assert(calculatedIndex2 === index2, "index does not match");
  assert(calculatedRoot2.toString() === expectedRoot, "root does not match");
  assert(root.toString() === expectedRoot, "root does not match");

  assert(
    emptyCalculatedRoot.toString() === expectedRoot,
    "root does not match",
  );

  await resumedLedger.close();
});
