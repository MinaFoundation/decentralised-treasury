import assert from "node:assert";
import { after, before, it } from "node:test";
import { Field, PrivateKey, Provable, UInt64 } from "o1js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { InMemoryVotingAccountStorage } from "../../../src/storage/in-memory/in-memory-voting-account-storage.js";
import { InMemoryMerkleTreeStorage } from "../../../src/storage/in-memory/in-memory-merkle-tree-storage.js";
import { InMemoryVoteNullifierStorage } from "../../../src/storage/in-memory/in-memory-vote-nullifier-storage.js";
import { KeyvKeyValueBatchStorage } from "../../../src/storage/keyv/keyv-key-value-batch-storage.js";
import { KeyvMerkleTreeStorage } from "../../../src/storage/keyv/keyv-merkle-tree-storage.js";
import { KeyvVoteNullifierStorage } from "../../../src/storage/keyv/keyv-vote-nullifier-storage.js";
import { KeyvVotingAccountStorage } from "../../../src/storage/keyv/keyv-voting-account-storage.js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

let batchWriter: KeyvKeyValueBatchStorage;
let parentVotingStorage: KeyvVotingAccountStorage;
let parentMerkleStorage: KeyvMerkleTreeStorage;
let parentNullifierStorage: KeyvVoteNullifierStorage;
let inMemoryVotingStorage: InMemoryVotingAccountStorage;
let inMemoryMerkleStorage: InMemoryMerkleTreeStorage;
let inMemoryNullifierStorage: InMemoryVoteNullifierStorage;
let counter: SqliteCounter;

before(async () => {
  const lifecycleId = `test-batch-writer-${Date.now()}`;
  const dbPath = getSqliteDbPath(lifecycleId);
  counter = new SqliteCounter(dbPath);

  function createTestKeyv() {
    return createSqliteKeyv(dbPath);
  }

  const namespace = "test-batch-writer";
  batchWriter = new KeyvKeyValueBatchStorage(createTestKeyv());
  parentVotingStorage = new KeyvVotingAccountStorage(
    createTestKeyv(),
    namespace,
    counter,
  );
  parentMerkleStorage = new KeyvMerkleTreeStorage(
    createTestKeyv(),
    namespace,
    counter,
  );
  parentNullifierStorage = new KeyvVoteNullifierStorage(
    createTestKeyv(),
    namespace,
    counter,
  );

  inMemoryVotingStorage = new InMemoryVotingAccountStorage(parentVotingStorage);
  inMemoryMerkleStorage = new InMemoryMerkleTreeStorage(parentMerkleStorage);
  inMemoryNullifierStorage = new InMemoryVoteNullifierStorage(
    parentNullifierStorage,
  );
});

after(async () => {
  await batchWriter.close();
  await inMemoryVotingStorage.close();
  await inMemoryMerkleStorage.close();
  await inMemoryNullifierStorage.close();
});

it("should batch write collected entries from all in-memory storages", async () => {
  const publicKey = PrivateKey.random().toPublicKey().toBase58();
  const votingAccount = VotingAccount.empty();
  votingAccount.balance = UInt64.from(321);

  await inMemoryVotingStorage.setVotingAccount(publicKey, votingAccount);
  await inMemoryMerkleStorage.setNode(2, 7n, Field(42));
  await inMemoryNullifierStorage.setNullifier(publicKey, true);

  const allEntries = [
    ...inMemoryVotingStorage.collectEntries(),
    ...inMemoryMerkleStorage.collectEntries(),
    ...inMemoryNullifierStorage.collectEntries(),
  ];

  Provable.log("allEntries", allEntries);
  await batchWriter.setMany(allEntries);

  const storedVotingAccount =
    await parentVotingStorage.getVotingAccount(publicKey);
  const storedMerkleNode = await parentMerkleStorage.getNode(2, 7n);
  const storedNullifier = await parentNullifierStorage.getNullifier(publicKey);

  Provable.log("storedVotingAccount", storedVotingAccount);
  Provable.log("storedMerkleNode", storedMerkleNode);
  Provable.log("storedNullifier", storedNullifier);

  assert(
    storedVotingAccount?.balance.toBigInt() === 321n,
    "voting account should be persisted",
  );
  assert(
    storedMerkleNode?.toString() === "42",
    "merkle node should be persisted",
  );
  assert(storedNullifier === true, "nullifier should be persisted");
});
