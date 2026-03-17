import { BatchStorage } from "../../storage/batch-storage.js";
import { KeyValueEntry } from "../../storage/key-value-storage.js";
import { InMemoryMerkleTreeStorage } from "../../storage/in-memory/in-memory-merkle-tree-storage.js";
import { InMemoryVotingAccountStorage } from "../../storage/in-memory/in-memory-voting-account-storage.js";
import { PersistentVotingLedger } from "./persistent-voting-ledger.js";

export class InMemoryVotingLedger
  extends PersistentVotingLedger
  implements BatchStorage
{
  public constructor(
    public votingAccountStorage: InMemoryVotingAccountStorage,
    public merkleTreeStorage: InMemoryMerkleTreeStorage,
  ) {
    super(votingAccountStorage, merkleTreeStorage);
  }

  public collectEntries(): Array<KeyValueEntry> {
    return [
      ...this.votingAccountStorage.collectEntries(),
      ...this.merkleTreeStorage.collectEntries(),
    ];
  }

  public clearEntries(): void {
    this.votingAccountStorage.clearEntries();
    this.merkleTreeStorage.clearEntries();
  }
}
