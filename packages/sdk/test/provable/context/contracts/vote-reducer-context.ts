import { Bool, Field, PublicKey, Reducer } from "o1js";
import { PersistentNullifierLedger } from "../../../../src/ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { PersistentVotingLedger } from "../../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { VotingLedger } from "../../../../src/ledgers/voting-ledger/voting-ledger.js";
import {
  ActionStateHistory,
  VoteReducer,
  VoteAction,
  voteReducerContext,
  ActionStateHistoryTarget,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import { createTestAccounts } from "../../../create-test-accounts.js";
import { appendActionToHashList } from "../../../../src/provable/hashing-helpers.js";
import { getProofsEnabled } from "../proofs-enabled.js";
import { createSqliteNullifierLedgerStorage } from "../../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";

function createInMemorySqliteStore(): KeyvSqlite {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const disconnect = store.disconnect.bind(store);
  store.disconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_MISUSE"
      ) {
        return;
      }
      throw error;
    }
  };
  return store;
}

function createLedgers(lifecycleId: string) {
  const sqlite = createInMemorySqliteStore();
  const votingLedgerStorage = createSqliteVotingLedgerStorage(
    lifecycleId,
    sqlite,
  );
  const votingLedger = new PersistentVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(
    lifecycleId,
    sqlite,
  );
  const nullifierLedger = new PersistentNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );
  return { sqlite, votingLedger, nullifierLedger };
}

async function seedVotingLedger(
  votingLedger: VotingLedger,
  accountCount: number,
) {
  const testAccounts = await createTestAccounts(accountCount);

  for (const account of testAccounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.pk.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
  }

  return testAccounts;
}

export async function createVoteReducerTestContext(
  options: { lifecycleId?: string; accountCount?: number } = {},
) {
  const compile = async (
    options: Parameters<typeof VoteReducer.compile>[0] = {},
  ) => {
    return await VoteReducer.compile({
      proofsEnabled: getProofsEnabled(),
      ...options,
    });
  };

  const createDummyVoteActions = (count: number) => {
    return Array.from({ length: count }, () => VoteAction.dummy());
  };

  const buildActionStateHistoryTarget = (actions: VoteAction[]) => {
    let actionHash = Reducer.initialActionState;
    const hashes: Field[] = [];

    for (const action of actions) {
      if (!action || VoteAction.isDummy(action).toBoolean()) {
        hashes.push(Reducer.initialActionState);
        continue;
      }

      actionHash = appendActionToHashList(
        actionHash,
        VoteAction.toFields(action),
      );
      hashes.push(actionHash);
    }

    while (hashes.length < 5) {
      hashes.push(Reducer.initialActionState);
    }

    hashes.reverse();

    return new ActionStateHistoryTarget({
      actionStateOne: hashes[0],
      actionStateTwo: hashes[1],
      actionStateThree: hashes[2],
      actionStateFour: hashes[3],
      actionStateFive: hashes[4],
    });
  };

  const lifecycleId = options.lifecycleId ?? "0";

  const { sqlite, votingLedger, nullifierLedger } = createLedgers(lifecycleId);

  voteReducerContext.set({ votingLedger, nullifierLedger });

  const testAccounts = await seedVotingLedger(
    votingLedger,
    options.accountCount ?? 10,
  );

  const createExpectedNullifierLedger = async (fromAccounts: PublicKey[]) => {
    const expectedSqlite = createInMemorySqliteStore();
    const expectedLedgerStorage = createSqliteNullifierLedgerStorage(
      lifecycleId,
      expectedSqlite,
    );
    const expectedLedger = new PersistentNullifierLedger(
      expectedLedgerStorage.nullifierStorage,
      expectedLedgerStorage.merkleTreeStorage,
    );
    for (const account of testAccounts) {
      await expectedLedger.setLeaf(account.pk.toBase58(), Bool(false));
    }
    const closeExpectedLedger = expectedLedger.close.bind(expectedLedger);
    expectedLedger.close = async () => {
      await closeExpectedLedger();
      await expectedSqlite.disconnect();
    };
    return expectedLedger;
  };

  const cleanup = async () => {
    await votingLedger.close();
    await nullifierLedger.close();
    await sqlite.disconnect();
  };

  return {
    getProofsEnabled,
    compile,
    createDummyVoteActions,
    buildActionStateHistoryTarget,
    votingLedger,
    nullifierLedger,
    testAccounts,
    createExpectedNullifierLedger,
    cleanup,
  };
}
