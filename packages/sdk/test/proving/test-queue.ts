import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { Queue, QueueEvents, Job } from "bullmq";
import IORedis from "ioredis";
import { Task, TaskQueue } from "../../src/proving/task-queue.js";
import { Worker } from "../../src/proving/worker.js";
import { uuid } from "zod";
import { randomUUID } from "node:crypto";
import assert from "node:assert";

export async function testTaskQueue(
  tasks: Record<string, Task<unknown, unknown>>
) {
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
  const worker = new Worker(queueName, tasks, redisConnection);

  return {
    queue,
    worker,
    redisServer,
  };
}
