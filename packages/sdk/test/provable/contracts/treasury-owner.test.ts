import { it, after } from "node:test";
import assert from "node:assert";
import {
  LIFECYCLE_PERIOD_DURATION,
  LifecyclePeriod,
  TreasuryOwnerSmartContract,
} from "../../../src/provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  AccountUpdate,
  fetchAccount,
  Field,
  method,
  Mina,
  Permissions,
  PrivateKey,
  Provable,
  PublicKey,
  Reducer,
  SmartContract,
  State,
  state,
  UInt32,
  UInt64,
} from "o1js";
import {
  Vote,
  VOTE_ACTION_BATCH_SIZE,
  VoteAction,
  VoteReducer,
  voteReducerContext,
  SideLoadedVoteReducerProof,
  VoteReducerProof,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { BOND_AMOUNT_DIVISOR } from "../../../src/provable/contracts/treasury-constants.js";

import { appendActionToHashList } from "../../../src/provable/hashing-helpers.js";
import {
  TreasuryProposalSmartContract,
  ProposalStatus,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  ACCOUNT_BATCH_SIZE,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  StakingLedgerToVotingLedgerProof,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { Account } from "../../../src/provable/account.js";
import { createVoteReducerTestContext } from "../context/contracts/vote-reducer-context.js";

const voteReducerTestContext = createVoteReducerTestContext();
import { PersistentNullifierLedger } from "../../../src/ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { PersistentVotingLedger } from "../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteNullifierLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

const Local = await Mina.LocalBlockchain({
  proofsEnabled,
});

Mina.setActiveInstance(Local);

const lifecycleId = "treasury-owner-test";

const votingLedgerStorage = createSqliteVotingLedgerStorage(lifecycleId);
const votingLedger = new PersistentVotingLedger(
  votingLedgerStorage.votingAccountStorage,
  votingLedgerStorage.merkleTreeStorage,
);
const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(lifecycleId);
const nullifierLedger = new PersistentNullifierLedger(
  nullifierLedgerStorage.nullifierStorage,
  nullifierLedgerStorage.merkleTreeStorage,
);
const stakingLedgerStorage = createSqliteStakingLedgerStorage(lifecycleId);
const stakingLedger = new PersistentStakingLedger(
  stakingLedgerStorage.accountStorage,
  stakingLedgerStorage.merkleTreeStorage,
);

voteReducerContext.set({
  votingLedger,
  nullifierLedger,
});

stakingLedgerToVotingLedgerContext.set({
  stakingLedger,
  votingLedger,
});

after(async () => {
  await votingLedger.close();
  await nullifierLedger.close();
  await stakingLedger.close();
});

const multisigPrivateKey1 = PrivateKey.random();
const multisigPublicKey1 = multisigPrivateKey1.toPublicKey();
const multisigPrivateKey2 = PrivateKey.random();
const multisigPublicKey2 = multisigPrivateKey2.toPublicKey();
const multisigPrivateKey3 = PrivateKey.random();
const multisigPublicKey3 = multisigPrivateKey3.toPublicKey();
const multisigPrivateKey4 = PrivateKey.random();
const multisigPublicKey4 = multisigPrivateKey4.toPublicKey();
const multisigPrivateKey5 = PrivateKey.random();
const multisigPublicKey5 = multisigPrivateKey5.toPublicKey();

const multisigSigners: [PrivateKey, PublicKey][] = [
  [multisigPrivateKey1, multisigPublicKey1],
  [multisigPrivateKey2, multisigPublicKey2],
  [multisigPrivateKey3, multisigPublicKey3],
  [multisigPrivateKey4, multisigPublicKey4],
  [multisigPrivateKey5, multisigPublicKey5],
];

const multiSigCommitment = MultisigSignatures.createCommitment([
  multisigPublicKey1,
  multisigPublicKey2,
  multisigPublicKey3,
  multisigPublicKey4,
  multisigPublicKey5,
]);

console.log("compiling vote reducer");
const { verificationKey: voteReducerVerificationKey } =
  await VoteReducer.compile({
    proofsEnabled,
  });
console.log("compiled vote reducer", voteReducerVerificationKey);

console.time("compile staking ledger to voting ledger");
const { verificationKey: stakingLedgerToVotingLedgerVerificationKey } =
  await StakingLedgerToVotingLedger.compile({
    proofsEnabled,
  });

TreasuryProposalSmartContract.voteReducerVerificationKey =
  voteReducerVerificationKey;
TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
  stakingLedgerToVotingLedgerVerificationKey;
TreasuryProposalSmartContract.emptyNullifierRoot =
  await nullifierLedger.getRoot();

Provable.log(
  "empty nullifier root",
  TreasuryProposalSmartContract.emptyNullifierRoot,
);

console.time("compile TreasuryProposalSmartContract");
await TreasuryProposalSmartContract.compile();
TreasuryOwnerSmartContract.proposalContractVerificationKey =
  TreasuryProposalSmartContract._verificationKey;
TreasuryPauseControllerSmartContract.multisigParticipants = [
  multisigPublicKey1,
  multisigPublicKey2,
  multisigPublicKey3,
  multisigPublicKey4,
  multisigPublicKey5,
];

Provable.log(
  "TreasuryProposalSmartContract analysis",
  await TreasuryProposalSmartContract.analyzeMethods(),
);

await TreasuryPauseControllerSmartContract.compile();
await TreasuryOwnerSmartContract.compile();

const testAccount = Local.testAccounts[1];
const voterPrivateKey1 = PrivateKey.random();
const voterPublicKey1 = voterPrivateKey1.toPublicKey();
const voterPrivateKey2 = PrivateKey.random();
const voterPublicKey2 = voterPrivateKey2.toPublicKey();

const treasuryOwnerPrivateKey = PrivateKey.random();
const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
const pauseControllerPrivateKey = PrivateKey.random();
const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();

const treasuryProposalPrivateKey = PrivateKey.random();
const treasuryProposalPublicKey = treasuryProposalPrivateKey.toPublicKey();

const amount = UInt64.from(100000000000);

const treasuryFundingAccount = Local.testAccounts[2];

const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
const pauseController = new TreasuryPauseControllerSmartContract(
  pauseControllerPublicKey,
);
const treasuryProposal = new TreasuryProposalSmartContract(
  treasuryProposalPublicKey,
  treasuryOwner.deriveTokenId(),
);

const treasuryProposalRecipientPrivateKey = PrivateKey.random();
const treasuryProposalRecipientPublicKey =
  treasuryProposalRecipientPrivateKey.toPublicKey();

const dummyZkAppUri = "https://example.com";
let treasuryOwnerBalanceSnapshot = UInt64.from(0);

async function printNonce(publicKey: PublicKey, memo: string) {
  try {
    const account = Local.getAccount(publicKey);
    console.log(
      `Nonce for (${memo}) ${publicKey.toBase58()}: ${account.nonce.toBigint()}`,
    );
  } catch (error) {
    console.error(
      `Error fetching nonce for (${memo}) ${publicKey.toBase58()}: ${error}`,
    );
  }
}

it("should compile", async () => {
  await TreasuryOwnerSmartContract.compile();
  Provable.log("analysis", await TreasuryOwnerSmartContract.analyzeMethods());
});

it("should create a proposal", async () => {
  await (async () => {
    console.log("deploying pause controller");
    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);
      await pauseController.deploy();
    });

    tx.sign([testAccount.key, pauseControllerPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();
  })();

  await (async () => {
    await fetchAccount({ publicKey: pauseControllerPublicKey });
    const storedCommitment = pauseController.multisigCommitment.get();
    assert(
      storedCommitment.equals(multiSigCommitment).toBoolean(),
      "Pause controller multisig commitment mismatch",
    );
  })();

  await (async () => {
    console.log("deploying treasury owner");
    TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
    TreasuryOwnerSmartContract.pauseControllerPublicKey =
      pauseControllerPublicKey;
    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);
      await treasuryOwner.deploy();
    });

    tx.sign([testAccount.key, treasuryOwnerPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();

    await printNonce(treasuryOwnerPublicKey, "treasury owner deployed");
  })();

  await (async () => {
    console.log("funding treasury owner");
    const treasuryFunding = Local.getAccount(
      treasuryFundingAccount,
    ).balance.sub(UInt64.from(1 * 10 ** 9));

    const tx = await Mina.transaction(testAccount, async () => {
      const testAccountUpdate = AccountUpdate.createSigned(
        treasuryFundingAccount,
      );
      // fund the treasury owner account
      testAccountUpdate.balance.subInPlace(treasuryFunding);

      const treasuryOwnerAccountUpdate = AccountUpdate.createSigned(
        treasuryOwnerPublicKey,
      );
      treasuryOwnerAccountUpdate.balance.addInPlace(treasuryFunding);
    });

    tx.sign([
      testAccount.key,
      treasuryOwnerPrivateKey,
      treasuryFundingAccount.key,
    ]);
    await tx.prove();
    const pendingTx = await tx.send();
    await pendingTx.wait();
    treasuryOwnerBalanceSnapshot = Local.getAccount(
      treasuryOwnerPublicKey,
    ).balance;
  })();

  await (async () => {
    console.log("setting network state");
    const treasuryOwnerAccount = Account.empty();
    treasuryOwnerAccount.pk = treasuryOwnerPublicKey;
    treasuryOwnerAccount.delegate = treasuryOwnerPublicKey;
    treasuryOwnerAccount.balance = treasuryOwnerBalanceSnapshot;
    await stakingLedger.setAccount(0n, treasuryOwnerAccount);
    await stakingLedger.setLeaf(0n, treasuryOwnerAccount);

    const stakingLedgerAccount1 = {
      ...Account.empty(),
      pk: voterPublicKey1,
      delegate: voterPublicKey1,
      balance: UInt64.from(300),
    };

    const stakingLedgerAccount2 = {
      ...Account.empty(),
      pk: voterPublicKey2,
      delegate: voterPublicKey2,
      balance: UInt64.from(100),
    };

    await stakingLedger.setAccount(1n, stakingLedgerAccount1);
    await stakingLedger.setAccount(2n, stakingLedgerAccount2);
    await stakingLedger.setLeaf(1n, stakingLedgerAccount1);
    await stakingLedger.setLeaf(2n, stakingLedgerAccount2);

    const stakingLedgerRoot = await stakingLedger.getRoot();
    Local.setNetworkState({
      ...Local.getNetworkState(),
      stakingEpochData: {
        ...Local.getNetworkState().stakingEpochData,
        ledger: {
          ...Local.getNetworkState().stakingEpochData.ledger,
          hash: stakingLedgerRoot,
          // TODO: manage the total currency across the test suite in a better way
          totalCurrency: UInt64.from(500),
        },
      },
    });

    const bondPayer = Local.testAccounts[0];

    console.log("creating proposal");
    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);

      const bondPayerAccountUpdate = AccountUpdate.createSigned(bondPayer);
      bondPayerAccountUpdate.balance.subInPlace(
        amount.div(BOND_AMOUNT_DIVISOR),
      );

      await treasuryOwner.createProposal(
        treasuryProposalPublicKey,
        {
          amount,
          recipient: treasuryProposalRecipientPublicKey,
          zkAppUri: dummyZkAppUri,
        },
        UInt32.from(0),
      );
    });

    tx.sign([testAccount.key, treasuryProposalPrivateKey, bondPayer.key]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();

    await printNonce(treasuryOwnerPublicKey, "treasury owner proposal created");
    await printNonce(treasuryProposalPublicKey, "treasury proposal created");
    const treasuryOwnerBalance = Local.getAccount(
      treasuryOwnerPublicKey,
    ).balance;
    Provable.log("treasuryOwnerBalance post creation", treasuryOwnerBalance);
  })();

  // const lifecycleStartedAt = await treasuryOwner.lifecycleStartedAt.fetch();
});

