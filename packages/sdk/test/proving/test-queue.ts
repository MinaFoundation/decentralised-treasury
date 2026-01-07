import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { Queue, QueueEvents, Job } from "bullmq";
import IORedis, { RedisOptions } from "ioredis";
import { Task, TaskQueue } from "../../src/proving/task-queue.js";
import { Worker } from "../../src/proving/worker.js";
import { uuid } from "zod";
import { randomUUID } from "node:crypto";
import assert from "node:assert";
import { ChildProcess, spawn } from "node:child_process";
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

export const tasks: Record<string, Task<unknown, unknown>> = {
  stakingLedgerToVotingLedgerDigest: StakingLedgerToVotingLedgerDigestTask,
  stakingLedgerToVotingLedgerMerge: StakingLedgerToVotingLedgerMergeTask,
  test: TestTask,
};

export async function testTaskQueue(workerCount = 1): Promise<{
  queue: TaskQueue<Record<string, Task<unknown, unknown>>>;
  workerProcesses: ChildProcess[];
  redisServer: RedisMemoryServer;
  killWorkers: () => void;
}> {
  const redisServer = new RedisMemoryServer();

  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  const queueName = "test-queue";

  const redisConnection = {
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
  };

  console.log("redis connection", redisConnection);

  const queue = new TaskQueue(queueName, tasks, redisConnection);

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
    redisServer,
    workerProcesses,
    killWorkers,
  };
}
