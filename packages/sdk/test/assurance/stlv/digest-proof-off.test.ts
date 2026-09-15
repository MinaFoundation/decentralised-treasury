import assert from "node:assert/strict";
import test from "node:test";
import { Field, PublicKey, TokenId, UInt64 } from "o1js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  stakingLedgerToVotingLedgerContext,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account, packToFields } from "../../../src/provable/account.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
  type StakingLedger,
} from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import type { VotingLedger } from "../../../src/ledgers/voting-ledger/voting-ledger.js";
import {
  PrefixedMerkleWitness255,
  PrefixedMerkleWitness36,
} from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { createStakingLedgerToVotingLedgerTestContext } from "../../provable/context/staking-ledger-to-voting-ledger-context.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import {
  StakingLedgerToVotingLedgerDigestTrace,
  StakingLedgerToVotingLedgerTracer,
} from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import {
  StakingLedgerToVotingLedgerProver,
  type StakingLedgerToVotingLedgerTaskQueue,
} from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import type { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";
import type { StakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-proof-storage.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { InMemoryVotingAccountStorage } from "../../../src/storage/in-memory/in-memory-voting-account-storage.js";
import { InMemoryMerkleTreeStorage } from "../../../src/storage/in-memory/in-memory-merkle-tree-storage.js";
import type { SideLoadedStakingLedgerToVotingLedgerProof } from "../../../src/provable/staking-ledger-to-voting-ledger.js";

type TestContext = Awaited<
  ReturnType<typeof createStakingLedgerToVotingLedgerTestContext>
>;

function cloneAccount(account: Account): Account {
  return Account.fromJSON(Account.toJSON(account));
}

function cloneVotingAccount(account: VotingAccount): VotingAccount {
  return VotingAccount.fromJSON(VotingAccount.toJSON(account));
}

function cloneWitness36(
  witness: PrefixedMerkleWitness36,
): PrefixedMerkleWitness36 {
  return PrefixedMerkleWitness36.fromJSON(witness.toJSON());
}

function cloneWitness255(
  witness: PrefixedMerkleWitness255,
): PrefixedMerkleWitness255 {
  return PrefixedMerkleWitness255.fromJSON(witness.toJSON());
}

async function replaceBatch(
  context: TestContext,
  accounts: readonly Account[],
): Promise<Account[]> {
  return await placeBatch(context, 0n, accounts);
}

async function placeBatch(
  context: TestContext,
  startIndex: bigint,
  accounts: readonly Account[],
): Promise<Account[]> {
  assert.equal(accounts.length, ACCOUNT_BATCH_SIZE);
  const batch = accounts.map(cloneAccount);
  for (let index = 0; index < batch.length; index++) {
    const ledgerIndex = startIndex + BigInt(index);
    await context.stakingLedger.setAccount(ledgerIndex, batch[index]!);
    await context.stakingLedger.setLeaf(ledgerIndex, batch[index]!);
  }
  return batch;
}

async function makeInput(
  context: TestContext,
  index: bigint = 0n,
): Promise<StakingLedgerToVotingLedgerProgramInput> {
  return new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(index),
    stakingLedgerRoot: await context.stakingLedger.getRoot(),
    votingLedgerRoot: await context.votingLedger.getRoot(),
  });
}

async function digest(
  input: StakingLedgerToVotingLedgerProgramInput,
  accounts: readonly Account[],
) {
  return (await StakingLedgerToVotingLedger.digest(input, [...accounts])).proof;
}

async function withContext(
  run: (context: TestContext) => Promise<void>,
): Promise<void> {
  const context = await createStakingLedgerToVotingLedgerTestContext({
    maxAccounts: ACCOUNT_BATCH_SIZE,
  });
  try {
    await run(context);
  } finally {
    await context.cleanup();
  }
}

interface StakingWitnessRead {
  index: bigint;
  witness: PrefixedMerkleWitness36;
}

interface VotingAccountRead {
  publicKey: string;
  account: VotingAccount;
}

interface VotingWitnessRead {
  publicKey: string;
  witness: PrefixedMerkleWitness255;
}

class StrictRecordingStakingLedger implements StakingLedger {
  readonly journal: string[] = [];
  readonly witnessReads: StakingWitnessRead[] = [];

  constructor(private readonly ledger: StakingLedger) {}

  async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    this.journal.push(`staking:getWitness:${index.toString()}`);
    const witness = cloneWitness36(await this.ledger.getWitness(index));
    this.witnessReads.push({ index, witness: cloneWitness36(witness) });
    return witness;
  }

  async getAllAccounts(): Promise<Account[]> {
    throw new Error("Unexpected getAllAccounts() call");
  }

  async accountCount(): Promise<number> {
    throw new Error("Unexpected accountCount() call");
  }

  async getAccount(_index: bigint): Promise<Account> {
    throw new Error("Unexpected getAccount() call");
  }

  async setAccount(_index: bigint, _account: Account): Promise<void> {
    throw new Error("Unexpected setAccount() call");
  }

  async setLeaf(_index: bigint, _leaf: Account): Promise<void> {
    throw new Error("Unexpected staking setLeaf() call");
  }

  async getRoot(): Promise<Field> {
    throw new Error("Unexpected staking getRoot() call");
  }

  async close(): Promise<void> {}
}