// TODO: move to a separate test suite, as the proving stalls if we add pausing alongside with the action state commit transaction
// they work fine separately, but together it stalls
// it("should pause the treasury", async () => {
//   const nonce = UInt32.from(1);
//   const signatures = new MultisigSignatures({
//     signatures: [
//       MultisigSignature.create(multisigSigners[0][0], [
//         MultisigSignature.dataPauseTreasury(nonce),
//       ]),
//       MultisigSignature.create(multisigSigners[1][0], [
//         MultisigSignature.dataPauseTreasury(nonce),
//       ]),
//       MultisigSignature.create(multisigSigners[2][0], [
//         MultisigSignature.dataPauseTreasury(nonce),
//       ]),
//       MultisigSignature.empty(),
//       MultisigSignature.empty(),
//     ],
//   });
//   const tx = await Mina.transaction(testAccount, async () => {
//     await pauseController.pauseTreasury(signatures, nonce);
//   });

//   tx.sign([testAccount.key]);
//   await tx.prove();
//   const pendingTx = await tx.send();
//   await pendingTx.wait();

//   Provable.log("paused", tx.toPretty());

//   const paused = await pauseController.paused.get();
//   assert(paused.toBoolean(), "Treasury is not paused");
// });

// it("should unpause the treasury", async () => {
//   const nonce = UInt32.from(2);
//   const signatures = new MultisigSignatures({
//     signatures: [
//       MultisigSignature.create(multisigSigners[0][0], [
//         MultisigSignature.dataUnpauseTreasury(nonce),
//       ]),
//       MultisigSignature.create(multisigSigners[1][0], [
//         MultisigSignature.dataUnpauseTreasury(nonce),
//       ]),
//       MultisigSignature.create(multisigSigners[2][0], [
//         MultisigSignature.dataUnpauseTreasury(nonce),
//       ]),
//       MultisigSignature.empty(),
//       MultisigSignature.empty(),
//     ],
//   });
//   const tx = await Mina.transaction(testAccount, async () => {
//     await pauseController.unpauseTreasury(signatures, nonce);
//   });

