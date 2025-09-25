import { VoteAction } from "../src/provable/contracts/treasury-proposal/vote-reducer.js";

export function createDummyVoteActions(count: number) {
  return Array.from({ length: count }, () => VoteAction.dummy());
}
