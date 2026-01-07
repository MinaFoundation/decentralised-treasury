import { SideLoadedStakingLedgerToVotingLedgerProof } from "../provable/staking-ledger-to-voting-ledger.js";

export interface StakingLedgerToVotingLedgerProofStorage {
  getProof(
    id: string
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined>;
  setProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof
  ): Promise<void>;
  close(): Promise<void>;
}