//   tx.sign([testAccount.key]);
//   await tx.prove();
//   const pendingTx = await tx.send();
//   await pendingTx.wait();

//   const paused = await pauseController.paused.get();
//   assert(!paused.toBoolean(), "Treasury is not unpaused");
// });

it("should vote on a proposal", async () => {
  // jump ahead to the voting period
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION.mul(2));

  const tx = await Mina.transaction(testAccount, async () => {
    // pay for creating the voter account
    AccountUpdate.fundNewAccount(testAccount, 1);
    await treasuryOwner.vote(
      treasuryProposalPublicKey,
      voterPublicKey1,
      Vote.YAY,
    );
  });

  tx.sign([testAccount.key, voterPrivateKey1]);

  Provable.log("vote tx", tx.toPretty());

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  await printNonce(treasuryOwnerPublicKey, "treasury owner voted");
  await printNonce(treasuryProposalPublicKey, "treasury proposal voted");
});

// TODO
// it.skip("should pause the proposal", async () => { });

// it("should vote on a proposal from a new account", async () => {
//   Local.incrementGlobalSlot(1);
//   const tx = await Mina.transaction(testAccount, async () => {
//     // pay for creating the voter account
//     AccountUpdate.fundNewAccount(testAccount, 1);
//     await treasuryOwner.vote(
//       treasuryProposalPublicKey,
//       voterPublicKey2,
//       Vote.NAY,
//     );
//   });

