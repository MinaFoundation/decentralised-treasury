import { it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";

import {
  Account,
  Bool,
  Provable,
  PublicKey,
  Reducer,
  UInt64,
} from "o1js";
import {
  VoteAction,
  Vote,
  VoteReducer,
  VOTE_ACTION_BATCH_SIZE,
  voteReducerContext,
  VoteReducerPublicInput,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import { createTestAccounts } from "../../../../src/create-test-accounts.js";
import { buildActionStateHistory, createDummyVoteActions } from "../../../utils.js";
import { appendActionToHashList } from "../../../../src/provable/hashing-helpers.js";
import { RedisVotingLedger } from "../../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { RedisNullifierLedger } from "../../../../src/ledgers/nullifier-ledger/redis-nullifier-ledger.js";

export const proofsEnabled = process.env.PROOFS_ENABLED === "true";

let redisServer: RedisMemoryServer;
let votingLedger: RedisVotingLedger;
let nullifierLedger: RedisNullifierLedger;

let testAccounts: Account[];

const emptyPublicKey = PublicKey.empty().toBase58();
Provable.log("emptyPublicKey", emptyPublicKey);

beforeEach(async () => {
  redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const lifecycleId = "vote-reducer-test";

  votingLedger = new RedisVotingLedger(redisUrl, lifecycleId);
  nullifierLedger = new RedisNullifierLedger(redisUrl, lifecycleId);
  voteReducerContext.set({ votingLedger, nullifierLedger });

  testAccounts = await createTestAccounts(10);

  // fill the voting ledger tree with VotingAccounts
  for (const account of testAccounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.publicKey.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
    await nullifierLedger.setLeaf(publicKey, Bool(false));
  }
});

afterEach(async () => {
  await votingLedger.close();
  await nullifierLedger.close();
  await redisServer.stop();
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

it("should build action history with dummies padding", async () => {
  const action1 = new VoteAction({
    vote: Vote.YAY,
    publicKey: testAccounts[0].publicKey,
  });
  const action2 = new VoteAction({
    vote: Vote.NAY,
    publicKey: testAccounts[1].publicKey,
  });

  const paddedActions = [
    ...createDummyVoteActions(3),
    action1,
    action2,
  ];

  const actionStateHistory = buildActionStateHistory(paddedActions);

  const expectedHash1 = appendActionToHashList(
    Reducer.initialActionState,
    VoteAction.toFields(action1)
  );
  const expectedHash2 = appendActionToHashList(
    expectedHash1,
    VoteAction.toFields(action2)
  );

  const expectedSnapshots = [
    expectedHash2,
    expectedHash1,
    Reducer.initialActionState,
    Reducer.initialActionState,
    Reducer.initialActionState,
  ];

  const actualSnapshots = [
    actionStateHistory.actionStateOne.hash,
    actionStateHistory.actionStateTwo.hash,
    actionStateHistory.actionStateThree.hash,
    actionStateHistory.actionStateFour.hash,
    actionStateHistory.actionStateFive.hash,
  ];

  expectedSnapshots.forEach((expected, index) => {
    assert(
      actualSnapshots[index].equals(expected).toBoolean(),
      `action state snapshot ${index + 1} should match expected action list hash`
    );
  });
});

it.skip("should tally votes actions batch", async () => {
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
  ].slice(0, VOTE_ACTION_BATCH_SIZE);

  const actionStateHistory = buildActionStateHistory(actions);

  const proof = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: await votingLedger.getRoot(),
      fromNullifierRoot: await nullifierLedger.getRoot(),
      actionStateHistory,
    },
    actions
  );

  Provable.log({
    publicOutput: proof.proof.publicOutput,
    publicInput: proof.proof.publicInput,
  });

  Provable.log('actions', actions);


  assert.equal(
    proof.proof.publicOutput.yay.toBigInt(),
    testAccounts[0].balance.toBigInt() + testAccounts[3].balance.toBigInt(),
    "expected yay total to equal the sum of accounts 0 and 3"
  );
  assert.equal(
    proof.proof.publicOutput.nay.toBigInt(),
    testAccounts[1].balance.toBigInt() + testAccounts[4].balance.toBigInt(),
    "expected nay total to equal the sum of accounts 1 and 4"
  );
  assert.equal(
    proof.proof.publicOutput.abstain.toBigInt(),
    testAccounts[2].balance.toBigInt(),
    "expected abstain total to equal account 2"
  );
});

it.skip("should merge vote reducer proofs", async () => {
  const actionStateHistory = buildActionStateHistory([
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
  ]);

  const publicInput = new VoteReducerPublicInput({
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot: await votingLedger.getRoot(),
    fromNullifierRoot: await nullifierLedger.getRoot(),
    actionStateHistory,
  });

  const batch1Actions = [
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
    ...createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
  ].slice(0, VOTE_ACTION_BATCH_SIZE);

  const proof1 = await VoteReducer.reduceBatch(VoteReducerPublicInput.clone(publicInput), batch1Actions);

  const batch2Actions = [
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

  const proof2 = await VoteReducer.reduceBatch(
    new VoteReducerPublicInput({
      fromActionsHash: proof1.proof.publicOutput.toActionsHash,
      votingLedgerRoot: publicInput.votingLedgerRoot,
      fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
      actionStateHistory,
    }),
    batch2Actions
  );

  const proof3 = await VoteReducer.merge(
    publicInput,
    proof1.proof,
    proof2.proof
  );

  assert(
    proof3.proof.publicOutput.yay.toBigInt() ===
    testAccounts[0].balance.toBigInt() + testAccounts[3].balance.toBigInt()
  );
  assert(
    proof3.proof.publicOutput.nay.toBigInt() ===
    testAccounts[1].balance.toBigInt() + testAccounts[4].balance.toBigInt()
  );
  assert(
    proof3.proof.publicOutput.abstain.toBigInt() ===
    testAccounts[2].balance.toBigInt()
  );
  assert(
    proof3.proof.publicOutput.toActionsHash.toString() ===
    proof2.proof.publicOutput.toActionsHash.toString()
  );
  assert(
    proof3.proof.publicOutput.toNullifierRoot.toString() ===
    proof2.proof.publicOutput.toNullifierRoot.toString()
  );
});

