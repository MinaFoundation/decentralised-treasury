import { it } from "node:test";
import assert from "node:assert";
import { SqliteStakingLedgerService } from "../../src/services/sqlite/sqlite-staking-ledger-service.js";
import { SqliteStakingLedgerToVotingLedgerService } from "../../src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";

const MINI_LEDGER_PATH = "test/test-ledger-mini.json";
const EXPECTED_MINI_LEDGER_ROOT =
  "3982835709504547613460178343351902306072230308795146598392355811214701294803";

it("supports compile, hydration and root hash with sqlite", async () => {
  const lifecycleId = "sqlite-staking-ledger-service";
  const service = new SqliteStakingLedgerService({
    lifecycleId,
    inMemory: true,
  });
  const stakingLedgerToVotingLedgerService =
    new SqliteStakingLedgerToVotingLedgerService({
      lifecycleId: "sqlite-staking-ledger-service",
      redisConnection: { host: "127.0.0.1", port: 6379 },
    });

  await service.start();
  await stakingLedgerToVotingLedgerService.compile({ proofsEnabled: true });
  await service.hydrateAccounts({
    stakingLedgerPath: MINI_LEDGER_PATH,
    startIndex: 0,
    endIndex: 9,
  });
  await service.hydrateMerkleTree({
    startIndex: 0,
    endIndex: 9,
  });

  const rootHash = await service.getRootHash();
  assert.strictEqual(rootHash.toString(), EXPECTED_MINI_LEDGER_ROOT);

  await service.close();
});
