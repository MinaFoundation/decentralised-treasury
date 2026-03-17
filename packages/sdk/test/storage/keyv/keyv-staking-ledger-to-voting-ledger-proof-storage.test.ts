import { it } from "node:test";
import { KeyvStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";
import { KeyvSqliteCounter } from "../../../src/storage/sqlite/keyv-sqlite-counter.js";
import { KeyvKeyValueBatchStorage } from "../../../src/storage/keyv/keyv-key-value-batch-storage.js";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";

it("should store a proof", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const createKeyvClient = () => {
    const keyv = new Keyv({ store });
    keyv.disconnect = async () => {};
    return keyv;
  };
  const proofStorage = new KeyvStakingLedgerToVotingLedgerProofStorage(
    createKeyvClient,
    "test-namespace",
    new KeyvSqliteCounter(store),
  );
  const batchWriter = new KeyvKeyValueBatchStorage(createKeyvClient());

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
  await store.disconnect();
});
