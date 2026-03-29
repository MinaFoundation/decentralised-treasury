import assert from "node:assert";
import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import {
  spawnCliWorker,
  waitForExit,
  waitForOutput,
} from "./utils/cli-test-utils.js";

it("starts worker command with env-backed redis config", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const queueName = `cli-worker-${Date.now()}`;

  const workerProcess = spawnCliWorker(queueName, {
    redisHost,
    redisPort,
  });

  try {
    const output = await waitForOutput(workerProcess, "starting worker", 15000);
    assert(
      output.includes(queueName),
      "expected worker logs to include queue name",
    );
    assert.strictEqual(
      workerProcess.exitCode,
      null,
      "expected worker process to remain running",
    );
  } finally {
    workerProcess.kill("SIGTERM");
    await waitForExit(workerProcess, 5000);
    await redisServer.stop();
  }
});
