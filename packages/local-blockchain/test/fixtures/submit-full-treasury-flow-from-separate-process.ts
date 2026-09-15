import assert from "node:assert/strict";
import {
  assertServerProofMode,
  proofCache,
  proofsEnabled,
} from "../proof-mode.js";
import { KeyvSqlite } from "../../../sdk/node_modules/@keyv/sqlite/dist/index.js";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Reducer,
  TokenId,
  UInt32,
  UInt64,
  VerificationKey,
  ZkappUri,
} from "../../src/o1js.js";
import { Account } from "../../../sdk/src/provable/account.js";
import {
  ACCOUNT_BATCH_SIZE,
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
} from "../../../sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { BOND_AMOUNT_DIVISOR } from "../../../sdk/src/provable/contracts/treasury-constants.js";
import { TreasuryOwnerSmartContract } from "../../../sdk/src/provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../../sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  ActionStateHistoryTarget,
  SideLoadedVoteReducerProof,
  Vote,
  VoteAction,
  voteReducerContext,
  VoteReducer,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { TreasuryProposalSmartContract } from "../../../sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { InMemoryNullifierLedger } from "../../../sdk/src/ledgers/nullifier-ledger/in-memory-nullifier-ledger.js";
import { PersistentStakingLedger } from "../../../sdk/src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { InMemoryVotingLedger } from "../../../sdk/src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { RecordingStakingLedger } from "../../../sdk/src/ledgers/staking-ledger/recording-staking-ledger.js";
import { ReplayableStakingLedger } from "../../../sdk/src/ledgers/staking-ledger/replayable-staking-ledger.js";
import { RecordingVotingLedger } from "../../../sdk/src/ledgers/voting-ledger/recording-voting-ledger.js";
import { ReplayableVotingLedger } from "../../../sdk/src/ledgers/voting-ledger/replayable-voting-ledger.js";
import { RecordingNullifierLedger } from "../../../sdk/src/ledgers/nullifier-ledger/recording-nullifier-ledger.js";
import { SqliteVoteReducerService } from "../../../sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import { createSqliteNullifierLedgerStorage } from "../../../sdk/src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteStakingLedgerStorage } from "../../../sdk/src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createInMemoryVotingLedgerStorage } from "../../../sdk/src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { createInMemoryNullifierLedgerStorage } from "../../../sdk/src/storage/in-memory/factory/in-memory-nullifier-ledger-storage.js";
import { VoteReducerRunBatchTrace } from "../../../sdk/src/proving/tracing/vote-reducer-tracer.js";
import { proveVoteReducerInWorker } from "./vote-reducer-worker.js";

async function runPhase<T>(
  name: string,
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  console.log(`[e2e-phase] start ${name}`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Fixture phase ${name} exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
    console.log(`[e2e-phase] complete ${name}`);
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface AdminStateResponse {
  ok: boolean;
  currentSlot: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

function createInMemorySqliteStore(): KeyvSqlite {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const disconnect = store.disconnect.bind(store);
  store.disconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_MISUSE"
      ) {
        return;
      }
      throw error;
    }
  };
  return store;
}

function buildSendZkappMutation(transactionJson: string): string {
  return `mutation {
  sendZkapp(input: {
    zkappCommand: ${JSON.stringify(
      JSON.parse(transactionJson),
      null,
      2,
    ).replace(/\"(\S+)\"\s*:/gm, "$1:")}
  }) {
    zkapp {
      hash
      id
      failureReason {
        failures
        index
      }
    }
  }
}`;
}

