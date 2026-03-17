import { Bool } from "o1js";
import { BaseNullifierLedger } from "./nullifier-ledger.js";
import { VoteNullifierStorage } from "../../storage/vote-nullifier-storage.js";
import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";

export class PersistentNullifierLedger extends BaseNullifierLedger {
  public constructor(
    public nullifierStorage: VoteNullifierStorage,
    merkleTreeStorage: MerkleTreeStorage
  ) {
    super(merkleTreeStorage);
  }

  public async getNullifier(publicKey: string): Promise<Bool> {
    const storedNullifier = await this.nullifierStorage.getNullifier(publicKey);
    return storedNullifier === undefined ? Bool(false) : Bool(storedNullifier);
  }

  public async setNullifier(publicKey: string, nullifier: Bool): Promise<void> {
    await this.nullifierStorage.setNullifier(publicKey, nullifier.toBoolean());
  }

  public async close(): Promise<void> {
    await this.nullifierStorage.close();
    await this.merkleTreeStorage.close();
  }
}
