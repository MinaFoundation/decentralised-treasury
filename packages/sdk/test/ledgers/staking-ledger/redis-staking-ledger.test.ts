import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { LedgerHashBase58, Provable, PublicKey } from "o1js";
import assert from "node:assert";
import { accountLedgerHashPrefixes } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../../../src/provable/account.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import { RedisAccountStorage } from "../../../src/storage/redis/redis-account-storage.js";
import { RedisMerkleTreeStorage } from "../../../src/storage/redis/redis-merkle-tree-storage.js";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";

const expectedRoot =
  "16109365279801864533165423656011004731547087268642046792845053553332802250911";

it("should create a redis staking ledger", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const lifecycleId = "test-lifecycle";
  const stakingLedger = new RedisStakingLedger(redisUrl, lifecycleId);

  const accounts = await stakingLedger.readStakingLedger(
    "test/provable/staking-epoch-ledger.json"
  );

  await stakingLedger.hydrateAccountStorage(accounts, 0, 200);
  await stakingLedger.hydrateMerkleTreeStorage(accounts, 0, 200);
  await stakingLedger.close();

  const stakingLedger2 = new RedisStakingLedger(redisUrl, lifecycleId);

  await stakingLedger2.hydrateAccountStorage(accounts, 150);
  await stakingLedger2.hydrateMerkleTreeStorage(accounts, 150);

  const pkBase58 = "B62qrXNTaMKoftG15zBGad2tijoHbMLzASP2oV9gUtspL8jeDDfrYX4";
  const index = BigInt(25);
  const account = await stakingLedger2.getAccount(index);
  const witness = await stakingLedger2.getWitness(index);
  const calculatedIndex = witness.calculateIndex().toBigInt();
  const calculatedRoot = witness.calculateRoot(
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account))
    ),
    accountLedgerHashPrefixes
  );
  const root = await stakingLedger2.merkleTree.getRoot();
  assert(account?.pk.toBase58() === pkBase58, "account does not match");
  assert(calculatedIndex === index, "index does not match");
  assert(calculatedRoot.toString() === expectedRoot, "root does not match");
  assert(root.toString() === expectedRoot, "root does not match");

  await stakingLedger2.close();
  await redisServer.stop();
});