//   tx.sign([testAccount.key, voterPrivateKey2]);

//   await tx.prove();
//   const pendingTx = await tx.send();
//   await pendingTx.wait();
// });

it("should fail while attempting to vote on the proposal contract directly", async () => {
  let error: Error;
  try {
    const proposal = new TreasuryProposalSmartContract(
      treasuryProposalPublicKey,
      treasuryOwner.deriveTokenId(),
    );
    const tx = await Mina.transaction(testAccount, async () => {
      await proposal.vote({
        vote: Vote.YAY,
        publicKey: voterPublicKey1,
      });

      await treasuryOwner.approveAccountUpdate(proposal.self);
    });

    tx.sign([testAccount.key, voterPrivateKey1]);
    await tx.prove();
  } catch (e) {
    error = e as Error;
  }
  assert(
    error.message.includes(
      "No external account updates allowed for this token",
    ),
  );
});

let voteReducerProof: VoteReducerProof;
let stakingLedgerToVotingLedgerProof: StakingLedgerToVotingLedgerProof;
it("should commit action state", async () => {
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION);

  const actions = await Mina.getActions(
    treasuryProposalPublicKey,
    {},
    treasuryOwner.deriveTokenId(),
  );
  Provable.log("actions", actions);

  await fetchAccount({
    publicKey: treasuryProposalPublicKey,
    tokenId: treasuryOwner.deriveTokenId(),
  });
  const actionState = treasuryProposal.account.actionState.get();

  const actionData = actions[0].actions[0];
  const actionFields = actionData.map((action) => Field(action));

  let finalHash = appendActionToHashList(
    Reducer.initialActionState,
    actionFields,
  );

  const realVoteActions = actions
    .map((action) => action.actions[0])
    .map((action) => action.map((action) => Field(action)))
    .map((action) => VoteAction.fromFields(action));

  const voteActions = [
    ...voteReducerTestContext.createDummyVoteActions(
      VOTE_ACTION_BATCH_SIZE - realVoteActions.length,
    ),
    ...realVoteActions,
  ].slice(0, VOTE_ACTION_BATCH_SIZE);

  const actionStateHistory =
    voteReducerTestContext.buildActionStateHistory(voteActions);

  Provable.log("raw actions", actions);
  Provable.log("voteActions", voteActions);

  const treasuryOwnerAccount = await stakingLedger.getAccount(0n);
  const treasuryOwnerAccountWitness = await stakingLedger.getWitness(0n);

  const stakingLedgerRoot = await stakingLedger.getRoot();
  const votingLedgerRoot = await votingLedger.getRoot();
  const digestInput = new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(0),
    stakingLedgerRoot,
    votingLedgerRoot,
  });
  const digestAccounts: Account[] = [];
  for (let i = 0; i < ACCOUNT_BATCH_SIZE; i++) {
    digestAccounts.push(await stakingLedger.getAccount(BigInt(i)));
  }

  Provable.log("digest accounts", digestAccounts);

  console.time("digest ledger");
  const { proof: proof2 } = await StakingLedgerToVotingLedger.digest(
    digestInput,
    digestAccounts,
  );
  const { proof: exhaustProof } = await StakingLedgerToVotingLedger.exhaust(
    proof2.publicInput,
    proof2,
  );
  stakingLedgerToVotingLedgerProof = exhaustProof;
  console.timeEnd("digest ledger");
  Provable.log(
    "stakingLedgerToVotingLedgerProof",
    stakingLedgerToVotingLedgerProof.publicOutput,
  );
  Provable.log("pretally treasury balance", treasuryOwnerAccount.balance);

  Provable.log(
    "vote reducer reduce batch from",
    await nullifierLedger.getRoot(),
  );
  console.time("reduce batch");
  const { proof } = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: await votingLedger.getRoot(),
      fromNullifierRoot: await nullifierLedger.getRoot(),
      actionStateHistory,
    },
    voteActions,
  );
  voteReducerProof = proof;
  console.timeEnd("reduce batch");

  Provable.log("vote proof", voteReducerProof.publicOutput);

  Provable.log("preverify proofs", {
    voteReducer: await VoteReducer.verify(voteReducerProof),
    stakingLedgerToVotingLedger: await StakingLedgerToVotingLedger.verify(
      stakingLedgerToVotingLedgerProof,
    ),
  });

  console.time("commit action state");
  const commitTx = await Mina.transaction(testAccount, async () => {
    await treasuryOwner.commitActionState(
      SideLoadedVoteReducerProof.fromProof(voteReducerProof),
      treasuryProposalPublicKey,
    );
  });

  commitTx.sign([testAccount.key]);
  Provable.log("commit action state tx", commitTx.toPretty());
  await commitTx.prove();
  const commitPendingTx = await commitTx.send();
  await commitPendingTx.wait();
  console.timeEnd("commit action state");
});

