import { KeyvStakingLedgerToVotingLedgerProofStorage } from "../../keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteStakingLedgerToVotingLedgerProofStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): KeyvStakingLedgerToVotingLedgerProofStorage {
  const createKeyv = () => {
    const keyv = new Keyv({ store: sqliteStore });
    keyv.disconnect = async () => {};
    return keyv;
  };
  const counter = new KeyvSqliteCounter(sqliteStore);
  return new KeyvStakingLedgerToVotingLedgerProofStorage(
    createKeyv,
    lifecycleId,
    counter,
  );
}