class StrictRecordingVotingLedger implements VotingLedger {
  readonly journal: string[] = [];
  readonly accountReads: VotingAccountRead[] = [];
  readonly witnessReads: VotingWitnessRead[] = [];

  constructor(private readonly ledger: VotingLedger) {}

  async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    this.journal.push(`voting:getVotingAccount:${publicKey}`);
    const account = cloneVotingAccount(
      await this.ledger.getVotingAccount(publicKey),
    );
    this.accountReads.push({
      publicKey,
      account: cloneVotingAccount(account),
    });
    return account;
  }

  async getWitness(publicKey: string): Promise<PrefixedMerkleWitness255> {
    this.journal.push(`voting:getWitness:${publicKey}`);
    const witness = cloneWitness255(await this.ledger.getWitness(publicKey));
    this.witnessReads.push({
      publicKey,
      witness: cloneWitness255(witness),
    });
    return witness;
  }

  async setVotingAccount(
    publicKey: string,
    account: VotingAccount,
  ): Promise<void> {
    this.journal.push(`voting:setVotingAccount:${publicKey}`);
    await this.ledger.setVotingAccount(publicKey, cloneVotingAccount(account));
  }

  async setLeaf(publicKey: string, account: VotingAccount): Promise<void> {
    this.journal.push(`voting:setLeaf:${publicKey}`);
    await this.ledger.setLeaf(publicKey, cloneVotingAccount(account));
  }

  async getRoot(): Promise<Field> {
    throw new Error("Unexpected voting getRoot() call");
  }

  async close(): Promise<void> {}
}

class StrictReplayStakingLedger implements StakingLedger {
  readonly journal: string[] = [];
  private readonly reads: StakingWitnessRead[];

  constructor(reads: readonly StakingWitnessRead[]) {
    this.reads = reads.map(({ index, witness }) => ({
      index,
      witness: cloneWitness36(witness),
    }));
  }

  async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    this.journal.push(`staking:getWitness:${index.toString()}`);
    const read = this.reads.shift();
    assert(
      read,
      `Missing replay staking witness for index ${index.toString()}`,
    );
    assert.equal(read.index, index, "Replay staking witness order changed");
    return cloneWitness36(read.witness);
  }

  assertConsumed(): void {
    assert.equal(
      this.reads.length,
      0,
      "Unused replay staking witnesses remain",
    );
  }

  async getAllAccounts(): Promise<Account[]> {
    throw new Error("Unexpected replay getAllAccounts() call");
  }

  async accountCount(): Promise<number> {
    throw new Error("Unexpected replay accountCount() call");
  }

  async getAccount(_index: bigint): Promise<Account> {
    throw new Error("Unexpected replay getAccount() call");
  }

  async setAccount(_index: bigint, _account: Account): Promise<void> {
    throw new Error("Unexpected replay setAccount() call");
  }

  async setLeaf(_index: bigint, _leaf: Account): Promise<void> {
    throw new Error("Unexpected replay staking setLeaf() call");
  }

  async getRoot(): Promise<Field> {
    throw new Error("Unexpected replay staking getRoot() call");
  }

  async close(): Promise<void> {}
}

class StrictReplayVotingLedger implements VotingLedger {
  readonly journal: string[] = [];
  private readonly accountReads: VotingAccountRead[];
  private readonly witnessReads: VotingWitnessRead[];

  constructor(
    accountReads: readonly VotingAccountRead[],
    witnessReads: readonly VotingWitnessRead[],
  ) {
    this.accountReads = accountReads.map(({ publicKey, account }) => ({
      publicKey,
      account: cloneVotingAccount(account),
    }));
    this.witnessReads = witnessReads.map(({ publicKey, witness }) => ({
      publicKey,
      witness: cloneWitness255(witness),
    }));
  }

  async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    this.journal.push(`voting:getVotingAccount:${publicKey}`);
    const read = this.accountReads.shift();
    assert(read, `Missing replay voting account for ${publicKey}`);
    assert.equal(
      read.publicKey,
      publicKey,
      "Replay voting-account order changed",
    );
    return cloneVotingAccount(read.account);
  }

  async getWitness(publicKey: string): Promise<PrefixedMerkleWitness255> {
    this.journal.push(`voting:getWitness:${publicKey}`);
    const read = this.witnessReads.shift();
    assert(read, `Missing replay voting witness for ${publicKey}`);
    assert.equal(
      read.publicKey,
      publicKey,
      "Replay voting-witness order changed",
    );
    return cloneWitness255(read.witness);
  }

  async setVotingAccount(
    publicKey: string,
    _account: VotingAccount,
  ): Promise<void> {
    this.journal.push(`voting:setVotingAccount:${publicKey}`);
  }

  async setLeaf(publicKey: string, _account: VotingAccount): Promise<void> {
    this.journal.push(`voting:setLeaf:${publicKey}`);
  }

  assertConsumed(): void {
    assert.equal(
      this.accountReads.length,
      0,
      "Unused replay voting accounts remain",
    );
    assert.equal(
      this.witnessReads.length,
      0,
      "Unused replay voting witnesses remain",
    );
  }

  async getRoot(): Promise<Field> {
    throw new Error("Unexpected replay voting getRoot() call");
  }

  async close(): Promise<void> {}
}

test.before(async () => {
  assert.equal(
    process.env.PROOFS_ENABLED,
    "false",
    "This suite must run with PROOFS_ENABLED=false",
  );
  await StakingLedgerToVotingLedger.compile({ proofsEnabled: false });
});

