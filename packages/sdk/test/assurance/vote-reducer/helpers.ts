import { KeyvSqlite } from "@keyv/sqlite";
import {
  Bool,
  Field,
  Poseidon,
  PrivateKey,
  Reducer,
  UInt64,
  prefixToField,
} from "o1js";
import { PersistentNullifierLedger } from "../../../src/ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { PersistentVotingLedger } from "../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  ActionStateHistoryTarget,
  VoteAction,
  VoteReducerPublicInput,
  VOTE_ACTION_BATCH_SIZE,
  voteReducerContext,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { createSqliteNullifierLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";

const balances = [3n, 5n, 8n, 13n, 21n, 34n] as const;
const eventPrefix = "MinaZkappEvent******";
const sequenceEventsPrefix = "MinaZkappSeqEvents**";

function pinnedSalt(prefix: string): [Field, Field, Field] {
  return Poseidon.update(
    [Field(0), Field(0), Field(0)],
    [prefixToField<Field>(Field, prefix)],
  );
}

function pinnedHashWithPrefix(prefix: string, input: Field[]): Field {
  return Poseidon.update(pinnedSalt(prefix), input)[0]!;
}

const actionsEmptyHash = pinnedSalt("MinaZkappActionsEmpty")[0];

function appendPinnedActionHash(
  initialActionsHash: Field,
  actionFields: Field[],
): Field {
  const actionEventHash = pinnedHashWithPrefix(eventPrefix, actionFields);
  const actionListHash = pinnedHashWithPrefix(sequenceEventsPrefix, [
    actionsEmptyHash,
    actionEventHash,
  ]);
  return pinnedHashWithPrefix(sequenceEventsPrefix, [
    initialActionsHash,
    actionListHash,
  ]);
}

function createSqliteStore(): KeyvSqlite {
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

export function padActions(actions: readonly VoteAction[]): VoteAction[] {
  if (actions.length > VOTE_ACTION_BATCH_SIZE) {
    throw new Error("Vote action fixture exceeds the reducer batch size.");
  }
  return [
    ...actions,
    ...Array.from({ length: VOTE_ACTION_BATCH_SIZE - actions.length }, () =>
      VoteAction.dummy(),
    ),
  ];
}

export function actionHash(
  actions: readonly VoteAction[],
  fromHash = Reducer.initialActionState,
): Field {
  let hash = fromHash;
  for (const action of actions) {
    if (!VoteAction.isDummy(action).toBoolean()) {
      hash = appendPinnedActionHash(hash, VoteAction.toFields(action));
    }
  }
  return hash;
}

export function buildHistoryTarget(
  actions: readonly VoteAction[],
): ActionStateHistoryTarget {
  let hash = Reducer.initialActionState;
  const hashes: Field[] = [];
  for (const action of actions) {
    if (VoteAction.isDummy(action).toBoolean()) continue;
    hash = appendPinnedActionHash(hash, VoteAction.toFields(action));
    hashes.push(hash);
  }
  while (hashes.length < 5) hashes.push(Reducer.initialActionState);
  if (hashes.length !== 5) {
    throw new Error("Action history fixture must contain at most five states.");
  }
  hashes.reverse();
  return new ActionStateHistoryTarget({
    actionStateOne: hashes[0]!,
    actionStateTwo: hashes[1]!,
    actionStateThree: hashes[2]!,
    actionStateFour: hashes[3]!,
    actionStateFive: hashes[4]!,
  });
}

export async function createVoteReducerFixture(label: string) {
  const sqlite = createSqliteStore();
  const votingStorage = createSqliteVotingLedgerStorage(label, sqlite);
  const nullifierStorage = createSqliteNullifierLedgerStorage(label, sqlite);
  const votingLedger = new PersistentVotingLedger(
    votingStorage.votingAccountStorage,
    votingStorage.merkleTreeStorage,
  );
  const nullifierLedger = new PersistentNullifierLedger(
    nullifierStorage.nullifierStorage,
    nullifierStorage.merkleTreeStorage,
  );
  const accounts = balances.map((balance, index) => ({
    privateKey: PrivateKey.fromBigInt(BigInt(10_001 + index)),
    balance: UInt64.from(balance),
  }));

  for (const account of accounts) {
    const publicKey = account.privateKey.toPublicKey().toBase58();
    const votingAccount = new VotingAccount({ balance: account.balance });
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
    await nullifierLedger.setNullifier(publicKey, Bool(false));
    await nullifierLedger.setLeaf(publicKey, Bool(false));
  }

  voteReducerContext.set({ votingLedger, nullifierLedger });

  const publicInput = async (
    actions: readonly VoteAction[],
    overrides: Partial<{
      fromActionsHash: Field;
      votingLedgerRoot: Field;
      fromNullifierRoot: Field;
      actionStateHistoryTarget: ActionStateHistoryTarget;
    }> = {},
  ) =>
    new VoteReducerPublicInput({
      fromActionsHash: overrides.fromActionsHash ?? Reducer.initialActionState,
      votingLedgerRoot:
        overrides.votingLedgerRoot ?? (await votingLedger.getRoot()),
      fromNullifierRoot:
        overrides.fromNullifierRoot ?? (await nullifierLedger.getRoot()),
      actionStateHistoryTarget:
        overrides.actionStateHistoryTarget ?? buildHistoryTarget(actions),
    });

  const cleanup = async () => {
    await votingLedger.close();
    await nullifierLedger.close();
    await sqlite.disconnect();
  };

  return {
    accounts: accounts.map((account) => ({
      ...account,
      publicKey: account.privateKey.toPublicKey(),
    })),
    votingLedger,
    nullifierLedger,
    publicInput,
    cleanup,
  };
}
