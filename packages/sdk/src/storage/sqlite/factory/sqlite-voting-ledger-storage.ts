import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { KeyvVotingAccountStorage } from "../../keyv/keyv-voting-account-storage.js";
import { VotingLedgerStorage } from "../../voting-ledger-storage.js";
import { SqliteCounter } from "../sqlite-counter.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteVotingLedgerStorage(
  lifecycleId: string,
): VotingLedgerStorage<KeyvVotingAccountStorage, KeyvMerkleTreeStorage> {
  const namespace = `voting-ledger-${lifecycleId}`;
  const dbPath = getSqliteDbPath(lifecycleId);
  const keyv = createSqliteKeyv(dbPath);
  const keyvCounter = new SqliteCounter(dbPath);

  const votingAccountStorage = new KeyvVotingAccountStorage(
    keyv,
    namespace,
    keyvCounter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    namespace,
    keyvCounter,
  );

  return { votingAccountStorage, merkleTreeStorage };
}
