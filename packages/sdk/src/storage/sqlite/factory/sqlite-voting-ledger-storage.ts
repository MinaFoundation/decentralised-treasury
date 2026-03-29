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
  const counter = new KeyvSqliteCounter(sqliteStore);
  const votingAccountKeyv = new Keyv({ store: sqliteStore });
  votingAccountKeyv.disconnect = async () => {};
  const merkleTreeKeyv = new Keyv({ store: sqliteStore });
  merkleTreeKeyv.disconnect = async () => {};

  const votingAccountStorage = new KeyvVotingAccountStorage(
    votingAccountKeyv,
    lifecycleId,
    counter,
  );
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    merkleTreeKeyv,
    lifecycleId,
    "voting-ledger",
    counter,
  );

  return { votingAccountStorage, merkleTreeStorage };
}
