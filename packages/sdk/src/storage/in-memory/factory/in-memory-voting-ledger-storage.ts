import { MerkleTreeStorage } from "../../merkle-tree-storage.js";
import { VotingAccountStorage } from "../../voting-account-storage.js";
import { VotingLedgerStorage } from "../../voting-ledger-storage.js";
import { InMemoryMerkleTreeStorage } from "../in-memory-merkle-tree-storage.js";
import { InMemoryVotingAccountStorage } from "../in-memory-voting-account-storage.js";

export function createInMemoryVotingLedgerStorage(
  parentStorage: VotingLedgerStorage<VotingAccountStorage, MerkleTreeStorage>,
): VotingLedgerStorage<
  InMemoryVotingAccountStorage,
  InMemoryMerkleTreeStorage
> {
  return {
    votingAccountStorage: new InMemoryVotingAccountStorage(
      parentStorage.votingAccountStorage,
    ),
    merkleTreeStorage: new InMemoryMerkleTreeStorage(
      parentStorage.merkleTreeStorage,
    ),
  };
}
