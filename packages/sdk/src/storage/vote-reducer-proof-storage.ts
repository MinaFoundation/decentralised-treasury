import { SideLoadedVoteReducerProof } from "../provable/contracts/treasury-proposal/vote-reducer.js";
import { MergeProofStorage } from "../proving/prover/merge-proof-orchestrator.js";

export interface VoteReducerProofStorage
  extends MergeProofStorage<SideLoadedVoteReducerProof> {
  close(): Promise<void>;
}
