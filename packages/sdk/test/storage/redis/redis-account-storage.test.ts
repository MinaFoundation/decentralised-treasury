import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { Account } from "../../../src/provable/account.js";
import { RedisAccountStorage } from "../../../src/storage/redis/redis-account-storage.js";
import assert from "node:assert";
import { PrivateKey, Provable } from "o1js";

it("should create a redis account storage", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const accountStorage = new RedisAccountStorage(redisUrl, "test-namespace");

  const account = Account.empty();
  account.pk = PrivateKey.random().toPublicKey();
  account.delegate = account.pk;

  await accountStorage.setAccount(account.pk, account);
  const storedAccount = await accountStorage.getAccount(account.pk);

  assert(
    storedAccount?.pk.toBase58() === account.pk.toBase58(),
    "account does not match"
  );

  await accountStorage.close();
  await redisServer.stop();
});
