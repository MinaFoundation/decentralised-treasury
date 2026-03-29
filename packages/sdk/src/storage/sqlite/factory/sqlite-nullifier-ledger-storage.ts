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
  const counter = new KeyvSqliteCounter(sqliteStore);
  const nullifierKeyv = new Keyv({ store: sqliteStore });
  nullifierKeyv.disconnect = async () => {};
  const merkleTreeKeyv = new Keyv({ store: sqliteStore });
  merkleTreeKeyv.disconnect = async () => {};
  const nullifierStorage = new KeyvVoteNullifierStorage(
    nullifierKeyv,
    lifecycleId,
    counter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    merkleTreeKeyv,
    lifecycleId,
    "nullifier-ledger",
    counter,
  );

  return { nullifierStorage, merkleTreeStorage };
}
