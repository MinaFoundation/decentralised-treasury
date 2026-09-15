import assert from "node:assert/strict";
import test from "node:test";
import {
  Bool,
  Field,
  Mina,
  Reducer,
  TokenId,
  UInt128,
  UInt32,
  UInt64,
  VerificationKey,
} from "o1js";
import { PrefixedMerkleWitness36 } from "../../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../../src/provable/staking-ledger-to-voting-ledger.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  ActionStateHistory,
  ActionStateHistoryTarget,
  SideLoadedVoteReducerProof,
  Vote,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import {
  compileAuthorizationContracts,
  createOwnerProposalFixture,
  sendTransaction,
} from "../helpers.js";

type TallyWeights = { yay: bigint; nay: bigint; abstain: bigint };

type TallyProofOverrides = {
  stakingLedgerRoot?: Field;
  initialVotingLedgerRoot?: Field;
  finalVotingLedgerRoot?: Field;
  voteVotingLedgerRoot?: Field;
  startIndex?: UInt64;
  exhausted?: Bool;
};

async function createTallyFixture(
  weights: TallyWeights,
  overrides: TallyProofOverrides = {},
) {
  const fixture = await createOwnerProposalFixture({ stakingSnapshot: true });
  for (let index = 1; index <= 5; index += 1) {
    const voter = fixture.blockchain.testAccounts[index]!;
    await sendTransaction(voter, async () => {
      await fixture.owner.vote(
        fixture.proposal.address,
        voter.key.toPublicKey(),
        Vote.YAY,
      );
    });
    fixture.blockchain.incrementGlobalSlot(1);
  }

  const onchainActionStates = fixture.blockchain.getAccount(
    fixture.proposal.address,
    fixture.proposalTokenId,
  ).zkapp!.actionState;
  const target = new ActionStateHistoryTarget({
    actionStateOne: onchainActionStates[0]!,
    actionStateTwo: onchainActionStates[1]!,
    actionStateThree: onchainActionStates[2]!,
    actionStateFour: onchainActionStates[3]!,
    actionStateFive: onchainActionStates[4]!,
  });
  const history = ActionStateHistory.fromTarget(target);
  for (const state of Object.values(history)) state.found = Bool(true);
  const voteInput = new VoteReducerPublicInput({
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot: overrides.voteVotingLedgerRoot ?? Field(0),
    fromNullifierRoot: Field(0),
    actionStateHistoryTarget: target,
  });
  const voteOutput = new VoteReducerPublicOutput({
    toActionsHash: target.actionStateOne,
    toNullifierRoot: Field(1),
    yay: UInt64.from(weights.yay),
    nay: UInt64.from(weights.nay),
    abstain: UInt64.from(weights.abstain),
    actionStateHistory: history,
  });
  const voteProof = (await SideLoadedVoteReducerProof.dummy(
    voteInput,
    voteOutput,
    2,
  )) as SideLoadedVoteReducerProof;
  const stakingInput = new StakingLedgerToVotingLedgerProgramInput({
    index: overrides.startIndex ?? UInt64.from(0),
    stakingLedgerRoot:
      overrides.stakingLedgerRoot ?? fixture.stakingLedgerRoot!,
    votingLedgerRoot: overrides.initialVotingLedgerRoot ?? Field(0),
  });
  const stakingOutput = new StakingLedgerToVotingLedgerProgramOutput({
    index: UInt64.from(0),
    votingLedgerRoot: overrides.finalVotingLedgerRoot ?? Field(0),
    exhausted: overrides.exhausted ?? Bool(true),
  });
  const stakingProof = (await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    stakingInput,
    stakingOutput,
    2,
  )) as SideLoadedStakingLedgerToVotingLedgerProof;
  const treasuryWitness = new PrefixedMerkleWitness36(
    fixture.treasurySnapshotWitness!,
  );
  fixture.blockchain.incrementGlobalSlot(UInt32.from(7_140));

  return { ...fixture, voteProof, stakingProof, treasuryWitness };
}

