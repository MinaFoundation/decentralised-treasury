import { it } from "node:test";
import assert from "node:assert";
import { readLedger } from "../../src/read-ledger.js";
import { StakingLedgerToVotingLedgerDigestTracer } from "../../src/proving/tracing/staking-ledger-to-voting-ledger-digest-tracer.js";
import { StakingLedgerToVotingLedgerDigestTask } from "../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account, Provable } from "o1js";
import { DockerTaskQueue } from "../../src/proving/docker-task-queue.js";
import { writeFileSync } from "node:fs";
import { VotingAccountInMemoryService } from "../../src/services/voting-account-service.js";
import {
  MerkleTree256InMemoryService,
  PrefixedMerkleTree36InMemoryService,
} from "../../src/services/merkle-tree-service.js";

const MAX_TEST_ACCOUNTS = ACCOUNT_BATCH_SIZE * 3;
it("should digest a staking ledger to voting ledger", async () => {
  let accounts = await readLedger("test/provable/staking-epoch-ledger.json");
  // accounts = accounts.slice(0, MAX_TEST_ACCOUNTS);

  console.log("preparing task");
  stakingLedgerToVotingLedgerContext.set({
    stakingLedgerTree: new PrefixedMerkleTree36InMemoryService(),
    votingLedgerTree: new MerkleTree256InMemoryService(),
    votingAccounts: new VotingAccountInMemoryService(),
  });
  console.time("compile");
  await StakingLedgerToVotingLedgerDigestTask.prepare();
  console.timeEnd("compile");

  console.log("loaded", accounts.length, "accounts");
  const traces = await StakingLedgerToVotingLedgerDigestTracer.trace(accounts);

  const workerFile =
    `${process.cwd()}/test/integration/test-task-worker.ts`.slice(1);
  const taskQueue = new DockerTaskQueue(3);
  await taskQueue.setupWorkers(workerFile);

  // TODO: write traces to file
  for (const trace of traces) {
    const task = new StakingLedgerToVotingLedgerDigestTask();
    task.input = trace;
    await taskQueue.addTask(task);
  }

  // await new Promise((resolve) => setTimeout(resolve, 60000));

  let completedTasks = 0;
  taskQueue.onTaskComplete = async (task) => {
    Provable.log(
      "task completed",
      task.id,
      completedTasks,
      "/",
      traces.length - 1
    );
    completedTasks++;
  };

  await taskQueue.workTasks();

  await taskQueue.waitUntilEmpty();

  await taskQueue.killWorkers();

  Provable.log("completed tasks", completedTasks);
});
