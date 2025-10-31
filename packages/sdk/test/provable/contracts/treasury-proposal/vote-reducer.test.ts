import { it, before } from "node:test";
import assert from "node:assert";

import {
  Account,
  Field,
  MerkleTree,
  Poseidon,
  Provable,
  PublicKey,
  Reducer,
  UInt32,
  UInt64,
} from "o1js";
import {
  VoteAction,
  Vote,
  VoteReducer,
  VOTE_ACTION_BATCH_SIZE,
  voteReducerContext,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import {
  VOTING_LEDGER_TREE_HEIGHT,
  VotingAccount,
} from "../../../../src/provable/staking-ledger-to-voting-ledger.js";
import { createTestAccounts } from "../../../../src/create-test-accounts.js";
import {
  MerkleTree256InMemoryService,
  MerkleWitness256,
  PrefilledMerkleTree256InMemoryService,
} from "../../../../src/services/merkle-tree-service.js";
import { VotingAccountInMemoryService } from "../../../../src/services/voting-account-service.js";
import { VoteNullifierInMemoryService } from "../../../../src/services/vote-nullifier-service.js";
import { createDummyVoteActions } from "../../../utils.js";

export const proofsEnabled = process.env.PROOFS_ENABLED === "true";

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

let votingLedgerTree: MerkleTree;
let testAccounts: Account[];
let voteNullifierTree: MerkleTree;

before(async () => {
  testAccounts = await createTestAccounts(10);
  votingLedgerTree = new MerkleTree(VOTING_LEDGER_TREE_HEIGHT);
  voteNullifierTree = new MerkleTree(VOTING_LEDGER_TREE_HEIGHT);

  // fill the voting ledger tree with VotingAccounts
  testAccounts.forEach((account, index) => {
    const votingAccount = new VotingAccount({ balance: account.balance });
    votingLedgerTree.setLeaf(
      Poseidon.hash(account.publicKey.toFields()).toBigInt(),
      Poseidon.hash(VotingAccount.toFields(votingAccount))
    );

    votingAccountService.setVotingAccount(
      account.publicKey.toBase58(),
      votingAccount
    );
  });

  // fill the witness provider with the voting ledger witnesses
  testAccounts.forEach((account, index) => {
    votingAccountTreeService.setWitness(
      Poseidon.hash(account.publicKey.toFields()).toBigInt(),
      new MerkleWitness256(
        votingLedgerTree.getWitness(
          Poseidon.hash(account.publicKey.toFields()).toBigInt()
        )
      )
    );
  });
});

it("should compile", async () => {
  console.log("compiling");
  console.time("compile");
  await VoteReducer.compile({
    proofsEnabled,
  });
  console.timeEnd("compile");
});

it("should analyze", async () => {
  const analysis = await VoteReducer.analyzeMethods();
  Provable.log("analysis", analysis);
});

it("should tally votes actions batch", async () => {
  const actions = [
    new VoteAction({
      vote: Vote.YAY,
      publicKey: testAccounts[0].publicKey,
    }),
    new VoteAction({
      vote: Vote.NAY,
      publicKey: testAccounts[1].publicKey,
    }),
    new VoteAction({
      vote: Vote.ABSTRAIN,
      publicKey: testAccounts[2].publicKey,
    }),
    new VoteAction({
      vote: Vote.YAY,
      publicKey: testAccounts[3].publicKey,
    }),
    new VoteAction({
      vote: Vote.NAY,
      publicKey: testAccounts[4].publicKey,
    }),
    ...createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
  ].slice(0, VOTE_ACTION_BATCH_SIZE);

  const proof = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      yay: UInt64.from(0),
      nay: UInt64.from(0),
      abstain: UInt64.from(0),
      votingLedgerRoot: votingLedgerTree.getRoot(),
      fromNullifierRoot: voteNullifierTree.getRoot(),
    },
    actions
  );

  Provable.log({
    publicOutput: proof.proof.publicOutput,
    publicInput: proof.proof.publicInput,
  });

  assert(
    proof.proof.publicOutput.yay.toBigInt() ===
      testAccounts[0].balance.toBigInt() + testAccounts[3].balance.toBigInt()
  );
  assert(
    proof.proof.publicOutput.nay.toBigInt() ===
      testAccounts[1].balance.toBigInt() + testAccounts[4].balance.toBigInt()
  );
  assert(
    proof.proof.publicOutput.abstain.toBigInt() ===
      testAccounts[2].balance.toBigInt()
  );
});
