import { it } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import { ACCOUNT_BATCH_SIZE } from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { SqliteStakingLedgerService } from "../../src/services/sqlite/sqlite-staking-ledger-service.js";
import { SqliteStakingLedgerToVotingLedgerService } from "../../src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { testWorkerChildProcess } from "../proving/test-queue.js";

const MINI_LEDGER_PATH = "test/test-ledger-mini.json";
const EXPECTED_MINI_LEDGER_ROOT =
  "3982835709504547613460178343351902306072230308795146598392355811214701294803";

it("composes staking services and exercises full staking-to-voting flow", async () => {
  const lifecycleId = "integration-service-composition";
  const redisServer = new RedisMemoryServer();
  const redisConnection = {
    host: await redisServer.getHost(),
    port: await redisServer.getPort(),
  };
  const queueName = `${lifecycleId}-queue`;
  const stakingLedgerService = new SqliteStakingLedgerService({
    lifecycleId,
  });
  const stakingLedgerToVotingLedgerService =
    new SqliteStakingLedgerToVotingLedgerService({
      lifecycleId,
      redisConnection,
      queueName,
    });
  const workerProcess = testWorkerChildProcess(queueName, {
    ...redisConnection,
    maxRetriesPerRequest: null,
  });

  try {
    await stakingLedgerService.start();
    await stakingLedgerToVotingLedgerService.start();
    await stakingLedgerToVotingLedgerService.compile({ proofsEnabled: true });

    await stakingLedgerService.hydrateAccounts({
      stakingLedgerPath: MINI_LEDGER_PATH,
      startIndex: 0,
      endIndex: 9,
    });
    await stakingLedgerService.hydrateMerkleTree({
      startIndex: 0,
      endIndex: 9,
    });

    const root = await stakingLedgerService.getRootHash();
    assert.strictEqual(root.toString(), EXPECTED_MINI_LEDGER_ROOT);

    const hydratedAccountCount = 10;
    const expectedTraceCount = Math.ceil(hydratedAccountCount / ACCOUNT_BATCH_SIZE);
    const maxTraceIndex = expectedTraceCount - 1;

    let tracedCount = 0;
    await stakingLedgerToVotingLedgerService.traceDigest(0, maxTraceIndex, () => {
      tracedCount += 1;
    });
    assert.strictEqual(
      tracedCount,
      expectedTraceCount,
      "expected trace count to match hydrated accounts and batch size",
    );

    let digestedCount = 0;
    await stakingLedgerToVotingLedgerService.proveDigest(0, maxTraceIndex, () => {
      digestedCount += 1;
    });
    assert.strictEqual(
      digestedCount,
      tracedCount,
      "expected proved digest count to match trace count",
    );

    const mergedProof = await stakingLedgerToVotingLedgerService.proveMerge();
    assert(mergedProof, "expected merged proof to be returned");
  } finally {
    workerProcess.kill();
    await stakingLedgerToVotingLedgerService.close();
    await stakingLedgerService.close();
    await redisServer.stop();
  }
});
