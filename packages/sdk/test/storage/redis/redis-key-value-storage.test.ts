import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { RedisKeyValueStorage } from "../../../src/storage/redis/redis-key-value-storage.js";
import assert from "node:assert";

const key = "foo";
const value = "bar";
const namespace = "test-namespace";

it("should create a redis keyv storage", async () => {
  const redisServer = new RedisMemoryServer();

  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  const storage = new RedisKeyValueStorage(
    `redis://${redisHost}:${redisPort}`,
    namespace
  );

  await storage.set(key, value);
  const storedValue = await storage.get(key);

  assert(storedValue === value, "value does not match");

  await storage.close();
  await redisServer.stop();
});
