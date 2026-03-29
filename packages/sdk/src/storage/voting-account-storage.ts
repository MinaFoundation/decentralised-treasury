import { VotingAccount } from "../provable/voting-account.js";
import { KeyValueEntry } from "./key-value-storage.js";

export interface VotingAccountStorage {
  namespace: string;
  getVotingAccount(publicKey: string): Promise<VotingAccount | undefined>;
  setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount,
  ): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
