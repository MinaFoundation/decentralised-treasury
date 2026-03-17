import { MerkleTreeStorage } from "./merkle-tree-storage.js";
import { VoteNullifierStorage } from "./vote-nullifier-storage.js";

export interface NullifierLedgerStorage<
  TVoteNullifierStorage extends VoteNullifierStorage = VoteNullifierStorage,
  TMerkleTreeStorage extends MerkleTreeStorage = MerkleTreeStorage,
> {
  nullifierStorage: TVoteNullifierStorage;
  merkleTreeStorage: TMerkleTreeStorage;
}
