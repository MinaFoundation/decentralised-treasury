import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import assert from "node:assert";
import { accountLedgerHashPrefixes } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../../../src/provable/account.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { LedgerHashBase58, Provable } from "o1js";

// staking ledger root extracted from lightnet's network state
const expectedRoot = LedgerHashBase58.fromBase58(
  "jxmhCFQdZbE22Xik8bHqcWP9e5wsMRhNhf4ttQ8hZUdVqMn1j7T", // 12034099690484263947933237198482912306287086365215556860993847175760583881948
).toString();

it("should create a redis staking ledger", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const lifecycleId = "test-lifecycle";
  const stakingLedger = new RedisStakingLedger(redisUrl, lifecycleId);

  const accounts = await stakingLedger.readStakingLedger(
    "test/test-ledger.json",
  );

  await stakingLedger.hydrateAccounts(accounts, 0, 199);
  await stakingLedger.hydrateMerkleTree(accounts, 0, 199);
  await stakingLedger.close();

  const stakingLedger2 = new RedisStakingLedger(redisUrl, lifecycleId);

  await stakingLedger2.hydrateAccounts(accounts, 149);
  await stakingLedger2.hydrateMerkleTree(accounts, 149);

  const pkBase58 = "B62qrXNTaMKoftG15zBGad2tijoHbMLzASP2oV9gUtspL8jeDDfrYX4";
  const index = BigInt(25);
  const account = await stakingLedger2.getAccount(index);
  const witness = await stakingLedger2.getWitness(index);
  const calculatedIndex = witness.calculateIndex().toBigInt();
  const calculatedRoot = witness.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account)),
    ),
    accountLedgerHashPrefixes,
  );
  const root = await stakingLedger2.merkleTree.getRoot();
  assert(account?.pk.toBase58() === pkBase58, "account does not match");
  assert(calculatedIndex === index, "index does not match");
  assert(calculatedRoot.toString() === expectedRoot, "root does not match");
  assert(root.toString() === expectedRoot, "root does not match");

  await stakingLedger2.close();
  await redisServer.stop();
});
