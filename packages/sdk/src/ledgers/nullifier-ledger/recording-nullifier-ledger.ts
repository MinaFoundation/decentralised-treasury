import { PrefixedMerkleWitness256 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { Recorder } from "../../utils/recorder.js";
import { NullifierLedger } from "./nullifier-ledger.js";
import { Bool, Field } from "o1js";

export class RecordingNullifierLedger implements NullifierLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness256[]>;
    nullifiers: Record<string, Bool[]>;
  }>();

  public constructor(public nullifierLedger: NullifierLedger) {}

  public async getWitness(
    publicKey: string
  ): Promise<PrefixedMerkleWitness256> {
    const witness = await this.nullifierLedger.getWitness(publicKey);
    this.recorder.record("witnesses", publicKey, witness);
    return witness;
  }

  public async getNullifier(publicKey: string): Promise<Bool> {
    const nullifier = await this.nullifierLedger.getNullifier(publicKey);
    this.recorder.record("nullifiers", publicKey, nullifier);
    return nullifier;
  }

  public async setNullifier(
    publicKey: string,
    nullifier: Bool
  ): Promise<void> {
    await this.nullifierLedger.setNullifier(publicKey, nullifier);
  }

  public async setLeaf(publicKey: string, leaf: Bool): Promise<void> {
    await this.nullifierLedger.setLeaf(publicKey, leaf);
  }

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    await this.nullifierLedger.close();
  }
}
