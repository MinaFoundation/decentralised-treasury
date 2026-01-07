import { it } from "node:test";
import { RedisMerkleTreeStorage } from "../../../src/storage/redis/redis-merkle-tree-storage.js";
import { RedisMemoryServer } from "redis-memory-server";
import { Field } from "o1js";
import assert from "node:assert";

it("should create a key value merkle tree storage", async () => {
  const redisServer = new RedisMemoryServer();

  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const merkleTreeStorage = new RedisMerkleTreeStorage(
    redisUrl,
    "test-namespace"
  );

  await merkleTreeStorage.setNode(0, 0n, Field(1));
  const node = await merkleTreeStorage.getNode(0, 0n);
  assert(node?.toString() === "1", "node does not match");

  await merkleTreeStorage.close();
  await redisServer.stop();
});
