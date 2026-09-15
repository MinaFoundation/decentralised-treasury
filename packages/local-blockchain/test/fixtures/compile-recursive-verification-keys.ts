import {
  VoteReducer,
  voteReducerContext,
} from "../../../sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import {
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "../../../sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { ReplayableVotingLedger } from "../../../sdk/src/ledgers/voting-ledger/replayable-voting-ledger.js";
import { ReplayableNullifierLedger } from "../../../sdk/src/ledgers/nullifier-ledger/replayable-nullifier-ledger.js";
import { ReplayableStakingLedger } from "../../../sdk/src/ledgers/staking-ledger/replayable-staking-ledger.js";
import { proofCache, proofsEnabled } from "../proof-mode.js";

// Compilation needs ledger context even though it does not consume a snapshot.
// These replayable ledgers follow the production compile service convention.
export async function compileRecursiveVerificationKeys() {
  voteReducerContext.set({
    votingLedger: new ReplayableVotingLedger({}, {}),
    nullifierLedger: new ReplayableNullifierLedger({}, {}),
  });
  stakingLedgerToVotingLedgerContext.set({
    stakingLedger: new ReplayableStakingLedger({}),
    votingLedger: new ReplayableVotingLedger({}, {}),
  });
  const reducer = await VoteReducer.compile({
    proofsEnabled,
    cache: proofCache,
  });
  const staking = await StakingLedgerToVotingLedger.compile({
    proofsEnabled,
    cache: proofCache,
  });
  return { reducer: reducer.verificationKey, staking: staking.verificationKey };
}
