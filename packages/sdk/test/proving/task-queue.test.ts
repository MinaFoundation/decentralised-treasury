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
import { TestTaskOutput } from "./test-task.js";

const redisServer = new RedisMemoryServer();
const redisHost = await redisServer.getHost();
const redisPort = await redisServer.getPort();
const redisUrl = `redis://${redisHost}:${redisPort}`;

const { queue, killWorkers } = await testTaskQueue(1, redisHost, redisPort);
const taskCount = 5;

it("should complete a task queue roundtrip", async () => {
  const resultPromises = [];
  const inputs = [];
  const results: TestTaskOutput[] = [];

  for (let i = 0; i < taskCount; i++) {
    const input = { foo: randomUUID() };
    console.log("adding task", input.foo);
    inputs.push(input);
    const resultPromise = queue.addTask("test", input, async (result) => {
      results.push(result);
    });
    resultPromises.push(resultPromise);
  }

  await Promise.all(resultPromises);

  assert(
    results.length === taskCount && results.length === inputs.length,
    "results length does not match task count"
  );

  for (let i = 0; i < taskCount; i++) {
    assert(results[i].bar === inputs[i].foo, "result does not match input");
  }

  assert(
    queue.events.listenerCount("completed") === 0,
    "completed listener not removed"
  );

  killWorkers();
  await queue.close();
  await redisServer.stop();
});
