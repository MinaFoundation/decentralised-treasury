import { PublicKey } from "o1js";
import { VotingAccount } from "../provable/staking-ledger-to-voting-ledger.js";

export interface VotingAccountStorage {
  getVotingAccount(publicKey: string): Promise<VotingAccount | undefined>;
  setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void>;
  close(): Promise<void>;
}
