import { SideLoadedVoteReducerProof } from "../provable/contracts/treasury-proposal/vote-reducer.js";
import { MergeProofStorage } from "../proving/prover/merge-proof-orchestrator.js";
import { BatchStorage } from "./batch-storage.js";

export interface VoteReducerProofStorage
  extends MergeProofStorage<SideLoadedVoteReducerProof>,
    BatchStorage {
  close(): Promise<void>;
}
