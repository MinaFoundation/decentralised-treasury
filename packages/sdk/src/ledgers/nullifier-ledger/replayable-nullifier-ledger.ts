import { PrefixedMerkleWitness256 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { NullifierLedger } from "./nullifier-ledger.js";
import { Recorder } from "../../utils/recorder.js";
import { Bool, Field } from "o1js";

export class ReplayableNullifierLedger implements NullifierLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness256[]>;
    nullifiers: Record<string, Bool[]>;
  }>();

  public constructor(
    public witnesses: Record<string, PrefixedMerkleWitness256[]>,
    public nullifiers: Record<string, Bool[]>
  ) {
    this.recorder.recordings["witnesses"] = witnesses;
    this.recorder.recordings["nullifiers"] = nullifiers;
  }

  public async getWitness(
    publicKey: string
  ): Promise<PrefixedMerkleWitness256> {
    return (
      this.recorder.getRecorded("witnesses", publicKey) ??
      PrefixedMerkleWitness256.empty()
    );
  }

  public async getNullifier(publicKey: string): Promise<Bool> {
    return (
      this.recorder.getRecorded("nullifiers", publicKey) ?? Bool(false)
    );
  }

  public async setNullifier(
    publicKey: string,
    nullifier: Bool
  ): Promise<void> {
    // noop, due to being called within circuits, even when in "replay mode"
  }

  public async setLeaf(publicKey: string, leaf: Bool): Promise<void> {
    // noop, due to being called within circuits, even when in "replay mode"
  }

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    throw new Error("Not supported");
  }
}