test("STLV proof-off cardinality and padding cases", async (t) => {
  const cases = [
    {
      id: "ZK-STLV-DIGEST-031",
      name: "empty direct batch",
      realAccounts: 0,
    },
    {
      id: "ZK-STLV-DIGEST-002",
      name: "one real account",
      realAccounts: 1,
    },
    {
      id: "ZK-STLV-DIGEST-003",
      name: "two real accounts",
      realAccounts: 2,
    },
    {
      id: "ZK-STLV-DIGEST-004",
      name: "partial three-account batch",
      realAccounts: 3,
    },
    {
      id: "ZK-STLV-DIGEST-005",
      name: "four real accounts",
      realAccounts: 4,
    },
    {
      id: "ZK-STLV-DIGEST-001",
      name: "exact five-account batch",
      realAccounts: 5,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(`${scenario.id} ${scenario.name}`, async () => {
      await withContext(async (context) => {
        const accounts = Array.from(
          { length: ACCOUNT_BATCH_SIZE },
          (_, index) =>
            index < scenario.realAccounts
              ? cloneAccount(context.testAccounts[index]!)
              : Account.empty(),
        );
        const batch = await replaceBatch(context, accounts);
        const initialVotingRoot = await context.votingLedger.getRoot();
        const proof = await digest(await makeInput(context), batch);

        assert.equal(proof.publicInput.index.toBigInt(), 0n);
        assert.equal(proof.publicOutput.index.toBigInt(), 4n);
        assert.equal(proof.publicOutput.exhausted.toBoolean(), false);
        assert.equal(
          proof.publicOutput.votingLedgerRoot.toString(),
          (await context.votingLedger.getRoot()).toString(),
        );
        if (scenario.realAccounts === 0) {
          assert.equal(
            proof.publicOutput.votingLedgerRoot.toString(),
            initialVotingRoot.toString(),
          );
        }
      });
    });
  }
});

test("ZK-STLV-DIGEST-011 binds real height-36 witnesses at indices 0 through 4", async () => {
  await withContext(async (context) => {
    const accounts = context.testAccounts.map((source, index) => {
      const account = cloneAccount(source);
      account.delegate = context.testAccounts[index]!.pk;
      account.balance = UInt64.from(BigInt(index + 1) * 13n);
      account.tokenId = TokenId.default;
      return account;
    });
    const batch = await replaceBatch(context, accounts);
    const stakingRoot = await context.stakingLedger.getRoot();

    for (let index = 0; index < ACCOUNT_BATCH_SIZE; index++) {
      const witness = await context.stakingLedger.getWitness(BigInt(index));
      assert.equal(witness.calculateIndex().toBigInt(), BigInt(index));
    }

    const proof = await digest(await makeInput(context), batch);
    assert.equal(
      proof.publicInput.stakingLedgerRoot.toString(),
      stakingRoot.toString(),
    );
    assert.equal(proof.publicOutput.index.toBigInt(), 4n);
    assert.equal(
      proof.publicOutput.votingLedgerRoot.toString(),
      (await context.votingLedger.getRoot()).toString(),
    );
  });
});

test("STLV proof-off exact height-36 index boundaries", async (t) => {
  const leafCount = 2n ** 35n;
  const maximumIndex = leafCount - 1n;

  await t.test(
    "ZK-STLV-DIGEST-012 accepts the highest complete batch",
    async () => {
      await withContext(async (context) => {
        const startIndex = leafCount - BigInt(ACCOUNT_BATCH_SIZE);
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = context.testAccounts[index]!.pk;
          account.balance = UInt64.from(101 + index * 17);
          account.tokenId = TokenId.default;
          return account;
        });
        const batch = await placeBatch(context, startIndex, accounts);

        for (let offset = 0; offset < ACCOUNT_BATCH_SIZE; offset++) {
          const index = startIndex + BigInt(offset);
          const witness = await context.stakingLedger.getWitness(index);
          assert.equal(witness.calculateIndex().toBigInt(), index);
        }

        const proof = await digest(await makeInput(context, startIndex), batch);
        assert.equal(proof.publicInput.index.toBigInt(), startIndex);
        assert.equal(proof.publicOutput.index.toBigInt(), maximumIndex);
        assert.equal(proof.publicOutput.exhausted.toBoolean(), false);
      });
    },
  );

  await t.test(
    "ZK-STLV-DIGEST-024 rejects index 2^35 before a write",
    async () => {
      await withContext(async (context) => {
        const batch = context.testAccounts.map(cloneAccount);
        const votingRoot = await context.votingLedger.getRoot();
        const input = await makeInput(context, leafCount);
        await assert.rejects(() => digest(input, batch), /out of range/);
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          votingRoot.toString(),
        );
      });
    },
  );

  await t.test(
    "ZK-STLV-DIGEST-025 records four writes before a crossing batch rejects",
    async () => {
      await withContext(async (context) => {
        const startIndex = leafCount - 4n;
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = context.testAccounts[index]!.pk;
          account.balance = UInt64.from(211 + index * 19);
          account.tokenId = TokenId.default;
          return account;
        });
        for (let offset = 0; offset < 4; offset++) {
          const index = startIndex + BigInt(offset);
          await context.stakingLedger.setAccount(index, accounts[offset]!);
          await context.stakingLedger.setLeaf(index, accounts[offset]!);
        }
        const input = await makeInput(context, startIndex);

        await assert.rejects(() => digest(input, accounts), /out of range/);
        for (let offset = 0; offset < 4; offset++) {
          const account = accounts[offset]!;
          assert.equal(
            (
              await context.votingLedger.getVotingAccount(
                account.delegate.toBase58(),
              )
            ).balance.toBigInt(),
            account.balance.toBigInt(),
          );
        }
        assert.equal(
          (
            await context.votingLedger.getVotingAccount(
              accounts[4]!.delegate.toBase58(),
            )
          ).balance.toBigInt(),
          0n,
        );
      });
    },
  );
});

