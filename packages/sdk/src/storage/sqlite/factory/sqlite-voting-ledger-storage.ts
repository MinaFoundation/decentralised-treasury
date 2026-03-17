import { KeyvMerkleTreeStorage } from "../../keyv/keyv-merkle-tree-storage.js";
import { KeyvVotingAccountStorage } from "../../keyv/keyv-voting-account-storage.js";
import { VotingLedgerStorage } from "../../voting-ledger-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteVotingLedgerStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): VotingLedgerStorage<KeyvVotingAccountStorage, KeyvMerkleTreeStorage> {
  const namespace = `voting-ledger-${lifecycleId}`;
  const counter = new KeyvSqliteCounter(sqliteStore);
  const votingAccountKeyv = new Keyv({ store: sqliteStore, namespace });
  votingAccountKeyv.disconnect = async () => {};
  const merkleTreeKeyv = new Keyv({ store: sqliteStore, namespace });
  merkleTreeKeyv.disconnect = async () => {};

  const votingAccountStorage = new KeyvVotingAccountStorage(
    votingAccountKeyv,
    namespace,
    counter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    merkleTreeKeyv,
    namespace,
    counter,
  );

  return { votingAccountStorage, merkleTreeStorage };
}
