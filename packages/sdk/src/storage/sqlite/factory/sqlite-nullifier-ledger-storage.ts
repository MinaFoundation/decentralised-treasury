import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { KeyvVoteNullifierStorage } from "../../keyv/keyv-vote-nullifier-storage.js";
import { NullifierLedgerStorage } from "../../nullifier-ledger-storage.js";
import { SqliteCounter } from "../sqlite-counter.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteNullifierLedgerStorage(
  lifecycleId: string,
): NullifierLedgerStorage<KeyvVoteNullifierStorage, KeyvMerkleTreeStorage> {
  const namespace = `nullifier-ledger-${lifecycleId}`;
  const dbPath = getSqliteDbPath(lifecycleId);
  const keyv = createSqliteKeyv(dbPath);
  const keyvCounter = new SqliteCounter(dbPath);
  const nullifierStorage = new KeyvVoteNullifierStorage(
    keyv,
    `${namespace}-nullifiers`,
    keyvCounter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    `${namespace}-merkle-tree`,
    keyvCounter,
  );

  return { nullifierStorage, merkleTreeStorage };
}
