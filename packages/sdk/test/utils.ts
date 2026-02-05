import { Bool, Field, Reducer } from "o1js";
import {
  ActionStateHistory,
  VoteAction,
} from "../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { appendActionToHashList } from "../src/provable/hashing-helpers.js";

export function createDummyVoteActions(count: number) {
  return Array.from({ length: count }, () => VoteAction.dummy());
}

export function buildActionStateHistory(actions: VoteAction[]) {
  let actionHash = Reducer.initialActionState;
  const hashes: Field[] = [];

  for (const action of actions) {
    if (!action || VoteAction.isDummy(action).toBoolean()) {
      hashes.push(Reducer.initialActionState);
      continue;
    }

    actionHash = appendActionToHashList(actionHash, VoteAction.toFields(action));
    hashes.push(actionHash);
  }

  while (hashes.length < 5) {
    hashes.push(Reducer.initialActionState);
  }

  hashes.reverse();

  return new ActionStateHistory({
    actionStateOne: { hash: hashes[0], found: Bool(false) },
    actionStateTwo: { hash: hashes[1], found: Bool(false) },
    actionStateThree: { hash: hashes[2], found: Bool(false) },
    actionStateFour: { hash: hashes[3], found: Bool(false) },
    actionStateFive: { hash: hashes[4], found: Bool(false) },
  });
}
