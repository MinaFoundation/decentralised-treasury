import test from "node:test";
import assert from "node:assert";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
} from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account } from "../../src/provable/account.js";
import { createStakingLedgerToVotingLedgerTestContext } from "./context/staking-ledger-to-voting-ledger-context.js";
import { Provable } from "o1js";

test("staking ledger to voting ledger", { concurrency: 1 }, async (t) => {
  let context: Awaited<
    ReturnType<typeof createStakingLedgerToVotingLedgerTestContext>
  >;

  t.beforeEach(async () => {
    context = await createStakingLedgerToVotingLedgerTestContext({
      maxAccounts: ACCOUNT_BATCH_SIZE * 2,
    });
  });

  t.afterEach(async () => {
    await context.cleanup();
  });

  await t.test("compile", async () => {
    await context.compile();
  });

  await t.test("digest", async (t) => {
    await t.test("digest a batch of accounts", async () => {
      const { testAccounts, digest, votingLedger } = context;
      const localAccounts = testAccounts.slice(0, 5);

      const proof = await digest(localAccounts);

      assert(
        (await votingLedger.getRoot()).toString() ===
          proof.publicOutput.votingLedgerRoot.toString(),
        "final voting ledger root should match proof output",
      );
      assert(
        proof.publicInput.index.toBigInt() === 0n,
        "proof input index does not match expected batch index",
      );
      assert(
        proof.publicOutput.index.toBigInt() === BigInt(ACCOUNT_BATCH_SIZE - 1),
        "proof output index does not match expected batch end index",
      );
      assert(
        proof.publicOutput.exhausted.toBoolean() === false,
        "digest proof should not be exhausted",
      );
    });
  });

  await t.test("merge", async () => {
    const { testAccounts, digest, votingLedger, stakingLedger } = context;
    const proof1 = await digest(testAccounts.slice(0, ACCOUNT_BATCH_SIZE));

    const secondBatch = testAccounts.slice(
      ACCOUNT_BATCH_SIZE,
      ACCOUNT_BATCH_SIZE * 2,
    );
    while (secondBatch.length < ACCOUNT_BATCH_SIZE) {
      secondBatch.push(Account.empty());
    }
    const { proof: proof2 } = await StakingLedgerToVotingLedger.digest(
      {
        index: ACCOUNT_BATCH_SIZE,
        stakingLedgerRoot: await stakingLedger.getRoot(),
        votingLedgerRoot: await votingLedger.getRoot(),
      },
      secondBatch,
    );
    const { proof: finalProof } = await StakingLedgerToVotingLedger.merge(
      proof1.publicInput,
      proof1,
      proof2,
    );

    assert(
      (await votingLedger.getRoot()).toString() ===
        finalProof.publicOutput.votingLedgerRoot.toString(),
      "calculated voting ledger root does not match the proven voting ledger root",
    );
  });

  await t.test("exhaust", async () => {
    const { testAccounts, digest, votingLedger, stakingLedger } = context;
    const proof1 = await digest(testAccounts.slice(0, ACCOUNT_BATCH_SIZE));

    const secondBatch = testAccounts.slice(
      ACCOUNT_BATCH_SIZE,
      ACCOUNT_BATCH_SIZE * 2,
    );
    while (secondBatch.length < ACCOUNT_BATCH_SIZE) {
      secondBatch.push(Account.empty());
    }
    const { proof: proof2 } = await StakingLedgerToVotingLedger.digest(
      {
        index: ACCOUNT_BATCH_SIZE,
        stakingLedgerRoot: await stakingLedger.getRoot(),
        votingLedgerRoot: await votingLedger.getRoot(),
      },
      secondBatch,
    );

    const { proof: mergedProof } = await StakingLedgerToVotingLedger.merge(
      proof1.publicInput,
      proof1,
      proof2,
    );

    const { proof } = await StakingLedgerToVotingLedger.exhaust(
      mergedProof.publicInput,
      mergedProof,
    );

    Provable.log("exhaust proof", proof.publicInput, proof.publicOutput);

    assert(
      proof.publicOutput.exhausted.toBoolean(),
      "exhaust proof should set exhausted to true",
    );
    assert(
      proof.publicInput.index.toBigInt() === 0n,
      "exhaust proof should start at index 0",
    );
    assert(
      proof.publicOutput.index.toBigInt() ===
        BigInt(ACCOUNT_BATCH_SIZE * 2 - 1),
      "exhaust proof output index should match last processed account",
    );
  });
});
