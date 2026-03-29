import { KeyvStakingLedgerToVotingLedgerDigestTraceStorage } from "../../keyv/keyv-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): KeyvStakingLedgerToVotingLedgerDigestTraceStorage {
  const keyv = new Keyv({ store: sqliteStore });
  keyv.disconnect = async () => {};
  const counter = new KeyvSqliteCounter(sqliteStore);
  return new KeyvStakingLedgerToVotingLedgerDigestTraceStorage(
    keyv,
    lifecycleId,
    counter,
  );
}
