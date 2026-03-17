import { KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../../keyv/keyv-staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { SqliteCounter } from "../sqlite-counter.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
  lifecycleId: string,
): KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage {
  const dbPath = getSqliteDbPath(lifecycleId);
  return new KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage(
    createSqliteKeyv(dbPath),
    lifecycleId,
    new SqliteCounter(dbPath),
  );
}
