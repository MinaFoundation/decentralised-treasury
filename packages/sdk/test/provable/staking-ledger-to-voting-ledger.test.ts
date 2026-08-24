import test from "node:test";
import assert from "node:assert";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
} from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account } from "../../src/provable/account.js";
import { createStakingLedgerToVotingLedgerTestContext } from "./context/staking-ledger-to-voting-ledger-context.js";
import { Field, Provable, PublicKey, TokenId, UInt64 } from "o1js";

const DEVNET_EMPTY_DELEGATE_BALANCE_BEFORE_OVERFLOW = 191_712_214_936_721_048n;
const DEVNET_CUSTOM_TOKEN_BALANCE = 18_446_739_073_709_551_615n;

test("staking ledger to voting ledger", async (t) => {
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

  await t.test("digest", async () => {
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

  await t.test(
    "ignores custom-token balances that overflow when combined",
    async () => {
      const { testAccounts, digest, votingLedger, stakingLedger } = context;
      const customBalances = [
        DEVNET_EMPTY_DELEGATE_BALANCE_BEFORE_OVERFLOW,
        DEVNET_CUSTOM_TOKEN_BALANCE,
        1n,
        2n,
        3n,
      ];

      for (let index = 0; index < ACCOUNT_BATCH_SIZE; index++) {
        const account = testAccounts[index]!;
        account.tokenId = Field(10_000 + index);
        account.delegate = PublicKey.empty();
        account.balance = UInt64.from(customBalances[index]!);
        await stakingLedger.setAccount(BigInt(index), account);
        await stakingLedger.setLeaf(BigInt(index), account);
      }

      const initialVotingLedgerRoot = await votingLedger.getRoot();
      const proof = await digest(testAccounts.slice(0, ACCOUNT_BATCH_SIZE));

      assert.equal(
        proof.publicOutput.votingLedgerRoot.toString(),
        initialVotingLedgerRoot.toString(),
        "custom-token accounts must not change the voting ledger root",
      );
      assert.equal(
        (
          await votingLedger.getVotingAccount(PublicKey.empty().toBase58())
        ).balance.toBigInt(),
        0n,
        "custom-token balances must not accumulate under the empty delegate",
      );
    },
  );

  await t.test(
    "uses token id rather than delegate shape to select voting balances",
    async () => {
      const { testAccounts, digest, votingLedger, stakingLedger } = context;
      const sharedDelegate = testAccounts[1]!.pk;

      for (let index = 0; index < ACCOUNT_BATCH_SIZE; index++) {
        const account = testAccounts[index]!;
        account.balance = UInt64.zero;
        if (index === 0) {
          account.tokenId = Field(20_000);
          account.delegate = sharedDelegate;
          account.balance = UInt64.from(DEVNET_CUSTOM_TOKEN_BALANCE);
        } else if (index === 1) {
          account.tokenId = TokenId.default;
          account.delegate = sharedDelegate;
          account.balance = UInt64.from(25n);
        }
        await stakingLedger.setAccount(BigInt(index), account);
        await stakingLedger.setLeaf(BigInt(index), account);
      }

      await digest(testAccounts.slice(0, ACCOUNT_BATCH_SIZE));

      assert.equal(
        (
          await votingLedger.getVotingAccount(sharedDelegate.toBase58())
        ).balance.toBigInt(),
        25n,
        "only the default-token account must contribute to voting weight",
      );
    },
  );

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