it("should tally votes", async () => {
  const treasuryOwnerAccount = await stakingLedger.getAccount(0n);
  const treasuryOwnerAccountWitness = await stakingLedger.getWitness(0n);

  Provable.log("vote reducer proof tally", voteReducerProof.publicOutput);

  const tx = await Mina.transaction(testAccount, async () => {
    await treasuryOwner.tallyVotes(
      treasuryProposalPublicKey,
      SideLoadedVoteReducerProof.fromProof(voteReducerProof),
      // proof.proof,
      SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
        stakingLedgerToVotingLedgerProof,
      ),
      // stakingLedgerToVotingLedgerProof,
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
    );
  });

  tx.sign([testAccount.key]);
  Provable.log("tally votes tx", tx.toPretty());

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  await printNonce(treasuryOwnerPublicKey, "treasury owner tallied votes");
  await printNonce(treasuryProposalPublicKey, "treasury proposal tallied");

  const voteApproved = await treasuryProposal.status.fetch();
  assert(
    voteApproved.equals(ProposalStatus.APPROVED).toBoolean(),
    "Vote not approved",
  );
});

it("should execute a proposal", async () => {
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION.mul(2));
  const amountWithBond = amount.add(amount.div(BOND_AMOUNT_DIVISOR));

  const treasuryOwnerBalancePreExecution = Local.getAccount(
    treasuryOwnerPublicKey,
  ).balance;
  const testAccountBalancePreExecution = Local.getAccount(testAccount).balance;
  // const treasuryProposalRecipientBalancePreExecution = Local.getAccount(
  //   treasuryProposalRecipientPublicKey
  // ).balance;
  Provable.log(
    "testAccountBalancePreExecution",
    testAccountBalancePreExecution,
  );
  Provable.log(
    "treasuryOwnerBalancePreExecution",
    treasuryOwnerBalancePreExecution,
  );
  // Provable.log('treasuryProposalRecipientBalancePreExecution', treasuryProposalRecipientBalancePreExecution);
  Provable.log("executing proposal", {
    amountWithBond,
    recipient: treasuryProposalRecipientPublicKey,
  });
  const tx = await Mina.transaction(testAccount, async () => {
    // fund the recipient account creation
    AccountUpdate.fundNewAccount(testAccount, 1);

    await treasuryOwner.executeProposal(
      treasuryProposalPublicKey,
      treasuryProposalRecipientPublicKey,
      amountWithBond,
    );
  });

  tx.sign([testAccount.key, treasuryProposalRecipientPrivateKey]);

  Provable.log("executing proposal", tx.toPretty());

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  await printNonce(treasuryProposalPublicKey, "treasury proposal executed");
  await printNonce(treasuryOwnerPublicKey, "treasury owner executed proposal");

  const testAccountBalance = Local.getAccount(testAccount).balance;

  const treasuryOwnerBalance = Local.getAccount(treasuryOwnerPublicKey).balance;

  const treasuryProposalRecipientBalance = Local.getAccount(
    treasuryProposalRecipientPublicKey,
  ).balance;

  Provable.log("testAccountBalance", testAccountBalance);
  Provable.log("treasuryOwnerBalance", treasuryOwnerBalance);
  Provable.log(
    "treasuryProposalRecipientBalance",
    treasuryProposalRecipientBalance,
  );

  const expectedTreasuryOwnerBalance =
    treasuryOwnerBalancePreExecution.sub(amountWithBond);
  assert(
    treasuryOwnerBalance.toBigInt() === expectedTreasuryOwnerBalance.toBigInt(),
    "Treasury owner balance does not match expected post-execution balance",
  );
  assert(
    treasuryProposalRecipientBalance.toBigInt() === amountWithBond.toBigInt(),
    "Treasury proposal recipient balance is not the amount with bond",
  );
});
