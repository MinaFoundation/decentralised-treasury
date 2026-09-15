import { Bool, Field, PublicKey, UInt64, type Field as FieldType } from "o1js";
import type { NullifierLedger } from "../../../../src/ledgers/nullifier-ledger/nullifier-ledger.js";
import type { StakingLedger } from "../../../../src/ledgers/staking-ledger/staking-ledger.js";
import type { VotingLedger } from "../../../../src/ledgers/voting-ledger/voting-ledger.js";
import { Account } from "../../../../src/provable/account.js";
import {
  PrefixedMerkleWitness255,
  PrefixedMerkleWitness36,
} from "../../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import {
  StrictCallLog,
  type ExpectedLedgerCall,
  type LedgerName,
} from "./strict-call-log.js";

const PUBLIC_KEYS = [
  "B62qpwsDQLRquqJxpsUV1kcPNiyTUJ3toPrvaAYBX6UxWJK5mhvmvMm",
  "B62qkeDHBbVQbYtXSJN31C245QpJSoazSVGY8GiPEVHrisG3gcw1vQG",
] as const;

export interface ScriptedRead<T> {
  readonly key: string;
  readonly value: T;
}

export interface InjectedWriteFailure {
  readonly method: string;
  readonly key?: string;
  readonly timing: "before" | "after";
}

interface ReadScript<T> {
  take(key: string): T;
  assertConsumed(): void;
}

function createReadScript<T>(
  name: string,
  entries: readonly ScriptedRead<T>[] | undefined,
  clone: (value: T) => T,
): ReadScript<T> {
  const queues = new Map<string, T[]>();
  for (const entry of entries ?? []) {
    const queue = queues.get(entry.key) ?? [];
    queue.push(clone(entry.value));
    queues.set(entry.key, queue);
  }

  return {
    take(key: string): T {
      const queue = queues.get(key);
      const value = queue?.shift();
      if (value === undefined) {
        throw new Error(`Missing scripted ${name} read for ${key}.`);
      }
      return clone(value);
    },
    assertConsumed(): void {
      const unused = [...queues.entries()]
        .filter(([, values]) => values.length > 0)
        .map(([key, values]) => `${key}:${values.length}`);
      if (unused.length > 0) {
        throw new Error(`Unused scripted ${name} reads: ${unused.join(", ")}.`);
      }
    },
  };
}

function createFailureInjector(
  ledger: LedgerName,
  failures: readonly InjectedWriteFailure[] | undefined,
) {
  const remaining = (failures ?? []).map((failure) => ({ ...failure }));

  return {
    throwIfConfigured(
      method: string,
      key: string | undefined,
      timing: "before" | "after",
    ) {
      const index = remaining.findIndex(
        (failure) =>
          failure.method === method &&
          failure.timing === timing &&
          (failure.key === undefined || failure.key === key),
      );
      if (index === -1) return;
      remaining.splice(index, 1);
      const keyDescription = key === undefined ? "" : `(${key})`;
      throw new Error(
        `Injected ${timing} failure at ${ledger}.${method}${keyDescription}.`,
      );
    },
    assertConsumed(): void {
      if (remaining.length > 0) {
        throw new Error(
          `Unused injected ${ledger} write failures: ${remaining.length}.`,
        );
      }
    },
  };
}

function cloneField(value: FieldType): FieldType {
  return Field(value.toBigInt());
}

function cloneAccount(value: Account): Account {
  return Account.fromFields(
    Account.toFields(value),
    Account.toAuxiliary(value),
  );
}

function cloneVotingAccount(value: VotingAccount): VotingAccount {
  return new VotingAccount({ balance: UInt64.from(value.balance.toBigInt()) });
}

function cloneWitness36(
  value: PrefixedMerkleWitness36,
): PrefixedMerkleWitness36 {
  return new PrefixedMerkleWitness36(
    value.path.map((sibling, index) => ({
      isLeft: value.isLeft[index]!.toBoolean(),
      sibling: cloneField(sibling),
    })),
  );
}

function cloneWitness255(
  value: PrefixedMerkleWitness255,
): PrefixedMerkleWitness255 {
  return new PrefixedMerkleWitness255(
    value.path.map((sibling, index) => ({
      isLeft: value.isLeft[index]!.toBoolean(),
      sibling: cloneField(sibling),
    })),
  );
}