test("ZK-STLV-DIGEST-026 accepts a full final batch with a committed empty next leaf", async () => {
  await withContext(async (context) => {
    const startIndex = 5n;
    const accounts = context.testAccounts.map((source, index) => {
      const account = cloneAccount(source);
      account.delegate = context.testAccounts[index]!.pk;
      account.balance = UInt64.from(307 + index * 23);
      account.tokenId = TokenId.default;
      return account;
    });
    const batch = await placeBatch(context, startIndex, accounts);
    const stakingRoot = await context.stakingLedger.getRoot();
    const nextWitness = await context.stakingLedger.getWitness(10n);
    const emptyAccount = Account.empty();
    const emptyLeaf = hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(emptyAccount)),
    );
    assert.equal(nextWitness.calculateIndex().toBigInt(), 10n);
    assert.equal(
      nextWitness
        .calculateRoot(emptyLeaf, accountLedgerHashPrefixes)
        .toString(),
      stakingRoot.toString(),
    );

    const proof = await digest(await makeInput(context, startIndex), batch);
    assert.equal(
      proof.publicInput.stakingLedgerRoot.toString(),
      stakingRoot.toString(),
    );
    assert.equal(proof.publicOutput.index.toBigInt(), 9n);
  });
});

test("STLV proof-off voting-total partitions", async (t) => {
  const maximum = UInt64.MAXINT().toBigInt();
  const cases = [
    {
      id: "ZK-STLV-DIGEST-006",
      name: "shared delegate sum",
      balances: [10n, 20n, 30n, 40n, 50n],
      defaultToken: [true, true, true, true, true],
      expected: 150n,
    },
    {
      id: "ZK-STLV-DIGEST-007",
      name: "mixed token filter",
      balances: [11n, 1000n, 13n, 2000n, 17n],
      defaultToken: [true, false, true, false, true],
      expected: 41n,
    },
    {
      id: "ZK-STLV-DIGEST-008",
      name: "zero balances",
      balances: [0n, 0n, 0n, 0n, 0n],
      defaultToken: [true, true, true, true, true],
      expected: 0n,
    },
    {
      id: "ZK-STLV-DIGEST-009",
      name: "exact UInt64 maximum",
      balances: [maximum, 0n, 0n, 0n, 0n],
      defaultToken: [true, true, true, true, true],
      expected: maximum,
    },
    {
      id: "ZK-STLV-DIGEST-010",
      name: "all custom tokens",
      balances: [maximum, 2n, 3n, 4n, 5n],
      defaultToken: [false, false, false, false, false],
      expected: 0n,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(`${scenario.id} ${scenario.name}`, async () => {
      await withContext(async (context) => {
        const delegate = context.testAccounts[0]!.pk;
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = delegate;
          account.balance = UInt64.from(scenario.balances[index]!);
          account.tokenId = scenario.defaultToken[index]!
            ? TokenId.default
            : Field(70_000 + index);
          return account;
        });
        const batch = await replaceBatch(context, accounts);
        const proof = await digest(await makeInput(context), batch);

        assert.equal(
          (
            await context.votingLedger.getVotingAccount(delegate.toBase58())
          ).balance.toBigInt(),
          scenario.expected,
        );
        assert.equal(
          proof.publicOutput.votingLedgerRoot.toString(),
          (await context.votingLedger.getRoot()).toString(),
        );
      });
    });
  }
});

