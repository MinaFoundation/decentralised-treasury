import { VotingAccount } from "../../provable/voting-account.js";
import { PrefixedMerkleWitness256 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { Recorder } from "../../utils/recorder.js";
import { VotingLedger } from "./voting-ledger.js";
import { Field } from "o1js";

export class RecordingVotingLedger implements VotingLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness256[]>;
    votingAccounts: Record<string, VotingAccount[]>;
  }>();

  public constructor(public votingLedger: VotingLedger) {}

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness256> {
    const witness = await this.votingLedger.getWitness(index);
    this.recorder.record("witnesses", index.toString(), witness);
    return witness;
  }

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    const votingAccount = await this.votingLedger.getVotingAccount(publicKey);
    this.recorder.record("votingAccounts", publicKey, votingAccount);
    return votingAccount;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    await this.votingLedger.setVotingAccount(publicKey, votingAccount);
  }

  public async setLeaf(index: bigint, leaf: VotingAccount): Promise<void> {
    await this.votingLedger.setLeaf(index, leaf);
  }

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    await this.votingLedger.close();
  }
}
