import { it } from "node:test";
import { RedisMerkleTreeStorage } from "../../../src/storage/redis/redis-merkle-tree-storage.js";
import { RedisMemoryServer } from "redis-memory-server";
import { Field, Provable } from "o1js";
import assert from "node:assert";
import { PrefixedMerkleTree } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";

const expectedRoot =
  "16454815573389775030357115923683611722287847789162266602163105950268208151468";

it("should create a prefixed merkle tree", async () => {
  const redisServer = new RedisMemoryServer();

  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const merkleTreeStorage = new RedisMerkleTreeStorage(
    redisUrl,
    "test-namespace"
  );

  const height = 2;
  const emptyLeafHash = Field(0);
  const hashPrefixes = ["test-prefix-0"];
  const values = [Field(1), Field(2)];

  const tree = new PrefixedMerkleTree(
    height,
    emptyLeafHash,
    hashPrefixes,
    merkleTreeStorage
  );

  for (let i = 0; i < values.length; i++) {
    await tree.setLeaf(BigInt(i), values[i]);
  }
  const root = await tree.getRoot();
  assert(root?.toString() === expectedRoot, "root does not match");
  await merkleTreeStorage.close();
  await redisServer.stop();
});
