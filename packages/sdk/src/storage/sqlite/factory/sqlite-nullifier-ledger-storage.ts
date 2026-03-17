import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { KeyvVoteNullifierStorage } from "../../keyv/keyv-vote-nullifier-storage.js";
import { NullifierLedgerStorage } from "../../nullifier-ledger-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteNullifierLedgerStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): NullifierLedgerStorage<KeyvVoteNullifierStorage, KeyvMerkleTreeStorage> {
  const namespace = `nullifier-ledger-${lifecycleId}`;
  const counter = new KeyvSqliteCounter(sqliteStore);
  const nullifierKeyv = new Keyv({
    store: sqliteStore,
    namespace: `${namespace}-nullifiers`,
  });
  nullifierKeyv.disconnect = async () => {};
  const merkleTreeKeyv = new Keyv({
    store: sqliteStore,
    namespace: `${namespace}-merkle-tree`,
  });
  merkleTreeKeyv.disconnect = async () => {};
  const nullifierStorage = new KeyvVoteNullifierStorage(
    nullifierKeyv,
    `${namespace}-nullifiers`,
    counter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    merkleTreeKeyv,
    `${namespace}-merkle-tree`,
    counter,
  );

  return { nullifierStorage, merkleTreeStorage };
}
