import assert from "node:assert";
import { before, after, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RedisMemoryServer } from "redis-memory-server";
import {
  Field,
  LedgerHashBase58,
  PrivateKey,
  PublicKey,
  Reducer,
  UInt32,
  UInt64,
} from "o1js";
import {
  getCurrentGlobalSlot,
  MINA_NODE_URL,
  parseTreasuryProposalActionsResult,
  parseTreasuryProposalTallyResult,
  parseTreasuryProposalVoteResult,
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
} from "./utils/cli-test-utils.js";
import {
  loadPreparedLightnetFixture,
  prepareVotingLedgerForLifecycle,
  selectPreparedProposalLifecycle,
  type PreparedLightnetFixture,
  validatePreparedLightnetFixture,
} from "./utils/prepared-lightnet-fixture.js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { MIN_PROPOSAL_AMOUNT } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { getVoteReducerScope } from "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import { createSqliteVoteReducerProofStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { createInMemoryTransactionSigner } from "@repo/sdk/src/services/transaction-signing.js";

let fixture: PreparedLightnetFixture;
let runDirectory: string;
let sqliteDataDirectory: string;
let originalSqliteDataDirectory: string | undefined;
let originalProofsEnabled: string | undefined;
let originalNetworkId: string | undefined;
let originalLifecyclePeriodDuration: string | undefined;
let originalMinaNodeUrl: string | undefined;
let originalArchiveNodeUrl: string | undefined;
let originalAccountManagerUrl: string | undefined;

const runTreasuryCliWithSqliteFixtures = (args: string[]) =>
  runCli(args, {
    timeoutMs: 600_000,
  });

function logStep(message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  if (details === undefined) {
    console.log(`[treasury-owner.test ${timestamp}] ${message}`);
    return;
  }
  console.log(`[treasury-owner.test ${timestamp}] ${message}`, details);
}

function fieldToLedgerHashBase58(fieldValue: Field): string {
  return LedgerHashBase58.toBase58(fieldValue);
}

function parseProofFieldAt(
  proofArray: unknown,
  index: number,
  label: string,
): Field {
  assert(Array.isArray(proofArray), `expected ${label} to be an array`);
  const value = proofArray[index];
  assert(
    typeof value === "string",
    `expected ${label}[${index}] to be a string`,
  );
  return Field(value);
}

function assertVoteReducerProofMatchesExpectedActionHistory(
  proofLabel: string,
  proofFile: { publicInput?: unknown; publicOutput?: unknown },
  expectedActionStateHistoryTarget: {
    actionStateOne: string;
    actionStateTwo: string;
    actionStateThree: string;
    actionStateFour: string;
    actionStateFive: string;
  },
): void {
  assert(
    proofFile.publicInput,
    `expected ${proofLabel} to contain publicInput`,
  );
  assert(
    proofFile.publicOutput,
    `expected ${proofLabel} to contain publicOutput`,
  );
  assert(
    Array.isArray(proofFile.publicInput),
    `expected ${proofLabel}.publicInput array`,
  );
  assert(
    Array.isArray(proofFile.publicOutput),
    `expected ${proofLabel}.publicOutput array`,
  );

  assert.strictEqual(
    proofFile.publicInput[0],
    Reducer.initialActionState.toString(),
    `expected ${proofLabel}.publicInput[0] to be Reducer.initialActionState`,
  );
  assert.deepStrictEqual(
    proofFile.publicInput.slice(3, 8),
    [
      expectedActionStateHistoryTarget.actionStateOne,
      expectedActionStateHistoryTarget.actionStateTwo,
      expectedActionStateHistoryTarget.actionStateThree,
      expectedActionStateHistoryTarget.actionStateFour,
      expectedActionStateHistoryTarget.actionStateFive,
    ],
    `expected ${proofLabel}.publicInput action-state target order to match fetched archive snapshot`,
  );
  assert.strictEqual(
    proofFile.publicOutput[0],
    proofFile.publicOutput[5],
    `expected ${proofLabel}.publicOutput.toActionsHash to match actionStateOne.hash`,
  );
  assert.strictEqual(
    proofFile.publicOutput[6],
    "1",
    `expected ${proofLabel}.publicOutput.actionStateOne.found to be true`,
  );
}

async function fetchCurrentStakingEpochLedgerHash(): Promise<Field> {
  const response = await fetch(MINA_NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query CurrentStakingEpochLedgerHash {
          bestChain(maxLength: 1) {
            protocolState {
              consensusState {
                stakingEpochData {
                  ledger {
                    hash
                  }
                }
              }
            }
          }
        }
      `,
    }),
  });
  assert(
    response.ok,
    `failed to query staking epoch hash: HTTP ${response.status}`,
  );
  const payload = (await response.json()) as {
    data?: {
      bestChain?: Array<{
        protocolState?: {
          consensusState?: {
            stakingEpochData?: {
              ledger?: {
                hash?: string;
              };
            };
          };
        };
      }>;
    };
    errors?: { message: string }[];
  };
  assert(
    !payload.errors?.length,
    payload.errors?.map((error) => error.message).join("; "),
  );
  const hash =
    payload.data?.bestChain?.[0]?.protocolState?.consensusState
      ?.stakingEpochData?.ledger?.hash;
  assert(hash, "missing stakingEpochData.ledger.hash in GraphQL response");
  return LedgerHashBase58.fromBase58(hash);
}

before(async () => {
  fixture = await loadPreparedLightnetFixture();
  await validatePreparedLightnetFixture(fixture);
  runDirectory = await mkdtemp(join(tmpdir(), "treasury-owner-lightnet-"));
  originalSqliteDataDirectory = process.env.SQLITE_DATA_DIRECTORY;
  originalProofsEnabled = process.env.PROOFS_ENABLED;
  originalNetworkId = process.env.NETWORK;
  originalLifecyclePeriodDuration = process.env.LIFECYCLE_PERIOD_DURATION;
  originalMinaNodeUrl = process.env.MINA_NODE_URL;
  originalArchiveNodeUrl = process.env.ARCHIVE_NODE_URL;
  originalAccountManagerUrl = process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT;
  process.env.PROOFS_ENABLED = String(fixture.proofsEnabled);
  process.env.NETWORK = fixture.networkId;
  process.env.MINA_NODE_URL = fixture.minaNodeUrl;
  process.env.ARCHIVE_NODE_URL = fixture.archiveNodeUrl;
  process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT = fixture.accountManagerUrl;
  process.env.LIFECYCLE_PERIOD_DURATION = String(
    fixture.lifecyclePeriodDurationSlots,
  );
});

after(() => {
  if (originalSqliteDataDirectory === undefined)
    delete process.env.SQLITE_DATA_DIRECTORY;
  else process.env.SQLITE_DATA_DIRECTORY = originalSqliteDataDirectory;
  if (originalProofsEnabled === undefined) delete process.env.PROOFS_ENABLED;
  else process.env.PROOFS_ENABLED = originalProofsEnabled;
  if (originalNetworkId === undefined) delete process.env.NETWORK;
  else process.env.NETWORK = originalNetworkId;
  if (originalLifecyclePeriodDuration === undefined) {
    delete process.env.LIFECYCLE_PERIOD_DURATION;
  } else {
    process.env.LIFECYCLE_PERIOD_DURATION = originalLifecyclePeriodDuration;
  }
  if (originalMinaNodeUrl === undefined) delete process.env.MINA_NODE_URL;
  else process.env.MINA_NODE_URL = originalMinaNodeUrl;
  if (originalArchiveNodeUrl === undefined) delete process.env.ARCHIVE_NODE_URL;
  else process.env.ARCHIVE_NODE_URL = originalArchiveNodeUrl;
  if (originalAccountManagerUrl === undefined) {
    delete process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT;
  } else {
    process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT = originalAccountManagerUrl;
  }
});

function formatEtaMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

async function waitForSlotWithProgress(
  targetSlot: number,
  phaseLabel: string,
  timeoutMs = 600_000,
): Promise<number> {
  const start = Date.now();
  let lastProgressLogAt = 0;
  let lastLoggedSlot = -1;

  while (Date.now() - start < timeoutMs) {
    const currentSlot = await getCurrentGlobalSlot();
    const remainingSlots = Math.max(0, targetSlot - currentSlot);
    const etaMs = remainingSlots * fixture.slotDurationMs;

    const now = Date.now();
    const shouldLog =
      currentSlot !== lastLoggedSlot &&
      (lastProgressLogAt === 0 || now - lastProgressLogAt >= 5000);
    if (shouldLog) {
      logStep(`${phaseLabel} poll`, {
        currentSlot,
        targetSlot,
        remainingSlots,
        estimatedWait: formatEtaMs(etaMs),
        slotDurationMs: fixture.slotDurationMs,
      });
      lastProgressLogAt = now;
      lastLoggedSlot = currentSlot;
    }

    if (currentSlot >= targetSlot) {
      return currentSlot;
    }
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for ${phaseLabel} at global slot ${targetSlot}`,
  );
}

async function fetchProposalActionsWithRetry(options: {
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  outputPath: string;
  minCount?: number;
  timeoutMs?: number;
}): Promise<
  NonNullable<ReturnType<typeof parseTreasuryProposalActionsResult>>
> {
  const minCount = options.minCount ?? 1;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    const fetchActionsOutput = await runTreasuryCliWithSqliteFixtures([
      "proposal",
      "fetch-actions",
      "--treasury-owner-public-key",
      options.treasuryOwnerPublicKey.toBase58(),
      "--proposal-public-key",
      options.proposalPublicKey.toBase58(),
      "--output-path",
      options.outputPath,
    ]);
    const actionsResult =
      parseTreasuryProposalActionsResult(fetchActionsOutput);
    assert(actionsResult, "expected proposal fetch-actions JSON marker output");

    if (actionsResult.count >= minCount) {
      logStep("proposal actions became available through CLI", {
        attempts,
        count: actionsResult.count,
        outputPath: options.outputPath,
      });
      return actionsResult;
    }

    logStep("proposal actions not yet visible in archive, retrying", {
      attempts,
      count: actionsResult.count,
      outputPath: options.outputPath,
    });
    await sleep(2_000);
  }

  throw new Error(
    `Timed out waiting for proposal actions to appear in archive after ${attempts} attempts`,
  );
}

