import type { VoteAction } from "../provable/contracts/treasury-proposal/vote-reducer.js";

export interface VoteReducerActionStateHistoryTargetSnapshot {
  actionStateOne: string;
  actionStateTwo: string;
  actionStateThree: string;
  actionStateFour: string;
  actionStateFive: string;
}

export interface FetchProposalActionsResult {
  proposalPublicKey: string;
  proposalTokenId: string;
  voteActions: VoteAction[];
  actionStateHistoryTarget: VoteReducerActionStateHistoryTargetSnapshot;
}
