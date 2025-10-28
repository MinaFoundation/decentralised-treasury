import { StakingLedgerToVotingLedgerDigestTask } from "../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TaskWorker } from "../../src/proving/task-worker.js";
import { Task } from "../../src/proving/task-queue.js";
import { stakingLedgerToVotingLedgerContext } from "../../src/provable/staking-ledger-to-voting-ledger.js";
import {
  MerkleTree256InMemoryService,
  PrefixedMerkleTree36InMemoryService,
} from "../../src/services/merkle-tree-service.js";
import { VotingAccountInMemoryService } from "../../src/services/voting-account-service.js";

const tasks: Record<string, Task<any, any>> = {
  ["staking-ledger-to-voting-ledger-digest"]:
    new StakingLedgerToVotingLedgerDigestTask(),
};

const port = parseInt(process.argv[2]);
const taskWorker = new TaskWorker(port, tasks);
console.log("task worker port", port);

stakingLedgerToVotingLedgerContext.set({
  stakingLedgerTree: new PrefixedMerkleTree36InMemoryService(),
  votingLedgerTree: new MerkleTree256InMemoryService(),
  votingAccounts: new VotingAccountInMemoryService(),
});

await StakingLedgerToVotingLedgerDigestTask.prepare();

await taskWorker.start();
