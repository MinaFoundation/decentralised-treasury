import { StakingLedgerToVotingLedgerDigestTask } from "./staking-ledger-to-voting-ledger-digest-task.js";
import { StakingLedgerToVotingLedgerMergeTask } from "./staking-ledger-to-voting-ledger-merge-task.js";
import { VoteReducerRunBatchTask } from "./vote-reducer-run-batch-task.js";
import { VoteReducerMergeTask } from "./vote-reducer-merge-task.js";

export const tasks = {
  stakingLedgerToVotingLedgerDigest: StakingLedgerToVotingLedgerDigestTask,
  stakingLedgerToVotingLedgerMerge: StakingLedgerToVotingLedgerMergeTask,
  voteReducerRunBatch: VoteReducerRunBatchTask,
  voteReducerMerge: VoteReducerMergeTask,
};

export default tasks;
