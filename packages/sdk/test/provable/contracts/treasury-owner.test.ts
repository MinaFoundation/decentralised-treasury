import { it } from "node:test";
import assert from "node:assert";
import {
  LIFECYCLE_PERIOD_DURATION,
  LifecyclePeriod,
  TreasuryOwnerSmartContract,
  VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY,
} from "../../../src/provable/contracts/treasury-owner.js";
import {
  AccountUpdate,
  fetchAccount,
  Field,
  MerkleTree,
  Mina,
  Poseidon,
  PrivateKey,
  Provable,
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
  VoteResult,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  VOTING_LEDGER_TREE_HEIGHT,
  VotingAccount,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { VotingAccountInMemoryService } from "../../../src/services/voting-account-service.js";
import { VoteNullifierInMemoryService } from "../../../src/services/vote-nullifier-service.js";
import {
  MerkleTree256InMemoryService,
  PrefilledMerkleTree256InMemoryService,
  MerkleWitness256,
} from "../../../src/services/merkle-tree-service.js";
import { createDummyVoteActions } from "../../../test/utils.js";

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

const Local = await Mina.LocalBlockchain({
  proofsEnabled,
});

Mina.setActiveInstance(Local);

const votingLedgerTree = new MerkleTree(VOTING_LEDGER_TREE_HEIGHT);
const voteNullifierTree = new MerkleTree(VOTING_LEDGER_TREE_HEIGHT);

const votingAccountTreeService = new PrefilledMerkleTree256InMemoryService();
const votingAccountService = new VotingAccountInMemoryService();
const voteNullifierService = new VoteNullifierInMemoryService();
const voteNullifierTreeService = new MerkleTree256InMemoryService();

voteReducerContext.set({
  votingAccountTree: votingAccountTreeService,
  votingAccounts: votingAccountService,
  voteNullifiers: voteNullifierService,
  voteNullifierTree: voteNullifierTreeService,
});

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

const amount = UInt64.from(100);

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

votingAccountService.setVotingAccount(
  voterPublicKey1.toBase58(),
  votingAccount1
);

votingAccountService.setVotingAccount(
  voterPublicKey2.toBase58(),
  votingAccount2
);

votingLedgerTree.setLeaf(
  Poseidon.hash(voterPublicKey1.toFields()).toBigInt(),
  Poseidon.hash(VotingAccount.toFields(votingAccount1))
);

votingLedgerTree.setLeaf(
  Poseidon.hash(voterPublicKey2.toFields()).toBigInt(),
  Poseidon.hash(VotingAccount.toFields(votingAccount2))
);

votingAccountTreeService.setWitness(
  Poseidon.hash(voterPublicKey1.toFields()).toBigInt(),
  new MerkleWitness256(
    votingLedgerTree.getWitness(
      Poseidon.hash(voterPublicKey1.toFields()).toBigInt()
    )
  )
);

votingAccountTreeService.setWitness(
  Poseidon.hash(voterPublicKey2.toFields()).toBigInt(),
  new MerkleWitness256(
    votingLedgerTree.getWitness(
      Poseidon.hash(voterPublicKey2.toFields()).toBigInt()
    )
  )
);

it("should create a proposal", async () => {
  await (async () => {
    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);
      await treasuryOwner.deploy();
    });

    tx.sign([testAccount.key, treasuryOwnerPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();
  })();

  await (async () => {
    const tx = await Mina.transaction(testAccount, async () => {
      await treasuryOwner.initialize(UInt32.from(0));
    });

    tx.sign([testAccount.key, treasuryOwnerPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();
  })();

  await (async () => {
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

    const tx = await Mina.transaction(testAccount, async () => {
      AccountUpdate.fundNewAccount(testAccount, 1);
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

    tx.sign([testAccount.key, treasuryProposalPrivateKey]);
    await tx.prove();

    const pendingTx = await tx.send();
    await pendingTx.wait();
  })();

  // const lifecycleStartedAt = await treasuryOwner.lifecycleStartedAt.fetch();
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
});

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
    LIFECYCLE_PERIOD_DURATION.add(VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY)
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

  const proof = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: votingLedgerTree.getRoot(),
      fromNullifierRoot: voteNullifierTree.getRoot(),
      yay: UInt64.from(0),
      nay: UInt64.from(0),
      abstain: UInt64.from(0),
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

  const voteApproved = await treasuryProposal.approved.fetch();
  assert(
    voteApproved.equals(VoteResult.APPROVED).toBoolean(),
    "Vote not approved"
  );
});

it("should execute a proposal", async () => {
  Local.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION);

  await (async () => {
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

  const tx = await Mina.transaction(testAccount, async () => {
    // fund the recipient account creation
    AccountUpdate.fundNewAccount(testAccount, 1);

    await treasuryOwner.executeProposal(treasuryProposalPublicKey);
  });

  tx.sign([testAccount.key, treasuryProposalRecipientPrivateKey]);

  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

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
});
