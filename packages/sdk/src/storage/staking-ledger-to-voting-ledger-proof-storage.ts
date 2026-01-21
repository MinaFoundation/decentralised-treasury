import { SideLoadedStakingLedgerToVotingLedgerProof } from "../provable/staking-ledger-to-voting-ledger.js";

export interface StakingLedgerToVotingLedgerProofStorage {
  getProof(
    id: string
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined>;

  setProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof
  ): Promise<void>;

  getMergeProof(
    id: string
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined>;

  setMergeProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof
  ): Promise<void>;

  markAsMerged(id: string): Promise<void>;
  isMerged(id: string): Promise<boolean>;

  mergeCount(): Promise<number>;
  count(): Promise<number>;

  close(): Promise<void>;
}
