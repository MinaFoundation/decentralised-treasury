import { MerkleTreeStorage } from "../../merkle-tree-storage.js";
import { NullifierLedgerStorage } from "../../nullifier-ledger-storage.js";
import { VoteNullifierStorage } from "../../vote-nullifier-storage.js";
import { InMemoryMerkleTreeStorage } from "../in-memory-merkle-tree-storage.js";
import { InMemoryVoteNullifierStorage } from "../in-memory-vote-nullifier-storage.js";

export function createInMemoryNullifierLedgerStorage(
  parentStorage: NullifierLedgerStorage<
    VoteNullifierStorage,
    MerkleTreeStorage
  >,
): NullifierLedgerStorage<
  InMemoryVoteNullifierStorage,
  InMemoryMerkleTreeStorage
> {
  return {
    nullifierStorage: new InMemoryVoteNullifierStorage(
      parentStorage.nullifierStorage,
    ),
    merkleTreeStorage: new InMemoryMerkleTreeStorage(
      parentStorage.merkleTreeStorage,
    ),
  };
}