async function tallyThroughOwner(
  fixture: Awaited<ReturnType<typeof createTallyFixture>>,
): Promise<void> {
  await sendTransaction(fixture.feePayer, async () => {
    await fixture.owner.tallyVotes(
      fixture.proposal.address,
      fixture.voteProof,
      fixture.stakingProof,
      fixture.treasurySnapshotAccount!,
      fixture.treasuryWitness,
    );
  });
}

function exactThresholdWeights(): TallyWeights {
  const criteria = TreasuryProposalSmartContract.calculateAcceptanceCriteria(
    UInt128.from(1_000_000_000),
    UInt128.from(10_000_000_000),
    UInt64.from(10_000_000_000),
  );
  const total = criteria.requiredParticipation.toBigInt();
  const approvalBp = criteria.requiredApprovalBp.toBigInt();
  const yay = (total * approvalBp + 9_999n) / 10_000n;
  return { yay, nay: total - yay, abstain: 0n };
}

test(
  "proof-off Owner tally and approved execution",
  { concurrency: 1 },
  async (t) => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await compileAuthorizationContracts(proofsEnabled);

    await t.test(
      "SC-PROPOSAL-008/009/010 reject below-participation or no-directional tallies and preserve UNKNOWN",
      async () => {
        const required =
          TreasuryProposalSmartContract.calculateAcceptanceCriteria(
            UInt128.from(1_000_000_000),
            UInt128.from(10_000_000_000),
            UInt64.from(10_000_000_000),
          ).requiredParticipation.toBigInt();
        const cases = [
          {
            name: "one below participation",
            weights: { yay: required - 1n, nay: 0n, abstain: 0n },
            error: /Participation not met/,
          },
          {
            name: "no votes",
            weights: { yay: 0n, nay: 0n, abstain: 0n },
            error: /Participation not met/,
          },
          {
            name: "abstain only",
            weights: { yay: 0n, nay: 0n, abstain: required },
            error: /No approval votes cast/,
          },
        ];

        for (const testCase of cases) {
          const fixture = await createTallyFixture(testCase.weights);
          const eventCount = (
            await Mina.fetchEvents(fixture.owner.address, TokenId.default)
          ).length;
          await assert.rejects(
            () => tallyThroughOwner(fixture),
            testCase.error,
            testCase.name,
          );
          assert.equal(
            (await fixture.proposal.status.fetch())!.toString(),
            ProposalStatus.UNKNOWN.toString(),
            testCase.name,
          );
          assert.equal(
            (await Mina.fetchEvents(fixture.owner.address, TokenId.default))
              .length,
            eventCount,
            testCase.name,
          );
        }
      },
    );

    await t.test(
      "SC-PROPOSAL-002 rejects a direct custom-token tally bypass and preserves UNKNOWN",
      async () => {
        const fixture = await createTallyFixture(exactThresholdWeights());
        await assert.rejects(
          () =>
            sendTransaction(fixture.feePayer, async () => {
              await fixture.proposal.tallyVotes(
                fixture.voteProof,
                fixture.stakingProof,
                fixture.owner.address,
                fixture.treasurySnapshotAccount!,
                fixture.treasuryWitness,
              );
              await fixture.owner.approveAccountUpdate(fixture.proposal.self);
            }),
          /No external account updates allowed for this token/,
        );
        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.UNKNOWN.toString(),
        );
      },
    );

    await t.test(
      "SC-OWNER-016/027/029 and SC-PROPOSAL-012 accept an unrelated fee payer and the proof-off dummy-key boundary",
      async () => {
        const fixture = await createTallyFixture(exactThresholdWeights());
        assert.notEqual(
          fixture.feePayer.key.toPublicKey().toBase58(),
          fixture.owner.address.toBase58(),
        );
        const eventsBefore = (
          await Mina.fetchEvents(fixture.owner.address, TokenId.default)
        ).length;
        await tallyThroughOwner(fixture);

        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.APPROVED.toString(),
        );
        assert.equal(
          (await Mina.fetchEvents(fixture.owner.address, TokenId.default))
            .length,
          eventsBefore + 1,
        );
      },
    );

    await t.test(
      "SC-OWNER-017/018/024/025/026 record that proof-off cannot authenticate keys, programs, lifecycles, or proof bytes",
      async () => {
        const fixture = await createTallyFixture(exactThresholdWeights());
        const canonicalJson = fixture.voteProof.toJSON();
        const mutation = structuredClone(
          canonicalJson,
        ) as typeof canonicalJson & Record<string, unknown>;
        mutation.program = "other-program";
        mutation.lifecycleId = "different-lifecycle";
        fixture.voteProof = await SideLoadedVoteReducerProof.fromJSON(mutation);

        const proofMutation = structuredClone(mutation);
        proofMutation.proof = `${proofMutation.proof.slice(0, -1)}${
          proofMutation.proof.endsWith("A") ? "B" : "A"
        }`;
        await assert.rejects(
          () => SideLoadedVoteReducerProof.fromJSON(proofMutation),
          /Malformed input/,
        );

        const voteKey =
          TreasuryProposalSmartContract.voteReducerVerificationKey;
        const stakingKey =
          TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey;
        TreasuryProposalSmartContract.voteReducerVerificationKey = {
          ...VerificationKey.dummySync(),
          hash: Field(17),
        };
        TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
          {
            ...VerificationKey.dummySync(),
            hash: Field(18),
          };
        try {
          await tallyThroughOwner(fixture);
        } finally {
          TreasuryProposalSmartContract.voteReducerVerificationKey = voteKey;
          TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
            stakingKey;
        }

        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.APPROVED.toString(),
        );
        const roundTrip = fixture.voteProof.toJSON() as typeof canonicalJson &
          Record<string, unknown>;
        assert.equal(roundTrip.program, undefined);
        assert.equal(roundTrip.lifecycleId, undefined);
        assert.equal(roundTrip.proof, canonicalJson.proof);
      },
    );

    await t.test(
      "SC-OWNER-019/020/021/022/023 reject changed proof public inputs and keep tally state atomic",
      async () => {
        const cases: readonly {
          id: string;
          overrides: TallyProofOverrides;
          error: RegExp;
        }[] = [
          {
            id: "SC-OWNER-019",
            overrides: { stakingLedgerRoot: Field(19) },
            error: /staking ledger root does not match/,
          },
          {
            id: "SC-OWNER-020",
            overrides: { initialVotingLedgerRoot: Field(20) },
            error: /initial voting ledger root must be empty/,
          },
          {
            id: "SC-OWNER-021",
            overrides: {
              voteVotingLedgerRoot: Field(21),
              finalVotingLedgerRoot: Field(22),
            },
            error: /voting ledger root does not match/,
          },
          {
            id: "SC-OWNER-022",
            overrides: { startIndex: UInt64.from(1) },
            error: /staking ledger transformation must start at index 0/,
          },
          {
            id: "SC-OWNER-023",
            overrides: { exhausted: Bool(false) },
            error: /staking ledger to voting ledger proof did not exhaust/,
          },
        ];

        for (const testCase of cases) {
          const fixture = await createTallyFixture(
            exactThresholdWeights(),
            testCase.overrides,
          );
          const statusBefore = await fixture.proposal.status.fetch();
          const ownerBalanceBefore = fixture.blockchain.getAccount(
            fixture.owner.address,
          ).balance;
          await assert.rejects(
            () => tallyThroughOwner(fixture),
            testCase.error,
            testCase.id,
          );
          assert.equal(
            (await fixture.proposal.status.fetch())!.toString(),
            statusBefore!.toString(),
            testCase.id,
          );
          assert.equal(
            fixture.blockchain
              .getAccount(fixture.owner.address)
              .balance.toBigInt(),
            ownerBalanceBefore.toBigInt(),
            testCase.id,
          );
        }
      },
    );

    await t.test(
      "SC-OWNER-028 writes REJECTED for directional votes one unit below approval",
      async () => {
        const threshold = exactThresholdWeights();
        const fixture = await createTallyFixture({
          yay: threshold.yay - 1n,
          nay: threshold.nay + 1n,
          abstain: 0n,
        });
        await tallyThroughOwner(fixture);
        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.REJECTED.toString(),
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-003/018/026 rejects direct execution then executes through Owner",
      async () => {
        const fixture = await createTallyFixture(exactThresholdWeights());
        await tallyThroughOwner(fixture);
        await assert.rejects(
          () =>
            sendTransaction(fixture.blockchain.testAccounts[2]!, async () => {
              await fixture.proposal.execute(
                UInt64.from(1),
                fixture.blockchain.testAccounts[3]!.key.toPublicKey(),
              );
              await fixture.owner.approveAccountUpdate(fixture.proposal.self);
            }),
          /No external account updates allowed for this token/,
        );
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          0n,
        );
        fixture.blockchain.incrementGlobalSlot(UInt32.from(7_140));
        const recipientBalance = fixture.blockchain.getAccount(
          fixture.blockchain.testAccounts[3]!,
        ).balance;
        const ownerBalance = fixture.blockchain.getAccount(
          fixture.owner.address,
        ).balance;
        const eventsBefore = (
          await Mina.fetchEvents(fixture.owner.address, TokenId.default)
        ).length;
        const payout = UInt64.from(1_100_000_000);

        await sendTransaction(fixture.blockchain.testAccounts[2]!, async () => {
          await fixture.owner.executeProposal(
            fixture.proposal.address,
            fixture.blockchain.testAccounts[3]!.key.toPublicKey(),
            payout,
          );
        });

        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          payout.toBigInt(),
        );
        assert.equal(
          fixture.blockchain
            .getAccount(fixture.blockchain.testAccounts[3]!)
            .balance.toBigInt(),
          recipientBalance.toBigInt() + payout.toBigInt(),
        );
        assert.equal(
          fixture.blockchain
            .getAccount(fixture.owner.address)
            .balance.toBigInt(),
          ownerBalance.toBigInt() - payout.toBigInt(),
        );
        assert.equal(
          (await Mina.fetchEvents(fixture.owner.address, TokenId.default))
            .length,
          eventsBefore + 1,
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-023/024 retain the outstanding bond after a principal payout and send it to the recipient on completion",
      async () => {
        const fixture = await createTallyFixture(exactThresholdWeights());
        await tallyThroughOwner(fixture);
        fixture.blockchain.incrementGlobalSlot(UInt32.from(7_140));

        const executor = fixture.blockchain.testAccounts[2]!;
        const recipient = fixture.blockchain.testAccounts[3]!.key.toPublicKey();
        const bondPayerBalance = fixture.blockchain.getAccount(
          fixture.feePayer,
        ).balance;
        const recipientBalance =
          fixture.blockchain.getAccount(recipient).balance;
        const ownerBalance = fixture.blockchain.getAccount(
          fixture.owner.address,
        ).balance;

        await sendTransaction(executor, async () => {
          await fixture.owner.executeProposal(
            fixture.proposal.address,
            recipient,
            fixture.proposalAmount,
          );
        });
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          fixture.proposalAmount.toBigInt(),
        );
        assert.equal(
          fixture.blockchain
            .getAccount(fixture.owner.address)
            .balance.toBigInt(),
          ownerBalance.toBigInt() - fixture.proposalAmount.toBigInt(),
        );

        const bond = fixture.proposalAmount.toBigInt() / 10n;
        await sendTransaction(executor, async () => {
          await fixture.owner.executeProposal(
            fixture.proposal.address,
            recipient,
            UInt64.from(bond),
          );
        });
        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          fixture.proposalAmount.toBigInt() + bond,
        );
        assert.equal(
          fixture.blockchain.getAccount(recipient).balance.toBigInt(),
          recipientBalance.toBigInt() +
            fixture.proposalAmount.toBigInt() +
            bond,
        );
        assert.equal(
          fixture.blockchain.getAccount(fixture.feePayer).balance.toBigInt(),
          bondPayerBalance.toBigInt(),
          "the original bond payer does not receive the bond payout",
        );
      },
    );
  },
);
