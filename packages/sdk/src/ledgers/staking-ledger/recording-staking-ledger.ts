import { PrefixedMerkleWitness36 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { StakingLedger } from "./staking-ledger.js";
import { Recorder } from "../../utils/recorder.js";
import { Account } from "../../provable/account.js";
import { Field } from "o1js";

export class RecordingStakingLedger implements StakingLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness36[]>;
  }>();

  public constructor(public stakingLedger: StakingLedger) {}

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    const witness = await this.stakingLedger.getWitness(index);
    this.recorder.record("witnesses", index.toString(), witness);
    return witness;
  }

  public async getAllAccounts(): Promise<Account[]> {
    throw new Error("Not supported");
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

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    await this.stakingLedger.close();
  }
}
