import { it } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import { SqliteStakingLedgerToVotingLedgerService } from "../../src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";

it("supports compile", async () => {
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId: "sqlite-staking-ledger-to-voting-ledger-service-compile",
    redisConnection: { host: "127.0.0.1", port: 6379 },
  });

  await service.compile({ proofsEnabled: false });
});

it("creates tracer in start and defers prover/task queue to proving", async () => {
  const redisServer = new RedisMemoryServer();
  const redisConnection = {
    host: await redisServer.getHost(),
    port: await redisServer.getPort(),
  };
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId: "sqlite-staking-ledger-to-voting-ledger-service",
    redisConnection,
  });
  await service.start();

  // start() should only initialize tracing dependencies.
  assert((service as any).tracer, "expected tracer to be initialized");
  assert.strictEqual((service as any).prover, undefined);
  assert.strictEqual((service as any).taskQueue, undefined);

  await service.close();
  await redisServer.stop();
});
