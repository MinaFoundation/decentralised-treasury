import { AccountStorage } from "../../account-storage.js";
import { MerkleTreeStorage } from "../../merkle-tree-storage.js";
import { StakingLedgerStorage } from "../../staking-ledger-storage.js";
import { InMemoryMerkleTreeStorage } from "../in-memory-merkle-tree-storage.js";

export interface InMemoryStakingLedgerStorage
  extends StakingLedgerStorage<AccountStorage, InMemoryMerkleTreeStorage> {}

export function createInMemoryStakingLedgerStorage(
  parentStorage: StakingLedgerStorage<AccountStorage, MerkleTreeStorage>,
): InMemoryStakingLedgerStorage {
  return {
    accountStorage: parentStorage.accountStorage,
    merkleTreeStorage: new InMemoryMerkleTreeStorage(
      parentStorage.merkleTreeStorage,
    ),
  };
}
