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

interface TestTaskInput {
  foo: string;
}

interface TestTaskOutput {
  bar: string;
}

const TestTask: Task<TestTaskInput, TestTaskOutput> = class {
  public static taskName = "test-task";

  public static async prepare() {}

  public static serializers = {
    input: async (input: TestTaskInput) => JSON.stringify(input),
    output: async (output: TestTaskOutput) => JSON.stringify(output),
  };

  public static deserializers = {
    input: async (input: string) => JSON.parse(input) as TestTaskInput,
    output: async (output: string) => JSON.parse(output) as TestTaskOutput,
  };

  public static async run(input: TestTaskInput): Promise<TestTaskOutput> {
    return {
      bar: input.foo,
    };
  }
};

const { queue, worker, redisServer } = await testTaskQueue({ test: TestTask });
const taskCount = 5;

it("should complete a task queue roundtrip", async () => {
  const results = [];
  const inputs = [];

  queue.onTaskComplete("test", (job, output) => {
    results.push(output);
  });

  for (let i = 0; i < taskCount; i++) {
    const input = { foo: randomUUID() };
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

  await worker.close();
  await queue.close();
  await redisServer.stop();
});