export function deterministicAccount(
  identity: 0 | 1,
  balance: bigint,
  delegateIdentity: 0 | 1 = identity,
): Account {
  const account = Account.empty();
  account.pk = PublicKey.fromBase58(PUBLIC_KEYS[identity]);
  account.delegate = PublicKey.fromBase58(PUBLIC_KEYS[delegateIdentity]);
  account.balance = UInt64.from(balance);
  return account;
}

export function deterministicVotingAccount(balance: bigint): VotingAccount {
  return new VotingAccount({ balance: UInt64.from(balance) });
}

export function deterministicWitness36(
  index: bigint,
  marker: bigint,
): PrefixedMerkleWitness36 {
  return new PrefixedMerkleWitness36(
    Array.from({ length: 35 }, (_, level) => ({
      isLeft: ((index >> BigInt(level)) & 1n) === 0n,
      sibling: Field(marker + BigInt(level)),
    })),
  );
}

export function deterministicWitness255(
  index: bigint,
  marker: bigint,
): PrefixedMerkleWitness255 {
  return new PrefixedMerkleWitness255(
    Array.from({ length: 254 }, (_, level) => ({
      isLeft: ((index >> BigInt(level)) & 1n) === 0n,
      sibling: Field(marker + BigInt(level)),
    })),
  );
}

export interface StrictStakingLedgerOptions {
  readonly expectedCalls: readonly ExpectedLedgerCall[];
  readonly accountReads?: readonly ScriptedRead<Account>[];
  readonly witnessReads?: readonly ScriptedRead<PrefixedMerkleWitness36>[];
  readonly rootReads?: readonly FieldType[];
  readonly allAccountReads?: readonly (readonly Account[])[];
  readonly accountCountReads?: readonly number[];
  readonly initialAccounts?: readonly ScriptedRead<Account>[];
  readonly initialLeaves?: readonly ScriptedRead<Account>[];
  readonly writeFailures?: readonly InjectedWriteFailure[];
}

export interface StrictStakingLedgerFixture {
  readonly ledger: StakingLedger;
  readonly calls: StrictCallLog;
  assertConsumed(): void;
  snapshot(): {
    readonly accounts: ReadonlyMap<string, Account>;
    readonly leaves: ReadonlyMap<string, Account>;
    readonly closed: boolean;
  };
}

export function buildStrictStakingLedger(
  options: StrictStakingLedgerOptions,
): StrictStakingLedgerFixture {
  const calls = new StrictCallLog(options.expectedCalls);
  const accountReads = createReadScript(
    "staking account",
    options.accountReads,
    cloneAccount,
  );
  const witnessReads = createReadScript(
    "staking witness",
    options.witnessReads,
    cloneWitness36,
  );
  const rootReads = createReadScript(
    "staking root",
    (options.rootReads ?? []).map((value) => ({ key: "root", value })),
    cloneField,
  );
  const allAccountReads = createReadScript<Account[]>(
    "staking account list",
    (options.allAccountReads ?? []).map((value) => ({
      key: "all",
      value: value.map(cloneAccount),
    })),
    (accounts) => accounts.map(cloneAccount),
  );
  const accountCountReads = createReadScript(
    "staking account count",
    (options.accountCountReads ?? []).map((value) => ({ key: "count", value })),
    (value) => value,
  );
  const failures = createFailureInjector("staking", options.writeFailures);
  const accounts = new Map(
    (options.initialAccounts ?? []).map(({ key, value }) => [
      key,
      cloneAccount(value),
    ]),
  );
  const leaves = new Map(
    (options.initialLeaves ?? []).map(({ key, value }) => [
      key,
      cloneAccount(value),
    ]),
  );
  let closed = false;

  const ledger: StakingLedger = {
    async getAllAccounts() {
      calls.record({ ledger: "staking", method: "getAllAccounts" });
      return allAccountReads.take("all");
    },
    async accountCount() {
      calls.record({ ledger: "staking", method: "accountCount" });
      return accountCountReads.take("count");
    },
    async getAccount(index) {
      const key = index.toString();
      calls.record({ ledger: "staking", method: "getAccount", key });
      return accountReads.take(key);
    },
    async setAccount(index, account) {
      const key = index.toString();
      calls.record({ ledger: "staking", method: "setAccount", key });
      failures.throwIfConfigured("setAccount", key, "before");
      accounts.set(key, cloneAccount(account));
      failures.throwIfConfigured("setAccount", key, "after");
    },
    async getWitness(index) {
      const key = index.toString();
      calls.record({ ledger: "staking", method: "getWitness", key });
      return witnessReads.take(key);
    },
    async setLeaf(index, account) {
      const key = index.toString();
      calls.record({ ledger: "staking", method: "setLeaf", key });
      failures.throwIfConfigured("setLeaf", key, "before");
      leaves.set(key, cloneAccount(account));
      failures.throwIfConfigured("setLeaf", key, "after");
    },
    async getRoot() {
      calls.record({ ledger: "staking", method: "getRoot" });
      return rootReads.take("root");
    },
    async close() {
      calls.record({ ledger: "staking", method: "close" });
      closed = true;
    },
  };

  return {
    ledger,
    calls,
    assertConsumed() {
      calls.assertComplete();
      accountReads.assertConsumed();
      witnessReads.assertConsumed();
      rootReads.assertConsumed();
      allAccountReads.assertConsumed();
      accountCountReads.assertConsumed();
      failures.assertConsumed();
    },
    snapshot() {
      return {
        accounts: new Map(
          [...accounts].map(([key, value]) => [key, cloneAccount(value)]),
        ),
        leaves: new Map(
          [...leaves].map(([key, value]) => [key, cloneAccount(value)]),
        ),
        closed,
      };
    },
  };
}

