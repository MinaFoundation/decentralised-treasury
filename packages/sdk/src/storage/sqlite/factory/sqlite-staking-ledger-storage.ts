import { KeyvAccountStorage } from "../../keyv/keyv-account-storage.js";
import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { StakingLedgerStorage } from "../../staking-ledger-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteStakingLedgerStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): StakingLedgerStorage<KeyvAccountStorage, KeyvMerkleTreeStorage> {
  const namespace = `staking-ledger-${lifecycleId}`;
  const counter = new KeyvSqliteCounter(sqliteStore);
  const accountKeyv = new Keyv({ store: sqliteStore, namespace });
  accountKeyv.disconnect = async () => {};
  const merkleTreeKeyv = new Keyv({ store: sqliteStore, namespace });
  merkleTreeKeyv.disconnect = async () => {};
  const accountStorage = new KeyvAccountStorage(
    accountKeyv,
    namespace,
    counter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    merkleTreeKeyv,
    namespace,
    counter,
  );

  return { accountStorage, merkleTreeStorage };
}
