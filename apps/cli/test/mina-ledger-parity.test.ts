import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Field, TokenId } from "o1js";
import {
  checkStakingToVotingCircuit,
  computeMinaLedgerRoot,
  computeO1jsLedgerRoot,
  enrichGeneratedAccounts,
} from "../src/commands/mina-ledger-parity.js";

const MINA_GENERATED_ACCOUNTS = [
  {
    pk: "B62qjcySLWmLQyafwLvJmmvUpds443fqaVGV9sv6CNRBHqvWqP4GJfR",
    balance: "20.531909119",
  },
  {
    pk: "B62qipVKh9TvU2SVXcvFLMNwCgpM6beham2isgbt2o9rNT1HbhHaQS5",
    balance: "0",
  },
  {
    pk: "B62qqE37e28E6d5cZhv2Xx3Jkdygp9h1fy3dZMtXNHRbbcrtjPC4gMH",
    balance: "46.643365505",
  },
];

const MINA_PROTOCOL_ROOT =
  "jxSMvRskSmuv2vi7whQm31f4WZQGMoHe1zJkB3FQ1vTFWkisQtj";

const MINI_LEDGER = JSON.parse(
  await readFile(
    new URL(
      "../../../packages/sdk/test/test-ledger-mini.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<(typeof MINA_GENERATED_ACCOUNTS)[number] & Record<string, unknown>>;

async function checkCircuitAgainstOcaml(
  accounts: Parameters<typeof checkStakingToVotingCircuit>[0],
) {
  const [ocamlRoot, o1jsRoot] = await Promise.all([
    computeMinaLedgerRoot(accounts),
    computeO1jsLedgerRoot(accounts),
  ]);
  assert.equal(o1jsRoot, ocamlRoot);

  const circuit = await checkStakingToVotingCircuit(accounts, ocamlRoot);
  assert.equal(circuit.ocamlStakingRoot, ocamlRoot);
  assert.equal(circuit.inputStakingRoot, ocamlRoot);
  assert.equal(circuit.stakingRootMatches, true);
  return circuit;
}

test("hashes Mina-generated test accounts like the OCaml Mina ledger", async () => {
  assert.equal(
    await computeO1jsLedgerRoot(MINA_GENERATED_ACCOUNTS),
    MINA_PROTOCOL_ROOT,
  );
});

test("adds deterministic high-entropy zkApp account fields", async () => {
  const richLedger = enrichGeneratedAccounts(MINA_GENERATED_ACCOUNTS, {
    seed: "rich-ledger-regression",
    zkappPercentage: 100,
  });

  assert.equal(richLedger.zkappCount, MINA_GENERATED_ACCOUNTS.length);
  assert.ok(richLedger.accounts.every((account) => account.zkapp));
  assert.ok(richLedger.accounts.every((account) => account.permissions));
  assert.ok(richLedger.accounts.every((account) => account.receipt_chain_hash));
  const [ocamlRoot, o1jsRoot] = await Promise.all([
    computeMinaLedgerRoot(richLedger.accounts),
    computeO1jsLedgerRoot(richLedger.accounts),
  ]);
  assert.equal(ocamlRoot, o1jsRoot);
  assert.equal(
    ocamlRoot,
    "jxHcXQRkcDDXuM4w6H5TyDgHSEHZ7iVgymfDM2q3Nizso7dyTLu",
  );
});

test("evaluates the staking-to-voting circuit without proofs", async () => {
  const result = await checkCircuitAgainstOcaml(MINA_GENERATED_ACCOUNTS);

  assert.equal(result.proofsEnabled, false);
  assert.equal(result.mode, "raw-circuit-method-no-proofs");
  assert.equal(result.batchCount, 1);
  assert.equal(result.exhaustionIndex, 5);
  assert.equal(result.exhaustionCheckPassed, true);
  assert.equal(result.votingRootMatches, true);
  assert.equal(result.matches, true);
});

test("checks an empty staking ledger without proofs", async () => {
  const result = await checkCircuitAgainstOcaml([]);

  assert.equal(result.batchCount, 0);
  assert.equal(result.exhaustionIndex, 0);
  assert.equal(result.matches, true);
});

test("rejects a circuit input that is not tied to its OCaml root", async () => {
  await assert.rejects(
    checkStakingToVotingCircuit(
      MINA_GENERATED_ACCOUNTS,
      "jwkaDMeSMeL94hwJg6EYtSRD6gxB1BHpXnGKnZ1VW6jthKzgcef",
    ),
    /does not match the OCaml staking root/,
  );
});

test("checks high-entropy staking-to-voting circuit variations", async (t) => {
  const generatedInputs = MINI_LEDGER.map(({ pk, balance }) => ({
    pk,
    balance,
  }));
  const rich = (count: number, seed: string, zkappPercentage: number) =>
    enrichGeneratedAccounts(generatedInputs.slice(0, count), {
      seed,
      zkappPercentage,
    }).accounts;

  const sharedDelegate = rich(5, "circuit-shared-delegate", 100);
  sharedDelegate.forEach((account) => {
    account.delegate = sharedDelegate[0].pk;
  });

  const cyclicDelegates = rich(6, "circuit-cyclic-delegates", 100);
  cyclicDelegates.forEach((account, index) => {
    account.delegate = cyclicDelegates[(index + 2) % cyclicDelegates.length].pk;
  });

  const customTokens = rich(6, "circuit-custom-tokens", 100);
  [1, 4].forEach((index) => {
    customTokens[index].token = TokenId.toBase58(Field(10_000 + index));
    customTokens[index].delegate = undefined;
  });
  customTokens[1].balance = "191712214.936721048";
  customTokens[4].balance = "18446739073.709551615";

  const balanceEdges = rich(5, "circuit-balance-edges", 0);
  const balances = [
    "0",
    "0.000000001",
    "1",
    "4294967295.000000001",
    "18446744073.709551615",
  ];
  balanceEdges.forEach((account, index) => {
    account.balance = balances[index];
    account.delegate = account.pk;
  });

  const realVerificationKeys = [
    ...MINI_LEDGER.slice(0, 3),
    ...MINI_LEDGER.slice(15, 17),
  ];
  const variations = [
    {
      name: "one rich zkApp account",
      accounts: rich(1, "circuit-one-rich-zkapp", 100),
    },
    {
      name: "partial batch with mixed zkApp state",
      accounts: rich(4, "circuit-partial-mixed", 50),
    },
    {
      name: "exact batch with one shared delegate",
      accounts: sharedDelegate,
    },
    {
      name: "two padded batches with cyclic delegates",
      accounts: cyclicDelegates,
    },
    {
      name: "custom tokens with empty delegates",
      accounts: customTokens,
    },
    {
      name: "zero, dust, large, and maximum balances",
      accounts: balanceEdges,
    },
    {
      name: "real non-empty verification keys",
      accounts: realVerificationKeys,
    },
    {
      name: "nine rich accounts across two batches",
      accounts: rich(9, "circuit-nine-rich-accounts", 65),
    },
  ];

  for (const variation of variations) {
    await t.test(variation.name, async () => {
      const result = await checkCircuitAgainstOcaml(variation.accounts);
      assert.equal(result.proofsEnabled, false);
      assert.equal(result.exhaustionCheckPassed, true);
      assert.equal(result.votingRootMatches, true);
      assert.equal(result.matches, true);
    });
  }
});