async function runTreasuryOwnerFlow(): Promise<void> {
  const lifecyclePeriodDuration = fixture.lifecyclePeriodDurationSlots;
  const txFee = UInt64.from(5 * 10 ** 9);
  const lifecycle = await selectPreparedProposalLifecycle(fixture, {
    minimumRemainingSlots: Math.ceil(lifecyclePeriodDuration / 2),
  });
  const proposalLifecycleId = lifecycle.lifecycleId;
  const proofLifecycleId = String(proposalLifecycleId);
  ({ sqliteDataDirectory } = await prepareVotingLedgerForLifecycle(
    fixture,
    proofLifecycleId,
    runDirectory,
  ));
  process.env.SQLITE_DATA_DIRECTORY = sqliteDataDirectory;
  const proofQueueName = `proofs-lightnet-${Date.now()}`;
  const actionsOutputPath = join(runDirectory, "proposal-actions.json");
  const voteReducerMergedProofOutputPath = join(
    runDirectory,
    "vote-reducer-merged-proof.json",
  );
  const stakingLedgerToVotingLedgerExhaustProofArtifactPath =
    fixture.exhaustedProofPath;
  const stakingProofFile = JSON.parse(
    await readFile(stakingLedgerToVotingLedgerExhaustProofArtifactPath, "utf8"),
  ) as { publicInput?: unknown; publicOutput?: unknown };
  assert(
    stakingProofFile.publicInput,
    "expected exhausted staking-ledger-to-voting-ledger proof to contain publicInput",
  );
  assert(
    stakingProofFile.publicOutput,
    "expected exhausted staking-ledger-to-voting-ledger proof to contain publicOutput",
  );
  const stakingProofPublicInputStakingRoot = parseProofFieldAt(
    stakingProofFile.publicInput,
    1,
    "stakingProof.publicInput",
  );
  const stakingProofPublicInputVotingRoot = parseProofFieldAt(
    stakingProofFile.publicInput,
    2,
    "stakingProof.publicInput",
  );
  const stakingProofPublicOutputVotingRoot = parseProofFieldAt(
    stakingProofFile.publicOutput,
    1,
    "stakingProof.publicOutput",
  );

  logStep("starting end-to-end treasury owner flow", {
    proofsEnabled: true,
    lifecyclePeriodDuration,
    txFee: txFee.toString(),
  });

  const selectedVoters = fixture.voters.slice(0, 5);
  const voterPrivateKeys = selectedVoters.map(({ privateKey }) =>
    PrivateKey.fromBase58(privateKey),
  );
  const senderPrivateKey = voterPrivateKeys[0];
  assert(senderPrivateKey);
  const recipientPublicKey = PrivateKey.random().toPublicKey();
  const senderPublicKey = senderPrivateKey.toPublicKey();
  const treasuryOwnerPublicKey = PublicKey.fromBase58(fixture.ownerPublicKey);
  await validatePreparedLightnetFixture(fixture);

  const treasuryOwnerContract = new TreasuryOwnerSmartContract(
    treasuryOwnerPublicKey,
  );
  const proposalPhaseStartSlot = lifecycle.startSlot;
  const service = new SqliteTreasuryOwnerService();
  await service.compile({
    proofsEnabled: fixture.proofsEnabled,
    lifecyclePeriodDuration: UInt32.from(lifecyclePeriodDuration),
  });
  await validatePreparedLightnetFixture(fixture);

  console.time("treasury-owner.e2e.lightnet.createProposal");
  const proposalPrivateKey = PrivateKey.random();
  const proposalResult = await service.createProposal({
    ...(await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
      proofLifecycleId,
      treasuryOwnerPublicKey,
    )),
    minaNodeUrl: fixture.minaNodeUrl,
    senderPublicKey,
    treasuryOwnerPublicKey,
    proposalPublicKey: proposalPrivateKey.toPublicKey(),
    proposalLifecycleId: UInt32.from(proposalLifecycleId),
    recipientPublicKey,
    amount: UInt64.from(MIN_PROPOSAL_AMOUNT),
    proposalZkappUri: "https://example.com/proposals/test-e2e",
    fee: txFee,
    wait: true,
    transactionSigner: createInMemoryTransactionSigner([
      senderPrivateKey,
      proposalPrivateKey,
    ]),
  });
  console.timeEnd("treasury-owner.e2e.lightnet.createProposal");
  const slotAfterCreateProposal = await getCurrentGlobalSlot();
  await waitForSlotWithProgress(
    slotAfterCreateProposal + 1,
    "post-create-proposal block",
    120_000,
  );

  const createdProposalPublicKey = PublicKey.fromBase58(
    proposalResult.proposalAddress,
  );
  const proposalContract = new TreasuryProposalSmartContract(
    createdProposalPublicKey,
    treasuryOwnerContract.deriveTokenId(),
  );
  const proposalStakingEpochDataLedgerHash =
    await proposalContract.stakingEpochDataLedgerHash.fetch();
  const proposalStakingEpochDataLedgerTotalCurrency =
    await proposalContract.stakingEpochDataLedgerTotalCurrency.fetch();
  assert(
    proposalStakingEpochDataLedgerHash,
    "expected proposal stakingEpochDataLedgerHash after create",
  );
  assert(
    proposalStakingEpochDataLedgerTotalCurrency,
    "expected proposal stakingEpochDataLedgerTotalCurrency after create",
  );
  const liveStakingEpochLedgerHash = await fetchCurrentStakingEpochLedgerHash();
  logStep("debug: proposal and live staking epoch hashes after create", {
    proposalAddress: createdProposalPublicKey.toBase58(),
    proposalStakingEpochDataLedgerHash:
      proposalStakingEpochDataLedgerHash.toString(),
    proposalStakingEpochDataLedgerHashBase58: fieldToLedgerHashBase58(
      proposalStakingEpochDataLedgerHash,
    ),
    proposalStakingEpochDataLedgerTotalCurrency:
      proposalStakingEpochDataLedgerTotalCurrency.toString(),
    liveStakingEpochLedgerHash: liveStakingEpochLedgerHash.toString(),
    liveStakingEpochLedgerHashBase58: fieldToLedgerHashBase58(
      liveStakingEpochLedgerHash,
    ),
    stakingHashMatchesLive: proposalStakingEpochDataLedgerHash
      .equals(liveStakingEpochLedgerHash)
      .toBoolean(),
  });
  const proposalStatusBeforeTally = await proposalContract.status.fetch();
  assert(
    proposalStatusBeforeTally?.equals(ProposalStatus.UNKNOWN).toBoolean(),
    "expected proposal status UNKNOWN before tally",
  );

  const voteStartSlot = proposalPhaseStartSlot + lifecyclePeriodDuration * 2;
  const currentVoteWaitSlot = await getCurrentGlobalSlot();
  if (currentVoteWaitSlot < voteStartSlot) {
    await waitForSlotWithProgress(
      voteStartSlot,
      "voting phase",
      Math.max(1, voteStartSlot - currentVoteWaitSlot) *
        fixture.slotDurationMs +
        120_000,
    );
  }

  for (let i = 0; i < voterPrivateKeys.length; i++) {
    const voterPrivateKey = voterPrivateKeys[i];
    console.time(`treasury-owner.e2e.lightnet.voteProposal.cli.${i}`);
    const voteOutput = await runTreasuryCliWithSqliteFixtures([
      "proposal",
      "vote",
      "--sender-private-key",
      senderPrivateKey.toBase58(),
      "--treasury-owner-public-key",
      treasuryOwnerPublicKey.toBase58(),
      "--proposal-public-key",
      createdProposalPublicKey.toBase58(),
      "--voter-private-key",
      voterPrivateKey.toBase58(),
      "--vote",
      selectedVoters[i]!.vote,
      "--fee",
      txFee.toString(),
      "--wait",
      "true",
    ]);
    console.timeEnd(`treasury-owner.e2e.lightnet.voteProposal.cli.${i}`);
    const voteResult = parseTreasuryProposalVoteResult(voteOutput);
    assert(voteResult, "expected proposal vote JSON marker output");
    assert(voteResult.voteTxHash, "expected vote transaction hash");
    const slotAfterVote = await getCurrentGlobalSlot();
    await waitForSlotWithProgress(
      slotAfterVote + 1,
      `post-vote block ${i + 1}`,
      120_000,
    );
  }

  await rm(actionsOutputPath, { force: true });
  const actionsResult = await fetchProposalActionsWithRetry({
    treasuryOwnerPublicKey,
    proposalPublicKey: createdProposalPublicKey,
    outputPath: actionsOutputPath,
    minCount: voterPrivateKeys.length,
    timeoutMs: 180_000,
  });
  assert(
    actionsResult.count >= voterPrivateKeys.length,
    `expected at least ${voterPrivateKeys.length} fetched vote actions, got ${actionsResult.count}`,
  );

  const actionsFile = JSON.parse(await readFile(actionsOutputPath, "utf8")) as {
    voteActions?: unknown[];
    actionStateHistoryTarget?: {
      actionStateOne?: string;
      actionStateTwo?: string;
      actionStateThree?: string;
      actionStateFour?: string;
      actionStateFive?: string;
    };
  };
  assert(
    Array.isArray(actionsFile.voteActions),
    "expected voteActions in output file",
  );
  assert(
    actionsFile.actionStateHistoryTarget?.actionStateOne &&
      actionsFile.actionStateHistoryTarget.actionStateTwo &&
      actionsFile.actionStateHistoryTarget.actionStateThree &&
      actionsFile.actionStateHistoryTarget.actionStateFour &&
      actionsFile.actionStateHistoryTarget.actionStateFive,
    "expected actionStateHistoryTarget in fetched proposal actions output",
  );
  const expectedActionStateHistoryTarget = {
    actionStateOne: actionsFile.actionStateHistoryTarget.actionStateOne,
    actionStateTwo: actionsFile.actionStateHistoryTarget.actionStateTwo,
    actionStateThree: actionsFile.actionStateHistoryTarget.actionStateThree,
    actionStateFour: actionsFile.actionStateHistoryTarget.actionStateFour,
    actionStateFive: actionsFile.actionStateHistoryTarget.actionStateFive,
  };

  await rm(voteReducerMergedProofOutputPath, { force: true });
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const workerProcess = spawnCliWorker(proofQueueName, {
    redisHost,
    redisPort,
    stdio: "inherit",
  });
  await sleep(400);

  try {
    logStep("debug: staking proof roots", {
      proofPath: stakingLedgerToVotingLedgerExhaustProofArtifactPath,
      stakingProofPublicInputStakingRoot:
        stakingProofPublicInputStakingRoot.toString(),
      stakingProofPublicInputStakingRootBase58: fieldToLedgerHashBase58(
        stakingProofPublicInputStakingRoot,
      ),
      stakingProofPublicInputVotingRoot:
        stakingProofPublicInputVotingRoot.toString(),
      stakingProofPublicOutputVotingRoot:
        stakingProofPublicOutputVotingRoot.toString(),
    });

    await runTreasuryCliWithSqliteFixtures(["vote-reducer", "compile"]);
    await runTreasuryCliWithSqliteFixtures([
      "vote-reducer",
      "trace-run-batch",
      "--staking-ledger-to-voting-ledger-proof-path",
      stakingLedgerToVotingLedgerExhaustProofArtifactPath,
      "--treasury-owner-public-key",
      treasuryOwnerPublicKey.toBase58(),
      "--lifecycle-id",
      proofLifecycleId,
      "--vote-actions-path",
      actionsOutputPath,
    ]);
    await runTreasuryCliWithSqliteFixtures([
      "vote-reducer",
      "prove-run-batch",
      "--vote-actions-path",
      actionsOutputPath,
      "--lifecycle-id",
      proofLifecycleId,
      "--queue-name",
      proofQueueName,
      "--redis-host",
      redisHost,
      "--redis-port",
      String(redisPort),
    ]);

    const proofStore = new KeyvSqlite({
      uri: join(sqliteDataDirectory, `${proofLifecycleId}.sqlite`),
    });
    const proofStorage = createSqliteVoteReducerProofStorage(
      getVoteReducerScope({
        lifecycleId: proofLifecycleId,
        ...JSON.parse(await readFile(actionsOutputPath, "utf8")),
      }),
      proofStore,
    );

    let mergedProofFile: { publicInput?: unknown; publicOutput?: unknown };
    try {
      const baseProofCount = await proofStorage.count();
      const mergeProofCount = await proofStorage.mergeCount();
      const baseProof = await proofStorage.getProof("0");
      assert(
        baseProof,
        "expected vote-reducer base proof with id 0 after prove-run-batch",
      );
      const baseProofFile = baseProof.toJSON() as {
        publicInput?: unknown;
        publicOutput?: unknown;
      };

      assert.strictEqual(
        baseProofCount,
        1,
        `expected exactly 1 vote-reducer base proof for ${actionsFile.voteActions.length} actions, got ${baseProofCount}`,
      );
      assert.strictEqual(
        mergeProofCount,
        0,
        `expected 0 vote-reducer merge proofs before prove-merge, got ${mergeProofCount}`,
      );
      assertVoteReducerProofMatchesExpectedActionHistory(
        "voteReducerBaseProof",
        baseProofFile,
        expectedActionStateHistoryTarget,
      );

      await writeFile(
        voteReducerMergedProofOutputPath,
        JSON.stringify(baseProofFile, null, 2),
      );
      mergedProofFile = baseProofFile;
    } finally {
      await proofStorage.close();
      await proofStore.disconnect();
    }

    const voteReducerPublicInputVotingLedgerRoot = parseProofFieldAt(
      mergedProofFile.publicInput,
      1,
      "voteReducerMergedProof.publicInput",
    );
    const liveStakingEpochLedgerHashBeforeTally =
      await fetchCurrentStakingEpochLedgerHash();
    logStep("debug: pre-tally root comparison", {
      proposalStakingEpochDataLedgerHash:
        proposalStakingEpochDataLedgerHash.toString(),
      proposalStakingEpochDataLedgerHashBase58: fieldToLedgerHashBase58(
        proposalStakingEpochDataLedgerHash,
      ),
      liveStakingEpochLedgerHashBeforeTally:
        liveStakingEpochLedgerHashBeforeTally.toString(),
      liveStakingEpochLedgerHashBeforeTallyBase58: fieldToLedgerHashBase58(
        liveStakingEpochLedgerHashBeforeTally,
      ),
      stakingProofPublicInputStakingRoot:
        stakingProofPublicInputStakingRoot.toString(),
      stakingProofPublicInputStakingRootBase58: fieldToLedgerHashBase58(
        stakingProofPublicInputStakingRoot,
      ),
      stakingProofPublicOutputVotingRoot:
        stakingProofPublicOutputVotingRoot.toString(),
      voteReducerPublicInputVotingLedgerRoot:
        voteReducerPublicInputVotingLedgerRoot.toString(),
      proposalEqualsProofStakingRoot: proposalStakingEpochDataLedgerHash
        .equals(stakingProofPublicInputStakingRoot)
        .toBoolean(),
      liveEqualsProofStakingRoot: liveStakingEpochLedgerHashBeforeTally
        .equals(stakingProofPublicInputStakingRoot)
        .toBoolean(),
      voteReducerRootEqualsStakingProofOutputRoot:
        voteReducerPublicInputVotingLedgerRoot
          .equals(stakingProofPublicOutputVotingRoot)
          .toBoolean(),
    });

    const cooldownStartSlot =
      proposalPhaseStartSlot + lifecyclePeriodDuration * 3;
    const slotBeforeTally = await getCurrentGlobalSlot();
    if (slotBeforeTally < cooldownStartSlot) {
      await waitForSlotWithProgress(
        cooldownStartSlot,
        "cooldown phase",
        (cooldownStartSlot - slotBeforeTally) * fixture.slotDurationMs +
          120_000,
      );
    }

    const tallyOutput = await runTreasuryCliWithSqliteFixtures([
      "proposal",
      "tally-votes",
      "--sender-private-key",
      senderPrivateKey.toBase58(),
      "--treasury-owner-public-key",
      treasuryOwnerPublicKey.toBase58(),
      "--proposal-public-key",
      createdProposalPublicKey.toBase58(),
      "--vote-reducer-proof-path",
      voteReducerMergedProofOutputPath,
      "--staking-ledger-to-voting-ledger-proof-path",
      stakingLedgerToVotingLedgerExhaustProofArtifactPath,
      "--lifecycle-id",
      proofLifecycleId,
      "--fee",
      txFee.toString(),
    ]);
    const tallyResult = parseTreasuryProposalTallyResult(tallyOutput);
    assert(tallyResult, "expected tally-votes JSON marker output");
    assert(tallyResult.tallyTxHash, "expected tally-votes transaction hash");
    const proposalStatusAfterTally = await proposalContract.status.fetch();
    assert(proposalStatusAfterTally, "expected proposal status after tally");
    assert(
      proposalStatusAfterTally.equals(ProposalStatus.APPROVED).toBoolean(),
      "expected proposal status APPROVED after tally",
    );
  } finally {
    workerProcess.kill("SIGTERM");
    await waitForExit(workerProcess, 5_000);
    await redisServer.stop();
  }

  logStep("treasury-owner end-to-end flow finished successfully");
}

it("runs treasury-owner flow with proofs enabled on Lightnet", async () => {
  await runTreasuryOwnerFlow();
});
