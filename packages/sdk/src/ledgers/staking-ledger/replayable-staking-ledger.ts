import { PrefixedMerkleWitness36 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { Account } from "../../provable/account.js";
import { StakingLedger } from "./staking-ledger.js";
import { Recorder } from "../../utils/recorder.js";
import { Field } from "o1js";

export class ReplayableStakingLedger implements StakingLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness36[]>;
  }>();

  public constructor(
    public witnesses: Record<string, PrefixedMerkleWitness36[]>
  ) {
    this.recorder.recordings["witnesses"] = witnesses;
  }

  public async getAllAccounts(): Promise<Account[]> {
    throw new Error("Not supported");
  }

  public async accountCount(): Promise<number> {
    throw new Error("Not supported");
  }

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    return (
      this.recorder.getRecorded("witnesses", index.toString()) ??
      PrefixedMerkleWitness36.empty()
    );
  }

  public async getAccount(index: bigint): Promise<Account> {
    throw new Error("Not supported");
  }

  public async setAccount(index: bigint, account: Account): Promise<void> {
    throw new Error("Not supported");
  }

  public async setLeaf(index: bigint, leaf: Account): Promise<void> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    throw new Error("Not supported");
  }
}
