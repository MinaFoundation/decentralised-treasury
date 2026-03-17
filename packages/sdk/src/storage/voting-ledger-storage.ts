import { MerkleTreeStorage } from "./merkle-tree-storage.js";
import { VotingAccountStorage } from "./voting-account-storage.js";

export interface VotingLedgerStorage<
  TVotingAccountStorage extends VotingAccountStorage = VotingAccountStorage,
  TMerkleTreeStorage extends MerkleTreeStorage = MerkleTreeStorage,
> {
  votingAccountStorage: TVotingAccountStorage;
  merkleTreeStorage: TMerkleTreeStorage;
}
