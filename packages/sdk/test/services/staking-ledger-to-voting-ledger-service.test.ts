import { it } from "node:test";
import {
  StakingLedgerToVotingLedgerTaskQueue,
  StakingLedgerToVotingLedgerService,
} from "../../src/services/staking-ledger-to-voting-ledger-service.js";
import { StakingLedgerToVotingLedgerDigestTask } from "../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { testTaskQueue } from "../proving/test-queue.js";
import { Provable } from "o1js";
import { ACCOUNT_BATCH_SIZE } from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { writeFileSync } from "fs";

const stakingLedgerPath = "test/provable/staking-epoch-ledger.json";
const tracesPath = "test/provable/staking-ledger-to-voting-ledger-traces.json";

it("should digest a staking ledger to a voting ledger", async () => {
  const numberOfWorkers = 1;
  const { queue, killWorkers, redisServer } =
    await testTaskQueue(numberOfWorkers);

  const service = new StakingLedgerToVotingLedgerService(
    queue as StakingLedgerToVotingLedgerTaskQueue
  );

  await StakingLedgerToVotingLedgerDigestTask.prepare();

  const fromIndex = 0;
  // const toIndex = ACCOUNT_BATCH_SIZE * 3;
  // this would be the full lightnet ledger
  // const toIndex = 1010;
  const toIndex = ACCOUNT_BATCH_SIZE * 10;

  // digest only a subset of the ledger to test the tracing and digesting
  const proof = await service.digestLedger(stakingLedgerPath, tracesPath, {
    fromIndex,
    toIndex,
    // // if the index range changes, traces need to be regenerated
    // forceTrace: false,
  });

  Provable.log("proof", proof);

  writeFileSync(
    `test/provable/staking-ledger-to-voting-ledger-service-proof-${fromIndex}-${toIndex}.json`,
    JSON.stringify(proof.toJSON())
  );

  await queue.waitUntilEmpty();
  killWorkers();
  await queue.close();
  await redisServer.stop();
});
