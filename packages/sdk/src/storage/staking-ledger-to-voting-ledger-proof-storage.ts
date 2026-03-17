import { SideLoadedStakingLedgerToVotingLedgerProof } from "../provable/staking-ledger-to-voting-ledger.js";
import { BatchStorage } from "./batch-storage.js";
import { MergeProofStorage } from "../proving/prover/merge-proof-orchestrator.js";

export interface StakingLedgerToVotingLedgerProofStorage
  extends MergeProofStorage<SideLoadedStakingLedgerToVotingLedgerProof>,
    BatchStorage {
  close(): Promise<void>;
}