export interface StrictVotingLedgerOptions {
  readonly expectedCalls: readonly ExpectedLedgerCall[];
  readonly accountReads?: readonly ScriptedRead<VotingAccount>[];
  readonly witnessReads?: readonly ScriptedRead<PrefixedMerkleWitness255>[];
  readonly rootReads?: readonly FieldType[];
  readonly initialAccounts?: readonly ScriptedRead<VotingAccount>[];
  readonly initialLeaves?: readonly ScriptedRead<VotingAccount>[];
  readonly writeFailures?: readonly InjectedWriteFailure[];
}

export interface StrictVotingLedgerFixture {
  readonly ledger: VotingLedger;
  readonly calls: StrictCallLog;
  assertConsumed(): void;
  snapshot(): {
    readonly accounts: ReadonlyMap<string, VotingAccount>;
    readonly leaves: ReadonlyMap<string, VotingAccount>;
    readonly closed: boolean;
  };
}

export function buildStrictVotingLedger(
  options: StrictVotingLedgerOptions,
): StrictVotingLedgerFixture {
  const calls = new StrictCallLog(options.expectedCalls);
  const accountReads = createReadScript(
    "voting account",
    options.accountReads,
    cloneVotingAccount,
  );
  const witnessReads = createReadScript(
    "voting witness",
    options.witnessReads,
    cloneWitness255,
  );
  const rootReads = createReadScript(
    "voting root",
    (options.rootReads ?? []).map((value) => ({ key: "root", value })),
    cloneField,
  );
  const failures = createFailureInjector("voting", options.writeFailures);
  const accounts = new Map(
    (options.initialAccounts ?? []).map(({ key, value }) => [
      key,
      cloneVotingAccount(value),
    ]),
  );
  const leaves = new Map(
    (options.initialLeaves ?? []).map(({ key, value }) => [
      key,
      cloneVotingAccount(value),
    ]),
  );
  let closed = false;

  const ledger: VotingLedger = {
    async getVotingAccount(publicKey) {
      calls.record({
        ledger: "voting",
        method: "getVotingAccount",
        key: publicKey,
      });
      return accountReads.take(publicKey);
    },
    async setVotingAccount(publicKey, account) {
      calls.record({
        ledger: "voting",
        method: "setVotingAccount",
        key: publicKey,
      });
      failures.throwIfConfigured("setVotingAccount", publicKey, "before");
      accounts.set(publicKey, cloneVotingAccount(account));
      failures.throwIfConfigured("setVotingAccount", publicKey, "after");
    },
    async getWitness(publicKey) {
      calls.record({ ledger: "voting", method: "getWitness", key: publicKey });
      return witnessReads.take(publicKey);
    },
    async setLeaf(publicKey, account) {
      calls.record({ ledger: "voting", method: "setLeaf", key: publicKey });
      failures.throwIfConfigured("setLeaf", publicKey, "before");
      leaves.set(publicKey, cloneVotingAccount(account));
      failures.throwIfConfigured("setLeaf", publicKey, "after");
    },
    async getRoot() {
      calls.record({ ledger: "voting", method: "getRoot" });
      return rootReads.take("root");
    },
    async close() {
      calls.record({ ledger: "voting", method: "close" });
      closed = true;
    },
  };

  return {
    ledger,
    calls,
    assertConsumed() {
      calls.assertComplete();
      accountReads.assertConsumed();
      witnessReads.assertConsumed();
      rootReads.assertConsumed();
      failures.assertConsumed();
    },
    snapshot() {
      return {
        accounts: new Map(
          [...accounts].map(([key, value]) => [key, cloneVotingAccount(value)]),
        ),
        leaves: new Map(
          [...leaves].map(([key, value]) => [key, cloneVotingAccount(value)]),
        ),
        closed,
      };
    },
  };
}

