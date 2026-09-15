import assert from "node:assert/strict";
import test from "node:test";
import { AccountUpdate, UInt64 } from "o1js";
import { ProposalStatus } from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  compileAuthorizationContracts,
  createStandaloneProposalFixture,
  sendTransaction,
} from "../helpers.js";

type StandaloneFixture = Awaited<
  ReturnType<typeof createStandaloneProposalFixture>
>;

async function executeDirect(
  fixture: StandaloneFixture,
  amount: UInt64,
  executorIndex = 1,
  payerIndex = 2,
): Promise<void> {
  const executor = fixture.blockchain.testAccounts[executorIndex]!;
  const payer = fixture.blockchain.testAccounts[payerIndex]!;
  await sendTransaction(executor, async () => {
    const payerUpdate = AccountUpdate.createSigned(payer.key.toPublicKey());
    payerUpdate.balance.subInPlace(amount);
    await fixture.proposal.execute(amount, fixture.recipient);
  }, [payer.key]);
}

async function approvedFixture() {
  return await createStandaloneProposalFixture({
    status: ProposalStatus.APPROVED,
    amount: UInt64.from(1_000),
  });
}

test(
  "proof-off Proposal payout and terminal pause behavior",
  { concurrency: 1 },
  async (t) => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await compileAuthorizationContracts(proofsEnabled);

    await t.test(
      "SC-PROPOSAL-017/018/019 enforce zero, full, and excessive payout boundaries",
      async () => {
        const cases = [
          { name: "zero", amount: 0n, accepts: true },
          { name: "full with bond", amount: 1_100n, accepts: true },
          { name: "one over", amount: 1_101n, accepts: false },
        ] as const;

        for (const testCase of cases) {
          const fixture = await approvedFixture();
          const recipientBefore = fixture.blockchain.getAccount(
            fixture.recipient,
          ).balance;
          const paidBefore = await fixture.proposal.paidOutAmount.fetch();

          if (testCase.accepts) {
            await executeDirect(fixture, UInt64.from(testCase.amount));
          } else {
            await assert.rejects(
              () => executeDirect(fixture, UInt64.from(testCase.amount)),
              /Amount to pay out is greater than the remaining amount to pay out/,
              testCase.name,
            );
          }

          const expectedPaid = testCase.accepts ? testCase.amount : 0n;
          const expectedRecipientDelta = testCase.accepts
            ? testCase.amount
            : 0n;
          assert.equal(
            (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
            expectedPaid,
            testCase.name,
          );
          assert.equal(
            fixture.blockchain.getAccount(fixture.recipient).balance.toBigInt(),
            recipientBefore.toBigInt() + expectedRecipientDelta,
            testCase.name,
          );
          if (!testCase.accepts) {
            assert.equal(paidBefore!.toBigInt(), 0n, testCase.name);
          }
        }
      },
    );

    await t.test(
      "SC-PROPOSAL-020/021 preserve cumulative payout and reject after completion",
      async () => {
        const fixture = await approvedFixture();
        const recipientBefore = fixture.blockchain.getAccount(
          fixture.recipient,
        ).balance;

        for (const amount of [400n, 700n]) {
          await executeDirect(fixture, UInt64.from(amount));
        }
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          1_100n,
        );
        assert.equal(
          fixture.blockchain.getAccount(fixture.recipient).balance.toBigInt(),
          recipientBefore.toBigInt() + 1_100n,
        );

        await assert.rejects(
          () => executeDirect(fixture, UInt64.from(1)),
          /Amount to pay out is greater than the remaining amount to pay out/,
        );
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          1_100n,
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-003/026/027 allow distinct executor, payer, and recipient on a direct approved call",
      async () => {
        const fixture = await approvedFixture();
        const executor = fixture.blockchain.testAccounts[1]!;
        const payer = fixture.blockchain.testAccounts[2]!;
        assert.notEqual(
          executor.key.toPublicKey().toBase58(),
          payer.key.toPublicKey().toBase58(),
        );
        assert.notEqual(
          payer.key.toPublicKey().toBase58(),
          fixture.recipient.toBase58(),
        );

        await executeDirect(fixture, UInt64.from(1), 1, 2);
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          1n,
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-005 records an approved state change nested under an unrelated signed account update",
      async () => {
        const fixture = await approvedFixture();
        const unrelated = fixture.blockchain.testAccounts[4]!;
        const payer = fixture.blockchain.testAccounts[2]!;

        await sendTransaction(
          fixture.feePayer,
          async () => {
            const unrelatedParent = AccountUpdate.createSigned(
              unrelated.key.toPublicKey(),
            );
            const payerUpdate = AccountUpdate.createSigned(
              payer.key.toPublicKey(),
            );
            payerUpdate.balance.subInPlace(UInt64.from(1));
            await fixture.proposal.execute(UInt64.from(1), fixture.recipient);
            unrelatedParent.approve(fixture.proposal.self);
          },
          [unrelated.key, payer.key],
        );

        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          1n,
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-028 unpause overwrites APPROVED and REJECTED with UNKNOWN",
      async () => {
        for (const status of [
          ProposalStatus.APPROVED,
          ProposalStatus.REJECTED,
        ]) {
          const fixture = await createStandaloneProposalFixture({ status });
          await sendTransaction(fixture.feePayer, async () => {
            await fixture.proposal.togglePause();
          });
          assert.equal(
            (await fixture.proposal.status.fetch())!.toString(),
            ProposalStatus.PAUSED.toString(),
          );

          await sendTransaction(fixture.feePayer, async () => {
            await fixture.proposal.togglePause();
          });
          assert.equal(
            (await fixture.proposal.status.fetch())!.toString(),
            ProposalStatus.UNKNOWN.toString(),
          );
        }
      },
    );
  },
);
