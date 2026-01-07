import { VotingAccount } from "../../provable/voting-account.js";
import { PrefixedMerkleWitness256 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingLedger } from "./voting-ledger.js";
import { Recorder } from "../../utils/recorder.js";
import { Field } from "o1js";

export class ReplayableVotingLedger implements VotingLedger {
  public recorder = new Recorder<{
    witnesses: Record<string, PrefixedMerkleWitness256[]>;
    votingAccounts: Record<string, VotingAccount[]>;
  }>();

  public constructor(
    public witnesses: Record<string, PrefixedMerkleWitness256[]>,
    public votingAccounts: Record<string, VotingAccount[]>
  ) {
    this.recorder.recordings["witnesses"] = witnesses;
    this.recorder.recordings["votingAccounts"] = votingAccounts;
  }

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness256> {
    return (
      this.recorder.getRecorded("witnesses", index.toString()) ??
      PrefixedMerkleWitness256.empty()
    );
  }

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    return (
      this.recorder.getRecorded("votingAccounts", publicKey) ??
      VotingAccount.empty()
    );
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    // noop, due to being called within circuits, even when in "replay mode"
  }

  public async setLeaf(index: bigint, leaf: VotingAccount): Promise<void> {
    // noop, due to being called within circuits, even when in "replay mode"
  }

  public async getRoot(): Promise<Field> {
    throw new Error("Not supported");
  }

  public async close(): Promise<void> {
    throw new Error("Not supported");
  }
}