async function main() {
  const minaBaseUrl = process.argv[2];
  const archiveUrl = process.argv[3];
  if (!minaBaseUrl || !archiveUrl) {
    throw new Error("Expected mina base URL and archive URL arguments");
  }

  async function readAdminState(): Promise<AdminStateResponse> {
    const response = await fetch(`${minaBaseUrl}/admin/state`, {
      headers: { connection: "close" },
    });
    assert.equal(response.status, 200);
    return (await response.json()) as AdminStateResponse;
  }

  async function incrementServerSlot(by: number): Promise<void> {
    const response = await fetch(`${minaBaseUrl}/admin/slot/increment`, {
      method: "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
      },
      body: JSON.stringify({ by }),
    });
    assert.equal(response.status, 200);
  }

  async function updateServerNetworkState(payload: {
    stakingEpochDataLedgerHash: string;
    stakingEpochDataLedgerTotalCurrency: string;
  }): Promise<void> {
    const response = await fetch(`${minaBaseUrl}/admin/network-state`, {
      method: "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
  }

  async function submitToServer(transactionJson: string) {
    const response = await fetch(`${minaBaseUrl}/graphql`, {
      method: "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: buildSendZkappMutation(transactionJson),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data?.sendZkapp?.zkapp?.failureReason ?? null, null);
    return payload.data.sendZkapp.zkapp as {
      hash: string;
      id: string;
      failureReason: null;
    };
  }

  async function submitAndMirror(
    local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>,
    transaction: Awaited<ReturnType<typeof Mina.transaction>>,
  ) {
    await transaction.send().then((pendingTx) => pendingTx.wait?.());
    const result = await submitToServer(transaction.toJSON());
    local.incrementGlobalSlot(1);
    return result;
  }

  async function mirrorManualSlotAdvance(
    local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>,
    by: UInt32,
  ) {
    local.incrementGlobalSlot(by);
    await incrementServerSlot(Number(by.toString()));
  }

  const lifecyclePeriodDuration = UInt32.from(20);
  TreasuryOwnerSmartContract.lifecyclePeriodDuration = lifecyclePeriodDuration;
  const initialState = await readAdminState();
  const stakingSnapshotAccounts = initialState.testAccounts.slice(0, 4);
  const bondPayer = stakingSnapshotAccounts[0];
  const sender = stakingSnapshotAccounts[1];
  const voter1 = stakingSnapshotAccounts[2];
  const voter2 = stakingSnapshotAccounts[3];
  assert.equal(
    stakingSnapshotAccounts.length,
    4,
    "expected at least four test accounts",
  );
  assert(bondPayer, "missing bond payer account");
  assert(sender, "missing sender account");
  assert(voter1, "missing voter1 account");
  assert(voter2, "missing voter2 account");

  await assertServerProofMode(minaBaseUrl);
  const local = await Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(local);
  for (const account of [bondPayer, sender, voter1, voter2]) {
    local.addAccount(PublicKey.fromBase58(account.publicKey), account.balance);
  }

  const sqlite = createInMemorySqliteStore();
  const lifecycleId = `local-blockchain-full-flow-${Date.now()}`;
  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(lifecycleId, sqlite),
  );
  const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
    createSqliteNullifierLedgerStorage(lifecycleId, sqlite),
  );
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqlite,
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedger = new InMemoryNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );

  voteReducerContext.set({ votingLedger, nullifierLedger });
  stakingLedgerToVotingLedgerContext.set({ stakingLedger, votingLedger });

  const bondPayerPrivateKey = PrivateKey.fromBase58(bondPayer.privateKey);
  const bondPayerPublicKey = bondPayerPrivateKey.toPublicKey();
  const senderPrivateKey = PrivateKey.fromBase58(sender.privateKey);
  const senderPublicKey = senderPrivateKey.toPublicKey();
  const voterPrivateKey1 = PrivateKey.fromBase58(voter1.privateKey);
  const voterPublicKey1 = voterPrivateKey1.toPublicKey();
  const voterPrivateKey2 = PrivateKey.fromBase58(voter2.privateKey);
  const voterPublicKey2 = voterPrivateKey2.toPublicKey();
  const multisigParticipants = Array.from({ length: 5 }, () =>
    PrivateKey.random().toPublicKey(),
  );

  TreasuryPauseControllerSmartContract.multisigParticipants =
    multisigParticipants;
  TreasuryProposalSmartContract.voteReducerVerificationKey =
    VerificationKey.dummySync();
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    VerificationKey.dummySync();
  const emptyNullifierRoot = await nullifierLedger.getRoot();
  TreasuryProposalSmartContract.emptyNullifierRoot = emptyNullifierRoot;
  TreasuryProposalSmartContract.emptyVotingLedgerRoot =
    await votingLedger.getRoot();

  const cache = proofCache;
  console.log("[e2e-phase] compile vote reducer");
  const reducerCompilation = await VoteReducer.compile({
    proofsEnabled,
    cache,
  });
  console.log("[e2e-phase] compile staking conversion");
  const stakingCompilation = await StakingLedgerToVotingLedger.compile({
    proofsEnabled,
    cache,
  });
  if (proofsEnabled) {
    TreasuryProposalSmartContract.voteReducerVerificationKey =
      reducerCompilation.verificationKey;
    TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
      stakingCompilation.verificationKey;
  }
  console.log("[e2e-phase] compile treasury contracts");
  await TreasuryProposalSmartContract.compile({ cache });
  TreasuryOwnerSmartContract.proposalContractVerificationKey =
    TreasuryProposalSmartContract._verificationKey;
  await TreasuryPauseControllerSmartContract.compile({ cache });
  await TreasuryOwnerSmartContract.compile({ cache });
  console.log("[e2e-phase] deploy and fund treasury");

  const pauseControllerPrivateKey = PrivateKey.random();
  const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const proposalPrivateKey = PrivateKey.random();
  const proposalPublicKey = proposalPrivateKey.toPublicKey();
  const recipientPublicKey = PrivateKey.random().toPublicKey();
  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerPublicKey,
  );
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const proposalTokenIdBase58 = TokenId.toBase58(treasuryOwner.deriveTokenId());
  const proposalAmount = UInt64.from(100_000_000_000);
  const treasuryFundingAmount = UInt64.from(200_000_000_000);
  const amountWithBond = proposalAmount.add(
    proposalAmount.div(BOND_AMOUNT_DIVISOR),
  );

  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey =
    pauseControllerPublicKey;

  const deployPauseControllerTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(senderPublicKey, 1);
      await pauseController.deploy();
    },
  );
  deployPauseControllerTx.sign([senderPrivateKey, pauseControllerPrivateKey]);
  await deployPauseControllerTx.prove();
  const pauseControllerResult = await submitAndMirror(
    local,
    deployPauseControllerTx,
  );

  const deployTreasuryOwnerTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(senderPublicKey, 1);
      await treasuryOwner.deploy();
    },
  );
  deployTreasuryOwnerTx.sign([senderPrivateKey, treasuryOwnerPrivateKey]);
  await deployTreasuryOwnerTx.prove();
  const treasuryOwnerDeployResult = await submitAndMirror(
    local,
    deployTreasuryOwnerTx,
  );

  const fundTreasuryTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      const senderFundingUpdate = AccountUpdate.createSigned(senderPublicKey);
      senderFundingUpdate.balance.subInPlace(treasuryFundingAmount);
      await treasuryOwner.receive(treasuryFundingAmount);
    },
  );
  fundTreasuryTx.sign([senderPrivateKey]);
  await fundTreasuryTx.prove();
  const fundTreasuryResult = await submitAndMirror(local, fundTreasuryTx);

  for (let index = 0; index <= ACCOUNT_BATCH_SIZE; index += 1) {
    const emptyAccount = Account.empty();
    await stakingLedger.setAccount(BigInt(index), emptyAccount);
    await stakingLedger.setLeaf(BigInt(index), emptyAccount);
  }
  const treasuryOwnerLedgerAccount = {
    ...Account.empty(),
    pk: treasuryOwnerPublicKey,
    delegate: treasuryOwnerPublicKey,
    balance: local.getAccount(treasuryOwnerPublicKey).balance,
  };
  const stakingLedgerAccount1 = {
    ...Account.empty(),
    pk: voterPublicKey1,
    delegate: voterPublicKey1,
    balance: UInt64.from(voter1.balance),
  };
  const stakingLedgerAccount2 = {
    ...Account.empty(),
    pk: voterPublicKey2,
    delegate: voterPublicKey2,
    balance: UInt64.from(voter2.balance),
  };
  const stakingLedgerAccount3 = {
    ...Account.empty(),
    pk: senderPublicKey,
    delegate: senderPublicKey,
    balance: UInt64.from(sender.balance),
  };
  const stakingLedgerAccount4 = {
    ...Account.empty(),
    pk: bondPayerPublicKey,
    delegate: bondPayerPublicKey,
    balance: UInt64.from(bondPayer.balance),
  };
  await stakingLedger.setAccount(0n, treasuryOwnerLedgerAccount);
  await stakingLedger.setLeaf(0n, treasuryOwnerLedgerAccount);
  await stakingLedger.setAccount(1n, stakingLedgerAccount1);
  await stakingLedger.setLeaf(1n, stakingLedgerAccount1);
  await stakingLedger.setAccount(2n, stakingLedgerAccount2);
  await stakingLedger.setLeaf(2n, stakingLedgerAccount2);
  await stakingLedger.setAccount(3n, stakingLedgerAccount3);
  await stakingLedger.setLeaf(3n, stakingLedgerAccount3);
  await stakingLedger.setAccount(4n, stakingLedgerAccount4);
  await stakingLedger.setLeaf(4n, stakingLedgerAccount4);
  const stakingLedgerRoot = await stakingLedger.getRoot();
  const stakingLedgerTotalCurrency = [
    treasuryOwnerLedgerAccount.balance,
    stakingLedgerAccount1.balance,
    stakingLedgerAccount2.balance,
    stakingLedgerAccount3.balance,
    stakingLedgerAccount4.balance,
  ].reduce((sum, balance) => sum.add(balance), UInt64.from(0));
  const stakingInput = new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(0),
    stakingLedgerRoot,
    votingLedgerRoot: await votingLedger.getRoot(),
  });
  console.log("[e2e-phase] digest staking ledger");
  const stakingAccounts = [
    treasuryOwnerLedgerAccount,
    stakingLedgerAccount1,
    stakingLedgerAccount2,
    stakingLedgerAccount3,
    stakingLedgerAccount4,
  ];
  // Use the production in-memory ledger overlay for tracing, then replay its witnesses.
  const stakingRecording = new RecordingStakingLedger(stakingLedger);
  const votingRecording = new RecordingVotingLedger(votingLedger);
  stakingLedgerToVotingLedgerContext.set({
    stakingLedger: stakingRecording,
    votingLedger: votingRecording,
  });
  await StakingLedgerToVotingLedger.rawMethods.digest(
    stakingInput,
    stakingAccounts,
  );
  stakingLedgerToVotingLedgerContext.set({
    stakingLedger: new ReplayableStakingLedger(
      stakingRecording.recorder.recordings.witnesses,
    ),
    votingLedger: new ReplayableVotingLedger(
      votingRecording.recorder.recordings.witnesses,
      votingRecording.recorder.recordings.votingAccounts,
    ),
  });
  const { proof: digestProof } = await StakingLedgerToVotingLedger.digest(
    stakingInput,
    stakingAccounts,
  );
  console.log("[e2e-phase] exhaust staking ledger");
  stakingLedgerToVotingLedgerContext.set({
    stakingLedger: new ReplayableStakingLedger({
      [ACCOUNT_BATCH_SIZE]: [
        await stakingLedger.getWitness(BigInt(ACCOUNT_BATCH_SIZE)),
      ],
    }),
    votingLedger: new ReplayableVotingLedger({}, {}),
  });
  const { proof: exhaustedProof } = await StakingLedgerToVotingLedger.exhaust(
    stakingInput,
    digestProof,
  );
  const stakingLedgerProof =
    SideLoadedStakingLedgerToVotingLedgerProof.fromProof(exhaustedProof);
  const votingLedgerRoot = await votingLedger.getRoot();
  assert.equal(
    stakingLedgerProof.publicOutput.votingLedgerRoot.toString(),
    votingLedgerRoot.toString(),
  );
  assert.equal(stakingLedgerProof.publicOutput.exhausted.toBoolean(), true);
  if (proofsEnabled) {
    assert.equal(
      await StakingLedgerToVotingLedger.verify(exhaustedProof),
      true,
    );
  }
  local.setNetworkState({
    ...local.getNetworkState(),
    stakingEpochData: {
      ...local.getNetworkState().stakingEpochData,
      ledger: {
        ...local.getNetworkState().stakingEpochData.ledger,
        hash: stakingLedgerRoot,
        totalCurrency: stakingLedgerTotalCurrency,
      },
    },
  });
  await updateServerNetworkState({
    stakingEpochDataLedgerHash: stakingLedgerRoot.toString(),
    stakingEpochDataLedgerTotalCurrency: stakingLedgerTotalCurrency.toString(),
  });

  console.log("[e2e-phase] create proposal and submit votes");
  const createProposalTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(senderPublicKey, 1);
      const bondPayerAccountUpdate =
        AccountUpdate.createSigned(bondPayerPublicKey);
      bondPayerAccountUpdate.balance.subInPlace(
        proposalAmount.div(BOND_AMOUNT_DIVISOR),
      );
      await treasuryOwner.createProposal(
        proposalPublicKey,
        {
          amount: proposalAmount,
          recipient: recipientPublicKey,
          zkAppUri: ZkappUri.from("https://example.com/proposals/full-flow"),
        },
        UInt32.from(0),
      );
    },
  );
  createProposalTx.sign([
    senderPrivateKey,
    proposalPrivateKey,
    bondPayerPrivateKey,
  ]);
  await createProposalTx.prove();
  const createProposalResult = await submitAndMirror(local, createProposalTx);

  await mirrorManualSlotAdvance(local, lifecyclePeriodDuration.mul(2));

  const voteTx1 = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.vote(proposalPublicKey, voterPublicKey1, Vote.YAY);
    },
  );
  voteTx1.sign([senderPrivateKey, voterPrivateKey1]);
  await voteTx1.prove();
  const voteResult1 = await submitAndMirror(local, voteTx1);

  await mirrorManualSlotAdvance(local, UInt32.from(1));

  const voteTx2 = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.vote(
        proposalPublicKey,
        voterPublicKey2,
        Vote.ABSTRAIN,
      );
    },
  );
  voteTx2.sign([senderPrivateKey, voterPrivateKey2]);
  await voteTx2.prove();
  const voteResult2 = await submitAndMirror(local, voteTx2);

  await mirrorManualSlotAdvance(local, UInt32.from(1));

  const voteTx3 = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.vote(proposalPublicKey, senderPublicKey, Vote.YAY);
    },
  );
  voteTx3.sign([senderPrivateKey]);
  await voteTx3.prove();
  const voteResult3 = await submitAndMirror(local, voteTx3);

  await mirrorManualSlotAdvance(local, UInt32.from(1));

  const voteTx4 = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.vote(proposalPublicKey, bondPayerPublicKey, Vote.YAY);
    },
  );
  voteTx4.sign([senderPrivateKey, bondPayerPrivateKey]);
  await voteTx4.prove();
  const voteResult4 = await submitAndMirror(local, voteTx4);

  await mirrorManualSlotAdvance(local, UInt32.from(1));

  const voteTx5 = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.vote(proposalPublicKey, voterPublicKey1, Vote.NAY);
    },
  );
  voteTx5.sign([senderPrivateKey, voterPrivateKey1]);
  await voteTx5.prove();
  const voteResult5 = await submitAndMirror(local, voteTx5);

  await mirrorManualSlotAdvance(local, lifecyclePeriodDuration);

  const voteReducerService = new SqliteVoteReducerService({
    lifecycleId,
    archiveNodeUrl: archiveUrl,
    proposalPublicKey: proposalPublicKey.toBase58(),
    proposalTokenId: proposalTokenIdBase58,
  });
  const fetchedActions = await voteReducerService.fetchProposalActions();
  const actionStateHistoryTarget = new ActionStateHistoryTarget({
    actionStateOne: Field(
      fetchedActions.actionStateHistoryTarget.actionStateOne,
    ),
    actionStateTwo: Field(
      fetchedActions.actionStateHistoryTarget.actionStateTwo,
    ),
    actionStateThree: Field(
      fetchedActions.actionStateHistoryTarget.actionStateThree,
    ),
    actionStateFour: Field(
      fetchedActions.actionStateHistoryTarget.actionStateFour,
    ),
    actionStateFive: Field(
      fetchedActions.actionStateHistoryTarget.actionStateFive,
    ),
  });
  const paddedVoteActions = [
    ...Array.from(
      {
        length: Math.max(
          0,
          VOTE_ACTION_BATCH_SIZE - fetchedActions.voteActions.length,
        ),
      },
      () => VoteAction.dummy(),
    ),
    ...fetchedActions.voteActions,
  ].slice(0, VOTE_ACTION_BATCH_SIZE);
  console.log("[e2e-phase] reduce vote actions");
  const reducerInput = {
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot,
    // No nullifier has changed before the first reducer batch.
    fromNullifierRoot: emptyNullifierRoot,
    actionStateHistoryTarget,
  };
  const reducerVotingRecording = new RecordingVotingLedger(votingLedger);
  const nullifierRecording = new RecordingNullifierLedger(nullifierLedger);
  voteReducerContext.set({
    votingLedger: reducerVotingRecording,
    nullifierLedger: nullifierRecording,
  });
  await runPhase(
    "trace vote reducer",
    () => VoteReducer.rawMethods.reduceBatch(reducerInput, paddedVoteActions),
    120_000,
  );
  const reducerTrace = new VoteReducerRunBatchTrace({
    publicInput: reducerInput,
    privateInput: { voteActions: paddedVoteActions },
    votingLedgerWitnesses: reducerVotingRecording.recorder.recordings.witnesses,
    votingAccounts: reducerVotingRecording.recorder.recordings.votingAccounts,
    nullifierLedgerWitnesses: nullifierRecording.recorder.recordings.witnesses,
    nullifiers: nullifierRecording.recorder.recordings.nullifiers,
  });
  const voteReducerProof = await runPhase(
    "prove vote reducer",
    () => proveVoteReducerInWorker(reducerTrace),
    1_800_000,
  );
  const expectedYay = stakingLedgerAccount1.balance
    .add(stakingLedgerAccount3.balance)
    .add(stakingLedgerAccount4.balance);
  assert.equal(
    voteReducerProof.publicOutput.yay.toString(),
    expectedYay.toString(),
  );
  assert.equal(voteReducerProof.publicOutput.nay.toString(), "0");
  assert.equal(
    voteReducerProof.publicOutput.abstain.toString(),
    stakingLedgerAccount2.balance.toString(),
  );
  // The isolated worker verifies the real proof before returning it. The
  // subsequent tally transaction verifies it again with the deployed key.
  const treasuryOwnerAccount = await stakingLedger.getAccount(0n);
  const treasuryOwnerAccountWitness = await stakingLedger.getWitness(0n);
  console.log("[e2e-phase] tally proposal");
  const tallyTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      await treasuryOwner.tallyVotes(
        proposalPublicKey,
        SideLoadedVoteReducerProof.fromProof(voteReducerProof),
        stakingLedgerProof,
        treasuryOwnerAccount,
        treasuryOwnerAccountWitness,
      );
    },
  );
  tallyTx.sign([senderPrivateKey]);
  await tallyTx.prove();
  const tallyResult = await submitAndMirror(local, tallyTx);

  await mirrorManualSlotAdvance(local, lifecyclePeriodDuration.mul(2));

  console.log("[e2e-phase] execute proposal");
  const executeTx = await Mina.transaction(
    { sender: senderPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(senderPublicKey, 1);
      await treasuryOwner.executeProposal(
        proposalPublicKey,
        recipientPublicKey,
        amountWithBond,
      );
    },
  );
  executeTx.sign([senderPrivateKey]);
  await executeTx.prove();
  const executeResult = await submitAndMirror(local, executeTx);

  console.log("[e2e-phase] close fixture stores");
  await votingLedger.close();
  await nullifierLedger.close();
  await stakingLedger.close();
  await sqlite.disconnect();

  console.log(
    `FULL_TREASURY_FLOW_RESULT:${JSON.stringify({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      proposalTokenId: proposalTokenIdBase58,
      recipientPublicKey: recipientPublicKey.toBase58(),
      pauseControllerTxHash: pauseControllerResult.hash,
      treasuryOwnerDeployTxHash: treasuryOwnerDeployResult.hash,
      fundTreasuryTxHash: fundTreasuryResult.hash,
      proposalTxHash: createProposalResult.hash,
      voteTxHashes: [
        voteResult1.hash,
        voteResult2.hash,
        voteResult3.hash,
        voteResult4.hash,
        voteResult5.hash,
      ],
      tallyTxHash: tallyResult.hash,
      executeTxHash: executeResult.hash,
      finalSlot: Number(
        local.getNetworkState().globalSlotSinceGenesis.toString(),
      ),
    })}`,
  );
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? (error.stack ?? error.message)
      : JSON.stringify(error),
  );
  process.exit(1);
});
