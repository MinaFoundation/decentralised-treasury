import { RedisOptions } from "ioredis";
import { TaskQueue } from "../../src/proving/task-queue.js";
import { spawn } from "node:child_process";
import { StakingLedgerToVotingLedgerDigestTask } from "../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TestTask } from "./test-task.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../../src/proving/tasks/staking-ledger-to-voting-ledger-merge-task.js";

export function testWorkerChildProcess(
  queueName: string,
  connection: RedisOptions,
  workerFile = `test/proving/test-worker.ts`
) {
  const workerProcess = spawn(
    "node",
    [
      "--loader",
      "ts-node/esm",
      workerFile,
      queueName,
      connection.host,
      connection.port.toString(),
    ],
    {
      stdio: "inherit",
    }
  );

  return workerProcess;
}

export const tasks = {
  stakingLedgerToVotingLedgerDigest: StakingLedgerToVotingLedgerDigestTask,
  stakingLedgerToVotingLedgerMerge: StakingLedgerToVotingLedgerMergeTask,
  test: TestTask,
};

export async function testTaskQueue(
  workerCount = 1,
  redisHost: string,
  redisPort: number
) {
  const queueName = "test-queue";

  const redisConnection = {
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
  };

  const queue: TaskQueue<typeof tasks> = new TaskQueue(
    queueName,
    tasks,
    redisConnection
  );

  const workerProcesses = [];
  for (let i = 0; i < workerCount; i++) {
    workerProcesses.push(testWorkerChildProcess(queueName, redisConnection));
  }

  function killWorkers() {
    for (const workerProcess of workerProcesses) {
      workerProcess.kill();
    }
  }

  return {
    queue,
    workerProcesses,
    killWorkers,
  };
}
