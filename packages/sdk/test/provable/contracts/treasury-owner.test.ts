import { it, after } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import {
  BOND_AMOUNT_DIVISOR,
  LIFECYCLE_PERIOD_DURATION,
  LifecyclePeriod,
  MultisigSignature,
  MultisigSignatures,
  TreasuryOwnerSmartContract,
} from "../../../src/provable/contracts/treasury-owner.js";
import {
  AccountUpdate,
  fetchAccount,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  Reducer,
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
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";

import { appendActionToHashList } from "../../../src/provable/hashing-helpers.js";
import {
  TreasuryProposalSmartContract,
  ProposalStatus,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { createDummyVoteActions } from "../../../test/utils.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { RedisNullifierLedger } from "../../../src/ledgers/nullifier-ledger/redis-nullifier-ledger.js";

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

const Local = await Mina.LocalBlockchain({
  proofsEnabled,
});

Mina.setActiveInstance(Local);

const redisServer = new RedisMemoryServer();
const redisHost = await redisServer.getHost();
const redisPort = await redisServer.getPort();
const redisUrl = `redis://${redisHost}:${redisPort}`;
const lifecycleId = "treasury-owner-test";

const votingLedger = new RedisVotingLedger(redisUrl, lifecycleId);
const nullifierLedger = new RedisNullifierLedger(redisUrl, lifecycleId);

voteReducerContext.set({
  votingLedger,
  nullifierLedger,
});

after(async () => {
  await votingLedger.close();
  await nullifierLedger.close();
  await redisServer.stop();
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
]

const multiSigCommitment = Poseidon.hash([
  ...[multisigPublicKey1, multisigPublicKey2, multisigPublicKey3, multisigPublicKey4, multisigPublicKey5].flatMap(
    (participant) => participant.toFields()
  ),
]);

const { verificationKey: voteReducerVerificationKey } =
  await VoteReducer.compile({
    proofsEnabled,
  });

const { verificationKey: stakingLedgerToVotingLedgerVerificationKey } =
  await StakingLedgerToVotingLedger.compile({
    proofsEnabled,
  });

TreasuryProposalSmartContract.voteReducerVerificationKey =
  voteReducerVerificationKey;
TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
  stakingLedgerToVotingLedgerVerificationKey;

await TreasuryProposalSmartContract.compile();
TreasuryOwnerSmartContract.proposalContractVerificationKey =
  TreasuryProposalSmartContract._verificationKey;
TreasuryOwnerSmartContract.multisigParticipants = [
  multisigPublicKey1,
  multisigPublicKey2,
  multisigPublicKey3,
  multisigPublicKey4,
  multisigPublicKey5,
];

await TreasuryOwnerSmartContract.compile();

const testAccount = Local.testAccounts[1];
const voterPrivateKey1 = PrivateKey.random();
const voterPublicKey1 = voterPrivateKey1.toPublicKey();
const voterPrivateKey2 = PrivateKey.random();
const voterPublicKey2 = voterPrivateKey2.toPublicKey();

const treasuryOwnerPrivateKey = PrivateKey.random();
const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();

const treasuryProposalPrivateKey = PrivateKey.random();
const treasuryProposalPublicKey = treasuryProposalPrivateKey.toPublicKey();

const amount = UInt64.from(100000000000);

const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
const treasuryProposal = new TreasuryProposalSmartContract(
  treasuryProposalPublicKey,
  treasuryOwner.deriveTokenId()
);

const treasuryProposalRecipientPrivateKey = PrivateKey.random();
const treasuryProposalRecipientPublicKey =
  treasuryProposalRecipientPrivateKey.toPublicKey();

const dummyZkAppUri = "https://example.com";

const votingAccount1 = new VotingAccount({ balance: UInt64.from(300) });
const votingAccount2 = new VotingAccount({ balance: UInt64.from(100) });

await votingLedger.setVotingAccount(voterPublicKey1.toBase58(), votingAccount1);

await votingLedger.setVotingAccount(voterPublicKey2.toBase58(), votingAccount2);

await votingLedger.setLeaf(voterPublicKey1.toBase58(), votingAccount1);
await votingLedger.setLeaf(voterPublicKey2.toBase58(), votingAccount2);

async function printNonce(publicKey: PublicKey, memo: string) {
  try {
    const account = Local.getAccount(publicKey);
    console.log(`Nonce for (${memo}) ${publicKey.toBase58()}: ${account.nonce.toBigint()}`);
  } catch (error) {
    console.error(`Error fetching nonce for (${memo}) ${publicKey.toBase58()}: ${error}`);
  }
}

it("should create a proposal", async () => {

  await (async () => {
    console.log("deploying treasury owner");
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
    console.log("initializing treasury owner");
    const tx = await Mina.transaction(testAccount, async () => {
      await treasuryOwner.initialize(UInt32.from(0), multiSigCommitment);
    });

    tx.sign([testAccount.key, treasuryOwnerPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();

    await printNonce(treasuryOwnerPublicKey, "treasury owner initialized");
    const treasuryOwnerBalance = Local.getAccount(treasuryOwnerPublicKey).balance;
    Provable.log('treasuryOwnerBalance post initialization', treasuryOwnerBalance);
  })();

  await (async () => {
    console.log("setting network state");
    Local.setNetworkState({
      ...Local.getNetworkState(),
      stakingEpochData: {
        ...Local.getNetworkState().stakingEpochData,
        ledger: {
          ...Local.getNetworkState().stakingEpochData.ledger,
          hash: Field(1),
          // TODO: manage the total currency across the test suite in a better way
          totalCurrency: UInt64.from(300),
        },
      },
    });

    const bondPayer = Local.testAccounts[0];

    console.log("creating proposal")
    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);

      const bondPayerAccountUpdate = AccountUpdate.createSigned(bondPayer);
      bondPayerAccountUpdate.balance.subInPlace(amount.div(BOND_AMOUNT_DIVISOR));

      await treasuryOwner.createProposal(
        treasuryProposalPublicKey,
        {
          amount,
          recipient: treasuryProposalRecipientPublicKey,
          zkAppUri: dummyZkAppUri,
        },
        UInt32.from(0)
      );
    });

    tx.sign([testAccount.key, treasuryProposalPrivateKey, bondPayer.key]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();

    await printNonce(treasuryOwnerPublicKey, "treasury owner proposal created");
    await printNonce(treasuryProposalPublicKey, "treasury proposal created");
    const treasuryOwnerBalance = Local.getAccount(treasuryOwnerPublicKey).balance;
    Provable.log('treasuryOwnerBalance post creation', treasuryOwnerBalance);
  })();

  // const lifecycleStartedAt = await treasuryOwner.lifecycleStartedAt.fetch();
});

it("should pause the treasury", async () => {
  const validUntilSlot = Local.currentSlot().add(5);
  const signatures = new MultisigSignatures({
    signatures: [
      MultisigSignature.create(multisigSigners[0][0], MultisigSignature.dataPauseTreasury(validUntilSlot)),
      MultisigSignature.create(multisigSigners[1][0], MultisigSignature.dataPauseTreasury(validUntilSlot)),
      MultisigSignature.create(multisigSigners[2][0], MultisigSignature.dataPauseTreasury(validUntilSlot)),
      MultisigSignature.empty(),
      MultisigSignature.empty(),
    ]
  })
  const tx = await Mina.transaction(testAccount, async () => {
    await treasuryOwner.pauseTreasury(
      signatures,
      validUntilSlot
    );
  });

  tx.sign([testAccount.key]);
  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  Provable.log("paused", tx.toPretty());

  const paused = await treasuryOwner.paused.get();
  assert(paused.toBoolean(), "Treasury is not paused");
});

it("should unpause the treasury", async () => {
  const validUntilSlot = Local.currentSlot().add(5);
  const signatures = new MultisigSignatures({
    signatures: [
      MultisigSignature.create(multisigSigners[0][0], MultisigSignature.dataUnpauseTreasury(validUntilSlot)),
      MultisigSignature.create(multisigSigners[1][0], MultisigSignature.dataUnpauseTreasury(validUntilSlot)),
      MultisigSignature.create(multisigSigners[2][0], MultisigSignature.dataUnpauseTreasury(validUntilSlot)),
      MultisigSignature.empty(),
      MultisigSignature.empty(),
    ]
  })
  const tx = await Mina.transaction(testAccount, async () => {
    await treasuryOwner.unpauseTreasury(
      signatures,
      validUntilSlot
    );
  });

  tx.sign([testAccount.key]);
  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();


  const paused = await treasuryOwner.paused.get();
  assert(!paused.toBoolean(), "Treasury is not unpaused");
});


it("should vote on a proposal", async () => {
  // jump ahead to the voting period
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION.mul(2));

  const tx = await Mina.transaction(testAccount, async () => {
    // pay for creating the voter account
    AccountUpdate.fundNewAccount(testAccount, 1);
    await treasuryOwner.vote(
      treasuryProposalPublicKey,
      voterPublicKey1,
      Vote.YAY
    );
  });

  tx.sign([testAccount.key, voterPrivateKey1]);

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  await printNonce(treasuryOwnerPublicKey, "treasury owner voted");
  await printNonce(treasuryProposalPublicKey, "treasury proposal voted");

});

// TODO
it.todo("should pause the proposal", async () => { });

it("should vote on a proposal from a new account", async () => {
  const tx = await Mina.transaction(testAccount, async () => {
    // pay for creating the voter account
    AccountUpdate.fundNewAccount(testAccount, 1);
    await treasuryOwner.vote(
      treasuryProposalPublicKey,
      voterPublicKey2,
      Vote.NAY
    );
  });

  tx.sign([testAccount.key, voterPrivateKey2]);

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();
});

it("should fail while attempting to vote on the proposal contract directly", async () => {
  let error: Error;
  try {
    const proposal = new TreasuryProposalSmartContract(
      treasuryProposalPublicKey,
      treasuryOwner.deriveTokenId()
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
    error.message.includes("No external account updates allowed for this token")
  );
});

it("should tally votes", async () => {
  Local.incrementGlobalSlot(
    LIFECYCLE_PERIOD_DURATION
  );

  const actions = await Mina.getActions(
    treasuryProposalPublicKey,
    {},
    treasuryOwner.deriveTokenId()
  );

  await fetchAccount({
    publicKey: treasuryProposalPublicKey,
    tokenId: treasuryOwner.deriveTokenId(),
  });
  const actionState = treasuryProposal.account.actionState.get();

  const actionData = actions[0].actions[0];
  const actionFields = actionData.map((action) => Field(action));

  let finalHash = appendActionToHashList(
    Reducer.initialActionState,
    actionFields
  );

  const voteActions = [
    ...actions
      .map((action) => action.actions[0])
      .map((action) => action.map((action) => Field(action)))
      .map((action) => VoteAction.fromFields(action)),
    ...createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
  ].slice(0, VOTE_ACTION_BATCH_SIZE);

  Provable.log("raw actions", actions);
  Provable.log("voteActions", voteActions);

  const proof = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: await votingLedger.getRoot(),
      fromNullifierRoot: await nullifierLedger.getRoot(),
    },
    voteActions
  );

  // TODO: replace with a real proof in order to be able to run proofsEnabled: true
  const stakingLedgerToVotingLedgerProof =
    await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
      StakingLedgerToVotingLedgerProgramInput.empty(),
      StakingLedgerToVotingLedgerProgramOutput.empty(),
      0
    );

  const tx = await Mina.transaction(testAccount, async () => {
    await treasuryOwner.tallyVotes(
      treasuryProposalPublicKey,
      SideLoadedVoteReducerProof.fromProof(proof.proof),
      stakingLedgerToVotingLedgerProof
    );
  });

  tx.sign([testAccount.key]);

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  await printNonce(treasuryOwnerPublicKey, "treasury owner tallied votes");
  await printNonce(treasuryProposalPublicKey, "treasury proposal tallied");


  const voteApproved = await treasuryProposal.status.fetch();
  assert(
    voteApproved.equals(ProposalStatus.APPROVED).toBoolean(),
    "Vote not approved"
  );
});

