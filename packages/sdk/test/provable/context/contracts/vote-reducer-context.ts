import { Bool, Field, Reducer } from "o1js";
import { PersistentNullifierLedger } from "../../../../src/ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { PersistentVotingLedger } from "../../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { VotingLedger } from "../../../../src/ledgers/voting-ledger/voting-ledger.js";
import {
  ActionStateHistory,
  VoteReducer,
  VoteAction,
  voteReducerContext,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import { createTestAccounts } from "../../../create-test-accounts.js";
import { appendActionToHashList } from "../../../../src/provable/hashing-helpers.js";
import { getProofsEnabled } from "../proofs-enabled.js";
import { createSqliteNullifierLedgerStorage } from "../../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";

function createLedgers(lifecycleId: string) {
  const votingLedgerStorage = createSqliteVotingLedgerStorage(lifecycleId);
  const votingLedger = new PersistentVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(lifecycleId);
  const nullifierLedger = new PersistentNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );
  return { votingLedger, nullifierLedger };
}

async function seedLedgers(
  votingLedger: VotingLedger,
  nullifierLedger: PersistentNullifierLedger,
  accountCount: number,
) {
  const testAccounts = await createTestAccounts(accountCount);

  for (const account of testAccounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.pk.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
    await nullifierLedger.setLeaf(publicKey, Bool(false));
  }

  return testAccounts;
}

export function createVoteReducerTestContext() {
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

  const buildActionStateHistory = (actions: VoteAction[]) => {
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

    return new ActionStateHistory({
      actionStateOne: { hash: hashes[0], found: Bool(false) },
      actionStateTwo: { hash: hashes[1], found: Bool(false) },
      actionStateThree: { hash: hashes[2], found: Bool(false) },
      actionStateFour: { hash: hashes[3], found: Bool(false) },
      actionStateFive: { hash: hashes[4], found: Bool(false) },
    });
  };

  const createContext = async (
    options: { lifecycleId?: string; accountCount?: number } = {},
  ) => {
    const lifecycleId = options.lifecycleId ?? "vote-reducer-test";

    const { votingLedger, nullifierLedger } = createLedgers(lifecycleId);

    voteReducerContext.set({ votingLedger, nullifierLedger });

    const testAccounts = await seedLedgers(
      votingLedger,
      nullifierLedger,
      options.accountCount ?? 10,
    );

    const createExpectedNullifierLedger = async (suffix = "expected") => {
      const expectedLedgerStorage = createSqliteNullifierLedgerStorage(
        `${lifecycleId}-${suffix}`,
      );
      const expectedLedger = new PersistentNullifierLedger(
        expectedLedgerStorage.nullifierStorage,
        expectedLedgerStorage.merkleTreeStorage,
      );
      for (const account of testAccounts) {
        await expectedLedger.setLeaf(account.pk.toBase58(), Bool(false));
      }
      return expectedLedger;
    };

    const cleanup = async () => {
      await votingLedger.close();
      await nullifierLedger.close();
    };

    return {
      votingLedger,
      nullifierLedger,
      testAccounts,
      createExpectedNullifierLedger,
      cleanup,
    };
  };

  return {
    getProofsEnabled,
    compile,
    createDummyVoteActions,
    buildActionStateHistory,
    createContext,
  };
}
