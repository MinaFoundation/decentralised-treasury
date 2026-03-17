import { BatchStorage } from "../../storage/batch-storage.js";
import { InMemoryMerkleTreeStorage } from "../../storage/in-memory/in-memory-merkle-tree-storage.js";
import { InMemoryVoteNullifierStorage } from "../../storage/in-memory/in-memory-vote-nullifier-storage.js";
import { KeyValueEntry } from "../../storage/key-value-storage.js";
import { PersistentNullifierLedger } from "./persistent-nullifier-ledger.js";

export class InMemoryNullifierLedger
  extends PersistentNullifierLedger
  implements BatchStorage
{
  public constructor(
    public nullifierStorage: InMemoryVoteNullifierStorage,
    public merkleTreeStorage: InMemoryMerkleTreeStorage,
  ) {
    super(nullifierStorage, merkleTreeStorage);
  }

  public collectEntries(): Array<KeyValueEntry> {
    return [
      ...this.nullifierStorage.collectEntries(),
      ...this.merkleTreeStorage.collectEntries(),
    ];
  }

  public clearEntries(): void {
    this.nullifierStorage.clearEntries();
    this.merkleTreeStorage.clearEntries();
  }
}
