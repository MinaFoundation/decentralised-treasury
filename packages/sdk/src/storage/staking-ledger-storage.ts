import { AccountStorage } from "./account-storage.js";
import { MerkleTreeStorage } from "./merkle-tree-storage.js";

export interface StakingLedgerStorage<
  TAccountStorage extends AccountStorage = AccountStorage,
  TMerkleTreeStorage extends MerkleTreeStorage = MerkleTreeStorage,
> {
  accountStorage: TAccountStorage;
  merkleTreeStorage: TMerkleTreeStorage;
}