it("should execute a proposal", async () => {
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION);
  const amountWithBond = amount.add(amount.div(BOND_AMOUNT_DIVISOR));

  const treasuryOwnerBalancePreExecution = Local.getAccount(treasuryOwnerPublicKey).balance;
  const testAccountBalancePreExecution = Local.getAccount(testAccount).balance;
  // const treasuryProposalRecipientBalancePreExecution = Local.getAccount(
  //   treasuryProposalRecipientPublicKey
  // ).balance;
  Provable.log('testAccountBalancePreExecution', testAccountBalancePreExecution);
  Provable.log('treasuryOwnerBalancePreExecution', treasuryOwnerBalancePreExecution);
  // Provable.log('treasuryProposalRecipientBalancePreExecution', treasuryProposalRecipientBalancePreExecution);
  await (async () => {
    console.log('funding treasury owner');
    const tx = await Mina.transaction(testAccount, async () => {
      const testAccountUpdate = AccountUpdate.createSigned(testAccount);
      // fund the treasury owner account
      testAccountUpdate.balance.subInPlace(amount);

      const treasuryOwnerAccountUpdate = AccountUpdate.createSigned(
        treasuryOwnerPublicKey
      );
      treasuryOwnerAccountUpdate.balance.addInPlace(amount);
    });

    tx.sign([testAccount.key, treasuryOwnerPrivateKey]);
    await tx.prove();
    const pendingTx = await tx.send();
    await pendingTx.wait();
  })();

  Provable.log('executing proposal', {
    amountWithBond,
    recipient: treasuryProposalRecipientPublicKey,
  });
  const tx = await Mina.transaction(testAccount, async () => {
    // fund the recipient account creation
    AccountUpdate.fundNewAccount(testAccount, 1);

    await treasuryOwner.executeProposal(treasuryProposalPublicKey, amountWithBond);
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
    treasuryProposalRecipientPublicKey
  ).balance;

  Provable.log("testAccountBalance", testAccountBalance);
  Provable.log("treasuryOwnerBalance", treasuryOwnerBalance);
  Provable.log(
    "treasuryProposalRecipientBalance",
    treasuryProposalRecipientBalance
  );

  assert(treasuryOwnerBalance.toBigInt() === 0n, "Treasury owner balance is not 0");
  assert(treasuryProposalRecipientBalance.toBigInt() === amountWithBond.toBigInt(), "Treasury proposal recipient balance is not the amount with bond");
});
