import { KeyvAccountStorage } from "../../keyv/keyv-account-storage.js";
import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { StakingLedgerStorage } from "../../staking-ledger-storage.js";
import { SqliteCounter } from "../sqlite-counter.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteStakingLedgerStorage(
  lifecycleId: string,
): StakingLedgerStorage<KeyvAccountStorage, KeyvMerkleTreeStorage> {
  const namespace = `staking-ledger-${lifecycleId}`;
  const dbPath = getSqliteDbPath(lifecycleId);
  const keyv = createSqliteKeyv(dbPath);
  const keyvCounter = new SqliteCounter(dbPath);
  const accountStorage = new KeyvAccountStorage(keyv, namespace, keyvCounter);
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    namespace,
    keyvCounter,
  );

  return { accountStorage, merkleTreeStorage };
}
