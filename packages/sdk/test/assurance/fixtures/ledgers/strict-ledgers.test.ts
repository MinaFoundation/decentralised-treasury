import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bool, Field } from "o1js";
import { Account } from "../../../../src/provable/account.js";
import { StrictCallLog, type ExpectedLedgerCall } from "./strict-call-log.js";
import {
  buildStrictNullifierLedger,
  buildStrictStakingLedger,
  buildStrictVotingLedger,
  deterministicAccount,
  deterministicVotingAccount,
  deterministicWitness255,
  deterministicWitness36,
} from "./strict-ledgers.js";

function hasMessage(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.message === expected;
}

describe("strict assurance ledger fixtures", () => {
  it("rejects reordered and missing calls", () => {
    const expected = [
      { ledger: "staking", method: "getAccount", key: "0" },
      { ledger: "staking", method: "getWitness", key: "0" },
    ] satisfies ExpectedLedgerCall[];
    const calls = new StrictCallLog(expected);

    assert.throws(
      () => calls.record(expected[1]!),
      hasMessage(
        "Unexpected ledger call 1: expected staking.getAccount(0); received staking.getWitness(0).",
      ),
    );
    calls.record(expected[0]!);
    assert.throws(
      () => calls.assertComplete(),
      hasMessage("Missing ledger call 2: expected staking.getWitness(0)."),
    );
    calls.record(expected[1]!);
    calls.assertComplete();
    assert.deepEqual(
      calls.snapshot().map(({ sequence, method }) => ({ sequence, method })),
      [
        { sequence: 1, method: "getAccount" },
        { sequence: 2, method: "getWitness" },
      ],
    );
  });

  it("supports an empty staking ledger transcript", async () => {
    const fixture = buildStrictStakingLedger({
      expectedCalls: [
        { ledger: "staking", method: "getAllAccounts" },
        { ledger: "staking", method: "accountCount" },
        { ledger: "staking", method: "getRoot" },
        { ledger: "staking", method: "close" },
      ],
      allAccountReads: [[]],
      accountCountReads: [0],
      rootReads: [Field(0)],
    });

    assert.deepEqual(await fixture.ledger.getAllAccounts(), []);
    assert.equal(await fixture.ledger.accountCount(), 0);
    assert.equal((await fixture.ledger.getRoot()).toBigInt(), 0n);
    await fixture.ledger.close();
    fixture.assertConsumed();
    assert.equal(fixture.snapshot().closed, true);
  });

  it("supports dense, sparse, boundary, and duplicate staking accounts", async () => {
    const boundaryIndex = 2n ** 35n - 1n;
    const first = deterministicAccount(0, 1n);
    const gap = Account.empty();
    const duplicate = deterministicAccount(0, 9_000_000_000n, 1);
    const cases = [
      { name: "dense start", index: 0n, expected: first },
      { name: "sparse gap", index: 4n, expected: gap },
      { name: "boundary duplicate", index: boundaryIndex, expected: duplicate },
    ] as const;
    const fixture = buildStrictStakingLedger({
      expectedCalls: cases.map(({ index }) => ({
        ledger: "staking",
        method: "getAccount",
        key: index.toString(),
      })),
      accountReads: cases.map(({ index, expected }) => ({
        key: index.toString(),
        value: expected,
      })),
    });

    for (const testCase of cases) {
      const actual = await fixture.ledger.getAccount(testCase.index);
      assert.equal(
        actual.balance.toBigInt(),
        testCase.expected.balance.toBigInt(),
        testCase.name,
      );
      assert.equal(
        actual.pk.toBase58(),
        testCase.expected.pk.toBase58(),
        testCase.name,
      );
    }
    fixture.assertConsumed();
    assert.equal(first.pk.toBase58(), duplicate.pk.toBase58());
    assert.equal(Account.isEmpty(gap).toBoolean(), true);
  });

  it("rejects missing and replayed staking reads", async () => {
    const cases = [
      { name: "missing", entries: [] },
      {
        name: "replayed",
        entries: [{ key: "3", value: deterministicAccount(1, 3n) }],
      },
    ] as const;

    for (const testCase of cases) {
      const expectedCalls = [
        { ledger: "staking", method: "getAccount", key: "3" },
        ...(testCase.name === "replayed"
          ? [{ ledger: "staking" as const, method: "getAccount", key: "3" }]
          : []),
      ] satisfies ExpectedLedgerCall[];
      const fixture = buildStrictStakingLedger({
        expectedCalls,
        accountReads: testCase.entries,
      });

      if (testCase.name === "replayed") {
        assert.equal(
          (await fixture.ledger.getAccount(3n)).balance.toBigInt(),
          3n,
        );
      }
      await assert.rejects(
        () => fixture.ledger.getAccount(3n),
        hasMessage("Missing scripted staking account read for 3."),
        testCase.name,
      );
      fixture.assertConsumed();
    }
  });

  it("returns explicitly wrong staking roots and witnesses", async () => {
    const wrongRoot = Field(987_654_321n);
    const wrongWitness = deterministicWitness36(7n, 700n);
    const fixture = buildStrictStakingLedger({
      expectedCalls: [
        { ledger: "staking", method: "getWitness", key: "7" },
        { ledger: "staking", method: "getRoot" },
      ],
      witnessReads: [{ key: "7", value: wrongWitness }],
      rootReads: [wrongRoot],
    });

    const actualWitness = await fixture.ledger.getWitness(7n);
    const actualRoot = await fixture.ledger.getRoot();
    assert.equal(actualWitness.calculateIndex().toBigInt(), 7n);
    assert.equal(actualWitness.path[0]!.toBigInt(), 700n);
    assert.equal(actualRoot.toBigInt(), wrongRoot.toBigInt());
    fixture.assertConsumed();
  });

  it("injects staking write failures before and after mutation", async () => {
    const account = deterministicAccount(0, 55n);
    const cases = [
      {
        timing: "before",
        method: "setAccount",
        state: "accounts",
        persisted: false,
      },
      { timing: "after", method: "setLeaf", state: "leaves", persisted: true },
    ] as const;

    for (const testCase of cases) {
      const fixture = buildStrictStakingLedger({
        expectedCalls: [
          { ledger: "staking", method: testCase.method, key: "2" },
        ],
        writeFailures: [
          { method: testCase.method, key: "2", timing: testCase.timing },
        ],
      });
      const operation =
        testCase.method === "setAccount"
          ? () => fixture.ledger.setAccount(2n, account)
          : () => fixture.ledger.setLeaf(2n, account);

      await assert.rejects(
        operation,
        hasMessage(
          `Injected ${testCase.timing} failure at staking.${testCase.method}(2).`,
        ),
      );
      const state = fixture.snapshot()[testCase.state];
      assert.equal(state.has("2"), testCase.persisted, testCase.timing);
      fixture.assertConsumed();
    }
  });

  it("scripts duplicate voting keys and rejects a replay beyond the script", async () => {
    const key = deterministicAccount(0, 1n).pk.toBase58();
    const fixture = buildStrictVotingLedger({
      expectedCalls: Array.from({ length: 3 }, () => ({
        ledger: "voting" as const,
        method: "getVotingAccount",
        key,
      })),
      accountReads: [
        { key, value: deterministicVotingAccount(10n) },
        { key, value: deterministicVotingAccount(10n) },
      ],
    });

    const first = await fixture.ledger.getVotingAccount(key);
    first.balance = first.balance.add(90);
    assert.equal(first.balance.toBigInt(), 100n);
    assert.equal(
      (await fixture.ledger.getVotingAccount(key)).balance.toBigInt(),
      10n,
    );
    await assert.rejects(
      () => fixture.ledger.getVotingAccount(key),
      hasMessage(`Missing scripted voting account read for ${key}.`),
    );
    fixture.assertConsumed();
  });

  it("supports wrong VoteReducer witnesses and roots", async () => {
    const key = deterministicAccount(1, 1n).pk.toBase58();
    const wrongWitness = deterministicWitness255(9n, 900n);
    const cases = [
      {
        name: "voting",
        run: async () => {
          const fixture = buildStrictVotingLedger({
            expectedCalls: [
              { ledger: "voting", method: "getWitness", key },
              { ledger: "voting", method: "getRoot" },
            ],
            witnessReads: [{ key, value: wrongWitness }],
            rootReads: [Field(111n)],
          });
          return {
            fixture,
            witness: await fixture.ledger.getWitness(key),
            root: await fixture.ledger.getRoot(),
          };
        },
      },
      {
        name: "nullifier",
        run: async () => {
          const fixture = buildStrictNullifierLedger({
            expectedCalls: [
              { ledger: "nullifier", method: "getWitness", key },
              { ledger: "nullifier", method: "getRoot" },
            ],
            witnessReads: [{ key, value: wrongWitness }],
            rootReads: [Field(222n)],
          });
          return {
            fixture,
            witness: await fixture.ledger.getWitness(key),
            root: await fixture.ledger.getRoot(),
          };
        },
      },
    ] as const;

    for (const testCase of cases) {
      const { fixture, witness, root } = await testCase.run();
      assert.equal(witness.calculateIndex().toBigInt(), 9n, testCase.name);
      assert.ok(
        root.toBigInt() === 111n || root.toBigInt() === 222n,
        testCase.name,
      );
      fixture.assertConsumed();
    }
  });

  it("scripts duplicate nullifiers and an after-write failure", async () => {
    const key = deterministicAccount(0, 1n).pk.toBase58();
    const fixture = buildStrictNullifierLedger({
      expectedCalls: [
        { ledger: "nullifier", method: "getNullifier", key },
        { ledger: "nullifier", method: "getNullifier", key },
        { ledger: "nullifier", method: "setNullifier", key },
      ],
      nullifierReads: [
        { key, value: Bool(false) },
        { key, value: Bool(true) },
      ],
      writeFailures: [{ method: "setNullifier", key, timing: "after" }],
    });

    assert.equal((await fixture.ledger.getNullifier(key)).toBoolean(), false);
    assert.equal((await fixture.ledger.getNullifier(key)).toBoolean(), true);
    await assert.rejects(
      () => fixture.ledger.setNullifier(key, Bool(true)),
      hasMessage(`Injected after failure at nullifier.setNullifier(${key}).`),
    );
    assert.equal(fixture.snapshot().nullifiers.get(key)?.toBoolean(), true);
    fixture.assertConsumed();
  });

  it("reports unused scripted reads and write failures", () => {
    const readFixture = buildStrictVotingLedger({
      expectedCalls: [],
      accountReads: [{ key: "unused", value: deterministicVotingAccount(1n) }],
    });
    const failureFixture = buildStrictVotingLedger({
      expectedCalls: [],
      writeFailures: [{ method: "setLeaf", timing: "before" }],
    });

    assert.throws(
      () => readFixture.assertConsumed(),
      hasMessage("Unused scripted voting account reads: unused:1."),
    );
    assert.throws(
      () => failureFixture.assertConsumed(),
      hasMessage("Unused injected voting write failures: 1."),
    );
  });
});
