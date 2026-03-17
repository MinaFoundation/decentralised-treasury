import { KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../../keyv/keyv-staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage {
  const keyv = new Keyv({ store: sqliteStore, namespace: lifecycleId });
  keyv.disconnect = async () => {};
  const counter = new KeyvSqliteCounter(sqliteStore);
  return new KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage(
    keyv,
    lifecycleId,
    counter,
  );
}
