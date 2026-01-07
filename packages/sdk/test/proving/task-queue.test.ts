import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { Queue, QueueEvents, Job } from "bullmq";
import IORedis from "ioredis";
import { Task, TaskQueue } from "../../src/proving/task-queue.js";
import { Worker } from "../../src/proving/worker.js";
import { uuid } from "zod";
import { randomUUID } from "node:crypto";
import assert from "node:assert";
import { testTaskQueue } from "./test-queue.js";

const { queue, killWorkers, redisServer } = await testTaskQueue();
const taskCount = 5;

it("should complete a task queue roundtrip", async () => {
  const results = [];
  const inputs = [];

  queue.onTaskComplete("test", (job, output) => {
    results.push(output);
  });

  for (let i = 0; i < taskCount; i++) {
    const input = { foo: randomUUID() };
    console.log("adding task", input.foo);
    inputs.push(input);
    await queue.addTask("test", input);
  }

  await new Promise<void>(async (resolve) => {
    while (results.length < taskCount) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    resolve();
  });

  assert(
    results.length === taskCount && results.length === inputs.length,
    "results length does not match task count"
  );

  for (let i = 0; i < taskCount; i++) {
    assert(results[i].bar === inputs[i].foo, "result does not match input");
  }

  killWorkers();
  await queue.close();
  await redisServer.stop();
});
