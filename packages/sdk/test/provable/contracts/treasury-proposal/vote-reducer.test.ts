import { it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";

import {
  Account,
  Bool,
  Field,
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
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import { createTestAccounts } from "../../../../src/create-test-accounts.js";
import { createDummyVoteActions } from "../../../utils.js";
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

it.skip("should analyze", async () => {
  const analysis = await VoteReducer.analyzeMethods();
  Provable.log("analysis", analysis);
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

  const proof = await VoteReducer.reduceBatch(
    {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: await votingLedger.getRoot(),
      fromNullifierRoot: await nullifierLedger.getRoot(),
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

it("should merge vote reducer proofs", async () => {
  const publicInput = {
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot: await votingLedger.getRoot(),
    fromNullifierRoot: await nullifierLedger.getRoot(),
  };

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

  batch1Actions.forEach((action) => {
    Provable.log("action", action.publicKey.toBase58());
  });

  const proof1 = await VoteReducer.reduceBatch(publicInput, batch1Actions);

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
    {
      fromActionsHash: proof1.proof.publicOutput.toActionsHash,
      votingLedgerRoot: publicInput.votingLedgerRoot,
      fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
    },
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
