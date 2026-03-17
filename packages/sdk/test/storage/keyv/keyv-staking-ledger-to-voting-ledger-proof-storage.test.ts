import { it } from "node:test";
import { KeyvStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { KeyvKeyValueBatchStorage } from "../../../src/storage/keyv/keyv-key-value-batch-storage.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

const createKeyvClient = (lifecycleId: string) => {
  return createSqliteKeyv(getSqliteDbPath(lifecycleId));
};

it("should store a proof", async () => {
  const lifecycleId = `test-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const proofStorage = new KeyvStakingLedgerToVotingLedgerProofStorage(
    () => createKeyvClient(lifecycleId),
    "test-namespace",
    counter,
  );
  const batchWriter = new KeyvKeyValueBatchStorage(createKeyvClient(lifecycleId));

  const proof = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    StakingLedgerToVotingLedgerProgramInput.empty(),
    StakingLedgerToVotingLedgerProgramOutput.empty(),
    0,
  );
  await proofStorage.setProof("test-id", proof);
  await batchWriter.setMany(proofStorage.collectEntries());
  proofStorage.clearEntries();

  const storedProof = await proofStorage.getProof("test-id");
  Provable.log("storedProof", storedProof);

  await batchWriter.close();
  await proofStorage.close();
});