test("STLV proof-off sparse and noncanonical cases", async (t) => {
  const cases = [
    {
      id: "ZK-STLV-DIGEST-019",
      name: "interior empty leaf",
      configure(accounts: Account[]) {
        accounts[2] = Account.empty();
      },
    },
    {
      id: "ZK-STLV-DIGEST-020",
      name: "populated leaf after an interior hole",
      configure(accounts: Account[]) {
        accounts[1] = Account.empty();
        accounts[2]!.balance = UInt64.from(29);
      },
    },
    {
      id: "ZK-STLV-DIGEST-023",
      name: "default-token account with empty delegate",
      configure(accounts: Account[]) {
        accounts[0]!.delegate = PublicKey.empty();
        accounts[0]!.tokenId = TokenId.default;
        accounts[0]!.balance = UInt64.from(31);
      },
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(`${scenario.id} ${scenario.name}`, async () => {
      await withContext(async (context) => {
        const accounts = context.testAccounts.map(cloneAccount);
        for (const account of accounts) account.balance = UInt64.zero;
        scenario.configure(accounts);
        const batch = await replaceBatch(context, accounts);
        const proof = await digest(await makeInput(context), batch);

        assert.equal(proof.publicOutput.index.toBigInt(), 4n);
        assert.equal(proof.publicOutput.exhausted.toBoolean(), false);
        assert.equal(
          proof.publicOutput.votingLedgerRoot.toString(),
          (await context.votingLedger.getRoot()).toString(),
        );
        if (scenario.id === "ZK-STLV-DIGEST-023") {
          assert.equal(
            (
              await context.votingLedger.getVotingAccount(
                PublicKey.empty().toBase58(),
              )
            ).balance.toBigInt(),
            31n,
          );
        }
      });
    });
  }
});

test("STLV proof-off rejects public-root and witness mutations", async (t) => {
  const cases = [
    {
      id: "ZK-STLV-DIGEST-014",
      name: "wrong staking root",
      async run(context: TestContext, batch: Account[]) {
        const input = await makeInput(context);
        input.stakingLedgerRoot = input.stakingLedgerRoot.add(1);
        await assert.rejects(() => digest(input, batch));
      },
    },
    {
      id: "ZK-STLV-DIGEST-016",
      name: "wrong voting root",
      async run(context: TestContext, batch: Account[]) {
        const input = await makeInput(context);
        input.votingLedgerRoot = input.votingLedgerRoot.add(1);
        await assert.rejects(() => digest(input, batch));
      },
    },
    {
      id: "ZK-STLV-DIGEST-013",
      name: "wrong staking witness index",
      async run(context: TestContext, batch: Account[]) {
        const base = context.stakingLedger;
        const wrongWitness = await base.getWitness(1n);
        const ledger = new Proxy(base, {
          get(target, property, receiver) {
            if (property === "getWitness") {
              return async (index: bigint) =>
                index === 0n
                  ? cloneWitness36(wrongWitness)
                  : await target.getWitness(index);
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        stakingLedgerToVotingLedgerContext.set({
          stakingLedger: ledger,
          votingLedger: context.votingLedger,
        });
        const input = await makeInput(context);
        await assert.rejects(() => digest(input, batch));
      },
    },
    {
      id: "ZK-STLV-DIGEST-015",
      name: "wrong voting witness index",
      async run(context: TestContext, batch: Account[]) {
        const base = context.votingLedger;
        const expectedKey = batch[0]!.delegate.toBase58();
        const foreignKey = batch[1]!.delegate.toBase58();
        const wrongWitness = await base.getWitness(foreignKey);
        const ledger = new Proxy(base, {
          get(target, property, receiver) {
            if (property === "getWitness") {
              return async (publicKey: string) =>
                publicKey === expectedKey
                  ? cloneWitness255(wrongWitness)
                  : await target.getWitness(publicKey);
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        stakingLedgerToVotingLedgerContext.set({
          stakingLedger: context.stakingLedger,
          votingLedger: ledger,
        });
        const input = await makeInput(context);
        await assert.rejects(() => digest(input, batch));
      },
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(`${scenario.id} ${scenario.name}`, async () => {
      await withContext(async (context) => {
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = context.testAccounts[index]!.pk;
          account.balance = UInt64.from(index + 1);
          return account;
        });
        const batch = await replaceBatch(context, accounts);
        const initialVotingRoot = await context.votingLedger.getRoot();
        await scenario.run(context, batch);
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          initialVotingRoot.toString(),
        );
      });
    });
  }
});

test("ZK-STLV-DIGEST-018 rejects same-height witnesses from other ledgers", async (t) => {
  await t.test("foreign staking witness", async () => {
    await withContext(async (context) => {
      const batch = await replaceBatch(
        context,
        context.testAccounts.map(cloneAccount),
      );
      const foreignContext = await createStakingLedgerToVotingLedgerTestContext(
        {
          maxAccounts: ACCOUNT_BATCH_SIZE,
        },
      );
      const changed = cloneAccount(foreignContext.testAccounts[1]!);
      changed.balance = changed.balance.add(1);
      await foreignContext.stakingLedger.setAccount(1n, changed);
      await foreignContext.stakingLedger.setLeaf(1n, changed);
      const foreignWitness = await foreignContext.stakingLedger.getWitness(0n);
      await foreignContext.cleanup();

      const base = context.stakingLedger;
      const ledger = new Proxy(base, {
        get(target, property, receiver) {
          if (property === "getWitness") {
            return async (index: bigint) =>
              index === 0n
                ? cloneWitness36(foreignWitness)
                : await target.getWitness(index);
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      stakingLedgerToVotingLedgerContext.set({
        stakingLedger: ledger,
        votingLedger: context.votingLedger,
      });
      const votingRoot = await context.votingLedger.getRoot();
      const input = await makeInput(context);
      await assert.rejects(() => digest(input, batch));
      assert.equal(
        (await context.votingLedger.getRoot()).toString(),
        votingRoot.toString(),
      );
    });
  });

  await t.test("foreign voting witness", async () => {
    await withContext(async (context) => {
      const batch = await replaceBatch(
        context,
        context.testAccounts.map(cloneAccount),
      );
      const expectedKey = batch[0]!.delegate.toBase58();
      const foreignContext = await createStakingLedgerToVotingLedgerTestContext(
        {
          maxAccounts: ACCOUNT_BATCH_SIZE,
        },
      );
      const changedKey = batch[1]!.delegate.toBase58();
      const changedVotingAccount = new VotingAccount({
        balance: UInt64.from(37),
      });
      await foreignContext.votingLedger.setVotingAccount(
        changedKey,
        changedVotingAccount,
      );
      await foreignContext.votingLedger.setLeaf(
        changedKey,
        changedVotingAccount,
      );
      const foreignWitness =
        await foreignContext.votingLedger.getWitness(expectedKey);
      await foreignContext.cleanup();

      const base = context.votingLedger;
      const ledger = new Proxy(base, {
        get(target, property, receiver) {
          if (property === "getWitness") {
            return async (publicKey: string) =>
              publicKey === expectedKey
                ? cloneWitness255(foreignWitness)
                : await target.getWitness(publicKey);
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      stakingLedgerToVotingLedgerContext.set({
        stakingLedger: context.stakingLedger,
        votingLedger: ledger,
      });
      const input = await makeInput(context);
      await assert.rejects(() => digest(input, batch));
      assert.equal(
        (await context.votingLedger.getRoot()).toString(),
        input.votingLedgerRoot.toString(),
      );
    });
  });
});

test("STLV proof-off UInt64 overflow cases", async (t) => {
  const maximum = UInt64.MAXINT().toBigInt();

  await t.test(
    "ZK-STLV-DIGEST-021 rejects accumulated maximum plus one",
    async () => {
      await withContext(async (context) => {
        const delegate = context.testAccounts[0]!.pk;
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = delegate;
          account.balance = UInt64.from(
            index === 0 ? maximum : index === 1 ? 1 : 0,
          );
          account.tokenId = TokenId.default;
          return account;
        });
        const batch = await replaceBatch(context, accounts);
        const input = await makeInput(context);

        await assert.rejects(() => digest(input, batch));
        assert.equal(
          (
            await context.votingLedger.getVotingAccount(delegate.toBase58())
          ).balance.toBigInt(),
          maximum,
          "The failed addition does not wrap the host balance",
        );
      });
    },
  );

  await t.test(
    "ZK-STLV-DIGEST-022 records unrelated and pre-overflow writes",
    async () => {
      await withContext(async (context) => {
        const earlyDelegate = context.testAccounts[0]!.pk;
        const overflowDelegate = context.testAccounts[1]!.pk;
        const balances = [43n, maximum, 1n, 0n, 0n] as const;
        const accounts = context.testAccounts.map((source, index) => {
          const account = cloneAccount(source);
          account.delegate = index === 0 ? earlyDelegate : overflowDelegate;
          account.balance = UInt64.from(balances[index]!);
          account.tokenId = TokenId.default;
          return account;
        });
        const batch = await replaceBatch(context, accounts);
        const input = await makeInput(context);

        await assert.rejects(() => digest(input, batch));
        assert.equal(
          (
            await context.votingLedger.getVotingAccount(
              earlyDelegate.toBase58(),
            )
          ).balance.toBigInt(),
          43n,
        );
        assert.equal(
          (
            await context.votingLedger.getVotingAccount(
              overflowDelegate.toBase58(),
            )
          ).balance.toBigInt(),
          maximum,
        );
      });
    },
  );
});

test("ZK-STLV-DIGEST-001 preserves strict read order and replay output", async () => {
  await withContext(async (context) => {
    const accounts = context.testAccounts.map((source, index) => {
      const account = cloneAccount(source);
      account.delegate = context.testAccounts[index]!.pk;
      account.balance = UInt64.from(index + 11);
      account.tokenId = TokenId.default;
      return account;
    });
    const batch = await replaceBatch(context, accounts);
    const input = await makeInput(context);
    const recordingStaking = new StrictRecordingStakingLedger(
      context.stakingLedger,
    );
    const recordingVoting = new StrictRecordingVotingLedger(
      context.votingLedger,
    );
    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: recordingStaking,
      votingLedger: recordingVoting,
    });

    const first = await digest(input, batch);
    const combinedJournal = accounts.flatMap((account, index) => {
      const publicKey = account.delegate.toBase58();
      return [
        `staking:getWitness:${index.toString()}`,
        `voting:getVotingAccount:${publicKey}`,
        `voting:getWitness:${publicKey}`,
        `voting:setVotingAccount:${publicKey}`,
        `voting:setLeaf:${publicKey}`,
      ];
    });
    const actualJournal = accounts.flatMap((_account, index) => [
      recordingStaking.journal[index]!,
      ...recordingVoting.journal.slice(index * 4, index * 4 + 4),
    ]);
    assert.deepEqual(actualJournal, combinedJournal);

    const replayStaking = new StrictReplayStakingLedger(
      recordingStaking.witnessReads,
    );
    const replayVoting = new StrictReplayVotingLedger(
      recordingVoting.accountReads,
      recordingVoting.witnessReads,
    );
    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: replayStaking,
      votingLedger: replayVoting,
    });
    const replay = await digest(input, batch);

    replayStaking.assertConsumed();
    replayVoting.assertConsumed();
    assert.equal(
      replay.publicOutput.index.toString(),
      first.publicOutput.index.toString(),
    );
    assert.equal(
      replay.publicOutput.votingLedgerRoot.toString(),
      first.publicOutput.votingLedgerRoot.toString(),
    );
    assert.deepEqual(replayStaking.journal, recordingStaking.journal);
    assert.deepEqual(replayVoting.journal, recordingVoting.journal);
  });
});

test("ZK-STLV-DIGEST-017 records earlier writes before a stale later witness rejects", async () => {
  await withContext(async (context) => {
    const accounts = context.testAccounts.map((source, index) => {
      const account = cloneAccount(source);
      account.delegate = context.testAccounts[index]!.pk;
      account.balance = UInt64.from(index + 1);
      account.tokenId = TokenId.default;
      return account;
    });
    const batch = await replaceBatch(context, accounts);
    const secondKey = batch[1]!.delegate.toBase58();
    const staleSecondWitness = await context.votingLedger.getWitness(secondKey);
    const base = context.votingLedger;
    const ledger = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "getWitness") {
          return async (publicKey: string) =>
            publicKey === secondKey
              ? cloneWitness255(staleSecondWitness)
              : await target.getWitness(publicKey);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: context.stakingLedger,
      votingLedger: ledger,
    });

    const input = await makeInput(context);
    await assert.rejects(() => digest(input, batch));
    assert.equal(
      (
        await context.votingLedger.getVotingAccount(
          batch[0]!.delegate.toBase58(),
        )
      ).balance.toBigInt(),
      batch[0]!.balance.toBigInt(),
    );
    assert.equal(
      (
        await context.votingLedger.getVotingAccount(
          batch[1]!.delegate.toBase58(),
        )
      ).balance.toBigInt(),
      0n,
    );
  });
});

test("ZK-STLV-DIGEST-028 records failed trace and voting publication", async () => {
  await withContext(async (context) => {
    const overlayVotingLedger = new InMemoryVotingLedger(
      new InMemoryVotingAccountStorage(
        context.votingLedger.votingAccountStorage,
      ),
      new InMemoryMerkleTreeStorage(context.votingLedger.merkleTreeStorage),
    );
    const stagedTraces = new Map<
      number,
      StakingLedgerToVotingLedgerDigestTrace
    >();
    const committedTraces = new Map<
      number,
      StakingLedgerToVotingLedgerDigestTrace
    >();
    const traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage = {
      async getTrace(index) {
        return committedTraces.get(index);
      },
      async setTrace(index, trace) {
        stagedTraces.set(index, trace);
      },
      async getAllTraces() {
        return [...committedTraces.values()];
      },
      async count() {
        return committedTraces.size;
      },
      collectEntries() {
        return [...stagedTraces].map(([index, trace]) => ({
          key: `trace:${index}`,
          value: JSON.stringify(
            StakingLedgerToVotingLedgerDigestTrace.toJSON(trace),
          ),
        }));
      },
      clearEntries() {
        stagedTraces.clear();
      },
      async close() {},
    };
    const publicationCalls: KeyValueEntry[][] = [];
    const batchWriter: KeyValueBatchStorage = {
      async setMany(entries) {
        publicationCalls.push(entries.map((entry) => ({ ...entry })));
        throw new Error("injected trace publication failure");
      },
      async close() {},
    };
    const initialParentRoot = await context.votingLedger.getRoot();
    const firstDelegate = context.testAccounts[0]!.delegate.toBase58();
    const tracer = new StakingLedgerToVotingLedgerTracer(
      context.stakingLedger,
      overlayVotingLedger,
      traceStorage,
      batchWriter,
    );

    await assert.rejects(
      () => tracer.digest(0, 0),
      /injected trace publication failure/,
    );

    assert.equal(publicationCalls.length, 1);
    assert.equal(
      publicationCalls[0]!.some(({ key }) => key === "trace:0"),
      true,
    );
    assert.equal(
      publicationCalls[0]!.some(({ key }) => key.includes(firstDelegate)),
      true,
    );
    assert.equal(stagedTraces.size, 1);
    assert.equal(await traceStorage.getTrace(0), undefined);
    assert.equal(await traceStorage.count(), 0);
    assert.notEqual(
      (await overlayVotingLedger.getRoot()).toString(),
      initialParentRoot.toString(),
      "The failed overlay keeps its pending voting change",
    );
    assert.equal(
      (await context.votingLedger.getRoot()).toString(),
      initialParentRoot.toString(),
      "A reopened parent ledger has no partial voting commit",
    );
    await overlayVotingLedger.votingAccountStorage.clear();
    await overlayVotingLedger.merkleTreeStorage.clear();
  });
});

test("ZK-STLV-DIGEST-029 characterizes cache reuse by trace index", async () => {
  const originalAccount = Account.empty();
  originalAccount.balance = UInt64.from(7);
  const changedAccount = cloneAccount(originalAccount);
  changedAccount.balance = UInt64.from(99);
  const changedTrace = new StakingLedgerToVotingLedgerDigestTrace({
    publicInput: StakingLedgerToVotingLedgerProgramInput.empty(),
    privateInput: {
      accounts: [
        changedAccount,
        Account.empty(),
        Account.empty(),
        Account.empty(),
        Account.empty(),
      ],
    },
    stakingLedgerWitnesses: {},
    votingAccounts: {},
    votingLedgerWitnesses: {},
  });
  const traceReads: number[] = [];
  const traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage = {
    async getTrace(index) {
      traceReads.push(index);
      return index === 0 ? changedTrace : undefined;
    },
    async setTrace() {},
    async getAllTraces() {
      return [changedTrace];
    },
    async count() {
      return 1;
    },
    collectEntries() {
      return [];
    },
    clearEntries() {},
    async close() {},
  };
  const cachedProof = {
    cacheMarker: "proof-for-balance-7",
  } as unknown as SideLoadedStakingLedgerToVotingLedgerProof;
  const proofReads: string[] = [];
  const proofStorage: StakingLedgerToVotingLedgerProofStorage = {
    async getProof(id) {
      proofReads.push(id);
      return id === "0" ? cachedProof : undefined;
    },
    async setProof() {
      throw new Error("A cache hit must not replace the proof");
    },
    async getMergeProof() {
      return undefined;
    },
    async setMergeProof() {},
    async markAsMerged() {},
    async isMerged() {
      return false;
    },
    async mergeCount() {
      return 0;
    },
    async count() {
      return 1;
    },
    collectEntries() {
      return [];
    },
    clearEntries() {},
    async close() {},
  };
  const enqueued: number[] = [];
  const taskQueue = {
    async obliterate() {},
    async addTask(_name: string, input: { traceId: number }) {
      enqueued.push(input.traceId);
    },
  } as unknown as StakingLedgerToVotingLedgerTaskQueue;
  const prover = new StakingLedgerToVotingLedgerProver(
    {} as StakingLedger,
    traceStorage,
    proofStorage,
    { async setMany() {}, async close() {} },
    taskQueue,
  );

  await prover.digest(0, 0, undefined, 1);

  assert.equal(originalAccount.balance.toBigInt(), 7n);
  assert.equal(changedTrace.privateInput.accounts[0]!.balance.toBigInt(), 99n);
  assert.deepEqual(traceReads, [0]);
  assert.deepEqual(proofReads, ["0"]);
  assert.deepEqual(enqueued, []);
  assert.equal(await proofStorage.getProof("0"), cachedProof);
});

test("ZK-STLV-DIGEST-030 stops at a batch-start hole", async () => {
  const laterAccount = Account.empty();
  laterAccount.pk = PublicKey.empty();
  laterAccount.delegate = PublicKey.empty();
  laterAccount.balance = UInt64.from(71);
  const accountReads: bigint[] = [];
  const stakingLedger: StakingLedger = {
    async getRoot() {
      return Field(123);
    },
    async getAccount(index) {
      accountReads.push(index);
      return index === 0n ? Account.empty() : cloneAccount(laterAccount);
    },
    async getAllAccounts() {
      throw new Error("Unexpected getAllAccounts() call");
    },
    async accountCount() {
      throw new Error("Unexpected accountCount() call");
    },
    async setAccount() {
      throw new Error("Unexpected setAccount() call");
    },
    async getWitness() {
      throw new Error("Unexpected getWitness() call");
    },
    async setLeaf() {
      throw new Error("Unexpected setLeaf() call");
    },
    async close() {},
  };
  const votingRootReads: string[] = [];
  const votingLedger = {
    async getRoot() {
      votingRootReads.push("getRoot");
      return Field(456);
    },
    async close() {},
    collectEntries() {
      throw new Error("No voting entries must be collected");
    },
    clearEntries() {
      throw new Error("No voting entries must be cleared");
    },
  } as unknown as InMemoryVotingLedger;
  const traceWrites: number[] = [];
  const traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage = {
    async getTrace() {
      return undefined;
    },
    async setTrace(index) {
      traceWrites.push(index);
    },
    async getAllTraces() {
      return [];
    },
    async count() {
      return traceWrites.length;
    },
    collectEntries() {
      throw new Error("No trace entries must be collected");
    },
    clearEntries() {
      throw new Error("No trace entries must be cleared");
    },
    async close() {},
  };
  let publicationCount = 0;
  const tracer = new StakingLedgerToVotingLedgerTracer(
    stakingLedger,
    votingLedger,
    traceStorage,
    {
      async setMany() {
        publicationCount++;
      },
      async close() {},
    },
  );

  await tracer.digest(0, 0);

  assert.deepEqual(accountReads, [0n, 1n, 2n, 3n, 4n]);
  assert.deepEqual(votingRootReads, ["getRoot"]);
  assert.deepEqual(traceWrites, []);
  assert.equal(publicationCount, 0);
});

test("ZK-STLV-DIGEST-027 records a split account and Merkle-leaf write", async () => {
  await withContext(async (context) => {
    const accounts = context.testAccounts.map((source, index) => {
      const account = cloneAccount(source);
      account.delegate = context.testAccounts[index]!.pk;
      account.balance = UInt64.from(index + 41);
      account.tokenId = TokenId.default;
      return account;
    });
    const batch = await replaceBatch(context, accounts);
    const initialVotingRoot = await context.votingLedger.getRoot();
    const base = context.votingLedger;
    let accountWrites = 0;
    const ledger = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "setVotingAccount") {
          return async (publicKey: string, account: VotingAccount) => {
            accountWrites++;
            await target.setVotingAccount(publicKey, account);
          };
        }
        if (property === "setLeaf") {
          return async () => {
            throw new Error("injected setLeaf failure");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: context.stakingLedger,
      votingLedger: ledger,
    });

    const input = await makeInput(context);
    await assert.rejects(
      () => digest(input, batch),
      /injected setLeaf failure/,
    );
    assert.equal(accountWrites, 1);
    assert.equal(
      (
        await context.votingLedger.getVotingAccount(
          batch[0]!.delegate.toBase58(),
        )
      ).balance.toBigInt(),
      batch[0]!.balance.toBigInt(),
    );
    assert.equal(
      (await context.votingLedger.getRoot()).toString(),
      initialVotingRoot.toString(),
      "The account record changed while its Merkle leaf and root stayed old",
    );
  });
});