export interface StrictNullifierLedgerOptions {
  readonly expectedCalls: readonly ExpectedLedgerCall[];
  readonly nullifierReads?: readonly ScriptedRead<Bool>[];
  readonly witnessReads?: readonly ScriptedRead<PrefixedMerkleWitness255>[];
  readonly rootReads?: readonly FieldType[];
  readonly initialNullifiers?: readonly ScriptedRead<Bool>[];
  readonly initialLeaves?: readonly ScriptedRead<Bool>[];
  readonly writeFailures?: readonly InjectedWriteFailure[];
}

export interface StrictNullifierLedgerFixture {
  readonly ledger: NullifierLedger;
  readonly calls: StrictCallLog;
  assertConsumed(): void;
  snapshot(): {
    readonly nullifiers: ReadonlyMap<string, Bool>;
    readonly leaves: ReadonlyMap<string, Bool>;
    readonly closed: boolean;
  };
}

function cloneBool(value: Bool): Bool {
  return Bool(value.toBoolean());
}

export function buildStrictNullifierLedger(
  options: StrictNullifierLedgerOptions,
): StrictNullifierLedgerFixture {
  const calls = new StrictCallLog(options.expectedCalls);
  const nullifierReads = createReadScript(
    "nullifier",
    options.nullifierReads,
    cloneBool,
  );
  const witnessReads = createReadScript(
    "nullifier witness",
    options.witnessReads,
    cloneWitness255,
  );
  const rootReads = createReadScript(
    "nullifier root",
    (options.rootReads ?? []).map((value) => ({ key: "root", value })),
    cloneField,
  );
  const failures = createFailureInjector("nullifier", options.writeFailures);
  const nullifiers = new Map(
    (options.initialNullifiers ?? []).map(({ key, value }) => [
      key,
      cloneBool(value),
    ]),
  );
  const leaves = new Map(
    (options.initialLeaves ?? []).map(({ key, value }) => [
      key,
      cloneBool(value),
    ]),
  );
  let closed = false;

  const ledger: NullifierLedger = {
    async getNullifier(publicKey) {
      calls.record({
        ledger: "nullifier",
        method: "getNullifier",
        key: publicKey,
      });
      return nullifierReads.take(publicKey);
    },
    async setNullifier(publicKey, nullifier) {
      calls.record({
        ledger: "nullifier",
        method: "setNullifier",
        key: publicKey,
      });
      failures.throwIfConfigured("setNullifier", publicKey, "before");
      nullifiers.set(publicKey, cloneBool(nullifier));
      failures.throwIfConfigured("setNullifier", publicKey, "after");
    },
    async getWitness(publicKey) {
      calls.record({
        ledger: "nullifier",
        method: "getWitness",
        key: publicKey,
      });
      return witnessReads.take(publicKey);
    },
    async setLeaf(publicKey, nullifier) {
      calls.record({ ledger: "nullifier", method: "setLeaf", key: publicKey });
      failures.throwIfConfigured("setLeaf", publicKey, "before");
      leaves.set(publicKey, cloneBool(nullifier));
      failures.throwIfConfigured("setLeaf", publicKey, "after");
    },
    async getRoot() {
      calls.record({ ledger: "nullifier", method: "getRoot" });
      return rootReads.take("root");
    },
    async close() {
      calls.record({ ledger: "nullifier", method: "close" });
      closed = true;
    },
  };

  return {
    ledger,
    calls,
    assertConsumed() {
      calls.assertComplete();
      nullifierReads.assertConsumed();
      witnessReads.assertConsumed();
      rootReads.assertConsumed();
      failures.assertConsumed();
    },
    snapshot() {
      return {
        nullifiers: new Map(
          [...nullifiers].map(([key, value]) => [key, cloneBool(value)]),
        ),
        leaves: new Map(
          [...leaves].map(([key, value]) => [key, cloneBool(value)]),
        ),
        closed,
      };
    },
  };
}
