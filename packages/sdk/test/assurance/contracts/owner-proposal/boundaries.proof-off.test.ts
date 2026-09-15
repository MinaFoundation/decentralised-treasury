import assert from "node:assert/strict";
import test from "node:test";
import { Mina, PrivateKey, UInt128, UInt32, UInt64 } from "o1js";
import { LIFECYCLE_PERIOD_DURATION } from "../../../../src/provable/contracts/treasury-owner.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  compileAuthorizationContracts,
  createOwnerDeploymentFixture,
  submitProposal,
} from "../helpers.js";

const lifecycleSpan = LIFECYCLE_PERIOD_DURATION.toBigint() * BigInt(4);
const maximumSafeLifecycleId =
  (UInt32.MAXINT().toBigint() - LIFECYCLE_PERIOD_DURATION.toBigint()) /
  lifecycleSpan;

test(
  "proof-off Owner and Proposal boundaries",
  { concurrency: 1 },
  async (t) => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await compileAuthorizationContracts(proofsEnabled);

    await t.test(
      "SC-OWNER-001/002/005/008 accept the first and last lifecycle-zero proposal slots and create a new account",
      async () => {
        for (const testCase of [
          { id: "SC-OWNER-001/005", slot: 0 },
          {
            id: "SC-OWNER-002",
            slot: Number(LIFECYCLE_PERIOD_DURATION.toBigint()),
          },
        ]) {
          const fixture = await createOwnerDeploymentFixture();
          if (testCase.slot > 0) {
            fixture.blockchain.incrementGlobalSlot(UInt32.from(testCase.slot));
          }
          const created = await submitProposal(fixture, {
            proposalKeyValue: 42_000n + BigInt(testCase.slot),
          });

          assert.equal(
            Mina.hasAccount(
              created.proposal.address,
              fixture.owner.deriveTokenId(),
            ),
            true,
            testCase.id,
          );
          assert.equal(
            (await created.proposal.amount.fetch())!.toBigInt(),
            1_000_000_000n,
            testCase.id,
          );
        }
      },
    );

    await t.test(
      "SC-OWNER-006/007 handle the maximum safe lifecycle ID and reject the next ID without effects",
      async () => {
        const acceptedFixture = await createOwnerDeploymentFixture();
        acceptedFixture.blockchain.incrementGlobalSlot(
          UInt32.from(maximumSafeLifecycleId * lifecycleSpan),
        );
        const accepted = await submitProposal(acceptedFixture, {
          lifecycleId: UInt32.from(maximumSafeLifecycleId),
          proposalKeyValue: 42_050n,
        });
        assert.equal(
          (await accepted.proposal.lifecycleId.fetch())!.toBigint(),
          maximumSafeLifecycleId,
        );

        const rejectedFixture = await createOwnerDeploymentFixture();
        const ownerBefore = rejectedFixture.blockchain.getAccount(
          rejectedFixture.owner.address,
        ).balance;
        const rejectedKey = PrivateKey.fromBigInt(42_051n);
        await assert.rejects(() =>
          submitProposal(rejectedFixture, {
            lifecycleId: UInt32.from(maximumSafeLifecycleId + 1n),
            proposalKeyValue: 42_051n,
          }),
        );
        assert.equal(
          rejectedFixture.blockchain
            .getAccount(rejectedFixture.owner.address)
            .balance.toBigInt(),
          ownerBefore.toBigInt(),
        );
        assert.equal(
          Mina.hasAccount(
            rejectedKey.toPublicKey(),
            rejectedFixture.owner.deriveTokenId(),
          ),
          false,
        );
      },
    );

    await t.test(
      "SC-OWNER-009/010 reject proposal account reuse and a false isNew state without charging a second bond",
      async () => {
        const fixture = await createOwnerDeploymentFixture();
        const created = await submitProposal(fixture, {
          proposalKeyValue: 42_060n,
          bondPayerIndex: 2,
        });
        const ownerBefore = fixture.blockchain.getAccount(
          fixture.owner.address,
        ).balance;
        const payerBefore = fixture.blockchain.getAccount(
          created.bondPayer,
        ).balance;

        await assert.rejects(() =>
          submitProposal(fixture, {
            proposalKeyValue: 42_060n,
            bondPayerIndex: 2,
          }),
        );

        assert.equal(
          fixture.blockchain
            .getAccount(fixture.owner.address)
            .balance.toBigInt(),
          ownerBefore.toBigInt(),
        );
        assert.equal(
          fixture.blockchain.getAccount(created.bondPayer).balance.toBigInt(),
          payerBefore.toBigInt(),
        );
      },
    );

    await t.test(
      "SC-OWNER-003/004 reject proposal slots outside the lifecycle period and preserve balances",
      async () => {
        const duration = Number(LIFECYCLE_PERIOD_DURATION.toBigint());
        const cases = [
          {
            id: "SC-OWNER-003",
            lifecycleId: 1,
            slot: duration * 4 - 1,
            key: 42_100n,
          },
          {
            id: "SC-OWNER-004",
            lifecycleId: 0,
            slot: duration + 1,
            key: 42_101n,
          },
        ] as const;

        for (const testCase of cases) {
          const fixture = await createOwnerDeploymentFixture();
          fixture.blockchain.incrementGlobalSlot(UInt32.from(testCase.slot));
          const ownerBalance = fixture.blockchain.getAccount(
            fixture.owner.address,
          ).balance;
          const proposalAddress = PrivateKey.fromBigInt(
            testCase.key,
          ).toPublicKey();

          await assert.rejects(
            () =>
              submitProposal(fixture, {
                lifecycleId: UInt32.from(testCase.lifecycleId),
                proposalKeyValue: testCase.key,
              }),
            undefined,
            testCase.id,
          );
          assert.equal(
            fixture.blockchain
              .getAccount(fixture.owner.address)
              .balance.toBigInt(),
            ownerBalance.toBigInt(),
            testCase.id,
          );
          assert.equal(
            Mina.hasAccount(proposalAddress, fixture.owner.deriveTokenId()),
            false,
            testCase.id,
          );
        }
      },
    );

    await t.test(
      "SC-PROPOSAL-014/015/016 characterize zero, one, and maximum amount boundaries",
      () => {
        const maximum = UInt64.MAXINT();
        const cases = [
          {
            name: "zero proposal",
            amount: UInt64.from(0),
            treasury: maximum,
            participation: 2_000n,
            approval: 5_100n,
          },
          {
            name: "one unit",
            amount: UInt64.from(1),
            treasury: maximum,
            participation: 2_000n,
            approval: 5_100n,
          },
          {
            name: "maximum equal amounts",
            amount: maximum,
            treasury: maximum,
            participation: 5_000n,
            approval: 7_000n,
          },
        ];

        for (const testCase of cases) {
          const result =
            TreasuryProposalSmartContract.calculateAcceptanceCriteria(
              UInt128.from(testCase.amount),
              UInt128.from(testCase.treasury),
              testCase.treasury,
            );
          assert.equal(
            result.requiredParticipationBp.toBigInt(),
            testCase.participation,
            testCase.name,
          );
          assert.equal(
            result.requiredApprovalBp.toBigInt(),
            testCase.approval,
            testCase.name,
          );
        }

        assert.throws(() =>
          TreasuryProposalSmartContract.calculateAcceptanceCriteria(
            UInt128.from(1),
            UInt128.from(0),
            UInt64.from(0),
          ),
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-009/010/011/012/013 separate quorum and approval boundaries",
      () => {
        const cases = [
          {
            name: "no votes",
            yay: 0,
            nay: 0,
            abstain: 0,
            expected: false,
          },
          {
            name: "abstain only",
            yay: 0,
            nay: 0,
            abstain: 10_000,
            expected: false,
          },
          {
            name: "one below quorum",
            yay: 6_000,
            nay: 3_999,
            abstain: 0,
            expected: false,
          },
          {
            name: "exact thresholds",
            yay: 6_000,
            nay: 4_000,
            abstain: 0,
            expected: true,
          },
          {
            name: "above thresholds",
            yay: 6_001,
            nay: 4_000,
            abstain: 0,
            expected: true,
          },
        ] as const;

        for (const testCase of cases) {
          const result = TreasuryProposalSmartContract.calculateApprovalStatus({
            yay: UInt128.from(testCase.yay),
            nay: UInt128.from(testCase.nay),
            abstain: UInt128.from(testCase.abstain),
            requiredParticipation: UInt128.from(10_000),
            requiredApprovalBp: UInt128.from(6_000),
          });
          assert.equal(
            result.approved.toBoolean(),
            testCase.expected,
            testCase.name,
          );
          assert.equal(
            result.voteResult.toString(),
            (testCase.expected
              ? ProposalStatus.APPROVED
              : ProposalStatus.REJECTED
            ).toString(),
            testCase.name,
          );
        }
      },
    );

    await t.test(
      "SC-PROPOSAL-022/025 records distinct proposer, bond payer, and recipient roles",
      async () => {
        const fixture = await createOwnerDeploymentFixture();
        const bondPayer = fixture.blockchain.testAccounts[2]!;
        const before = fixture.blockchain.getAccount(bondPayer).balance;
        const created = await submitProposal(fixture, {
          senderIndex: 1,
          bondPayerIndex: 2,
          recipientIndex: 3,
          proposalKeyValue: 42_200n,
        });

        assert.notEqual(
          created.sender.key.toPublicKey().toBase58(),
          created.bondPayer.key.toPublicKey().toBase58(),
        );
        assert.notEqual(
          created.bondPayer.key.toPublicKey().toBase58(),
          created.recipient.toBase58(),
        );
        assert.equal(
          fixture.blockchain.getAccount(bondPayer).balance.toBigInt(),
          before.toBigInt() - 100_000_000n,
        );
        assert.equal(
          fixture.blockchain
            .getAccount(fixture.owner.address)
            .balance.toBigInt(),
          100_000_000n,
        );
      },
    );
  },
);
