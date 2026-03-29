import assert from "node:assert";
import { before, after, it } from "node:test";
import { type ChildProcess } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RedisMemoryServer } from "redis-memory-server";
import {
  Field,
  fetchAccount,
  LedgerHashBase58,
  Mina,
  PrivateKey,
  Provable,
  PublicKey,
  Reducer,
  UInt64,
} from "o1js";
import {
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  MINA_NODE_URL,
  SLOT_TIME_MS,
  ensureLightnetReady,
  parseTreasuryProposalActionsResult,
  parseTreasuryProposalResult,
  parseTreasuryProposalTallyResult,
  parseTreasuryProposalVoteResult,
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
} from "./utils/cli-test-utils.js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { SqliteVoteReducerService } from "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import { createSqliteVoteReducerProofStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";

let lightnetProcess: ChildProcess | undefined;
const FIXTURES_DIRECTORY = fileURLToPath(new URL("./fixtures", import.meta.url));
const SQLITE_FIXTURE_DIRECTORY = fileURLToPath(new URL("./.data/sqlite", import.meta.url));
const SQLITE_LIFECYCLE_ID = "0";
const LIGHTNET_ONLINE_WHALE_0_PRIVATE_KEY =
  "EKFGQcsWmQR9Jj1W2XoGNQzF43T1PNqRhaQrm1vDS948GVbyemrj";
const LIGHTNET_ONLINE_WHALE_1_PRIVATE_KEY =
  "EKERqTxjB7N9x2FzrQyaEJf8XAgm6ShsW4viGdgt6KDjFSfdeHAE";
const LIGHTNET_VOTER_0_PRIVATE_KEY =
  "EKEnVLUhYHDJvgmgQu5SzaV8MWKNfhAXYSkLBRk5KEfudWZRbs4P";
const LIGHTNET_VOTER_1_PRIVATE_KEY =
  "EKEXS3qUZRhxDzExtuAaQVHtxLzt8A3fqS7o7iL9NpvdATsshvB6";
const LIGHTNET_VOTER_2_PRIVATE_KEY =
  "EKF3qRhoze6r6bgF5uRmhMkEahfZJHHQ3hzxqCbPvaNzdhxMVCQh";
const LIGHTNET_VOTER_3_PRIVATE_KEY =
  "EKFd1GxnQ53H3shreTB2VzQJxECz9DE9NjorrkfKyEuKCsHDHVSE";

const runTreasuryCliWithSqliteFixtures = (args: string[]) =>
  runCli(args, {
    timeoutMs: 600_000,
  });

function parseTreasuryFundResult(output: string):
  | { from: string; to: string; amount: string; transferTxHash?: string }
  | undefined {
  const marker = "TREASURY_FUND_TREASURY_JSON:";
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex !== -1) {
    const jsonLine = output.slice(markerIndex + marker.length).split("\n")[0]?.trim();
    if (!jsonLine) return undefined;
    try {
      return JSON.parse(jsonLine) as {
        from: string;
        to: string;
        amount: string;
        transferTxHash?: string;
      };
    } catch {
      return undefined;
    }
  }

  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as {
        from: string;
        to: string;
        amount: string;
        transferTxHash?: string;
      };
    } catch {
      // Keep scanning for a parseable JSON line.
    }
  }
  return undefined;
}

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

function configureTestMinaNetwork(): void {
  Mina.setActiveInstance(
    Mina.Network({
      mina: MINA_NODE_URL,
      lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    }),
  );
}

function parseProofFieldAt(
  proofArray: unknown,
  index: number,
  label: string,
): Field {
  assert(Array.isArray(proofArray), `expected ${label} to be an array`);
  const value = proofArray[index];
  assert(typeof value === "string", `expected ${label}[${index}] to be a string`);
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
  assert(proofFile.publicInput, `expected ${proofLabel} to contain publicInput`);
  assert(proofFile.publicOutput, `expected ${proofLabel} to contain publicOutput`);
  assert(Array.isArray(proofFile.publicInput), `expected ${proofLabel}.publicInput array`);
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
  assert(response.ok, `failed to query staking epoch hash: HTTP ${response.status}`);
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
  assert(!payload.errors?.length, payload.errors?.map((error) => error.message).join("; "));
  const hash =
    payload.data?.bestChain?.[0]?.protocolState?.consensusState?.stakingEpochData
      ?.ledger?.hash;
  assert(hash, "missing stakingEpochData.ledger.hash in GraphQL response");
  return LedgerHashBase58.fromBase58(hash);
}

before(async () => {
  logStep("ensuring lightnet is ready");
  lightnetProcess = await ensureLightnetReady();
  logStep("lightnet ready");
});

after(() => {
  logStep("tearing down lightnet process started by test", {
    startedProcess: Boolean(lightnetProcess),
  });
  lightnetProcess?.kill("SIGTERM");
});

async function loadLedgerVotingPower(): Promise<{
  delegateVotingPower: Map<string, bigint>;
  totalVotingPower: bigint;
}> {
  const ledgerPath = join(FIXTURES_DIRECTORY, "staking-epoch-ledger-lightnet.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as Array<{
    pk: string;
    balance: string;
    delegate: string;
  }>;
  const delegateVotingPower = new Map<string, bigint>();
  let totalVotingPower = 0n;
  for (const account of ledger) {
    const balance = BigInt(Number(account.balance) * 1_000_000_000);
    totalVotingPower += balance;
    delegateVotingPower.set(
      account.delegate,
      (delegateVotingPower.get(account.delegate) ?? 0n) + balance,
    );
  }
  return { delegateVotingPower, totalVotingPower };
}

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
    const etaMs = remainingSlots * SLOT_TIME_MS;

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
        slotDurationMs: SLOT_TIME_MS,
      });
      lastProgressLogAt = now;
      lastLoggedSlot = currentSlot;
    }

    if (currentSlot >= targetSlot) {
      return currentSlot;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${phaseLabel} at global slot ${targetSlot}`);
}

async function fetchProposalActionsWithRetry(options: {
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  outputPath: string;
  minCount?: number;
  timeoutMs?: number;
}): Promise<NonNullable<ReturnType<typeof parseTreasuryProposalActionsResult>>> {
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
    const actionsResult = parseTreasuryProposalActionsResult(fetchActionsOutput);
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

async function clearSqliteFixtureMutableState(): Promise<void> {
  const voteReducerService = new SqliteVoteReducerService({
    lifecycleId: SQLITE_LIFECYCLE_ID,
  });
  await voteReducerService.clearPersistentState();
}

async function runTreasuryOwnerFlow(): Promise<void> {
  configureTestMinaNetwork();

  const lifecyclePeriodDuration = Number.parseInt(
    process.env.LIFECYCLE_PERIOD_DURATION ?? "60",
    10,
  );
  assert(
    Number.isFinite(lifecyclePeriodDuration) && lifecyclePeriodDuration > 0,
    "expected LIFECYCLE_PERIOD_DURATION env var to be a positive integer",
  );

  const txFee = UInt64.from(5 * 10 ** 9);
  const proofLifecycleId = SQLITE_LIFECYCLE_ID;
  const proofQueueName = `proofs-lightnet-${Date.now()}`;
  const actionsOutputPath = join(
    FIXTURES_DIRECTORY,
    "proposal-actions-from-lightnet.json",
  );
  const voteReducerMergedProofOutputPath = join(
    FIXTURES_DIRECTORY,
    "vote-reducer-merged-proof-from-lightnet.json",
  );
  const stakingLedgerToVotingLedgerExhaustProofArtifactPath = fileURLToPath(
    new URL("../artifacts/exhausted-proof.json", import.meta.url),
  );
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
  await clearSqliteFixtureMutableState();
  logStep("cleared sqlite vote-reducer mutable state", {
    lifecycleId: SQLITE_LIFECYCLE_ID,
  });

  const senderPrivateKey = PrivateKey.fromBase58(
    LIGHTNET_ONLINE_WHALE_0_PRIVATE_KEY,
  );
  const treasuryOwnerPrivateKey = PrivateKey.fromBase58(
    LIGHTNET_ONLINE_WHALE_1_PRIVATE_KEY,
  );
  const pauseControllerPrivateKey = PrivateKey.random();
  const proposalPrivateKey = PrivateKey.random();
  const recipientPublicKey = PrivateKey.random().toPublicKey();
  const { delegateVotingPower, totalVotingPower } = await loadLedgerVotingPower();
  const voterPrivateKeys = [
    senderPrivateKey,
    PrivateKey.fromBase58(LIGHTNET_VOTER_0_PRIVATE_KEY),
    PrivateKey.fromBase58(LIGHTNET_VOTER_1_PRIVATE_KEY),
    PrivateKey.fromBase58(LIGHTNET_VOTER_2_PRIVATE_KEY),
    PrivateKey.fromBase58(LIGHTNET_VOTER_3_PRIVATE_KEY),
  ];

  assert(
    senderPrivateKey
      .toPublicKey()
      .equals(treasuryOwnerPrivateKey.toPublicKey())
      .not()
      .toBoolean(),
    "expected whale sender voter key to differ from treasury owner key",
  );

  const selectedVotingPower = voterPrivateKeys.reduce((accumulator, key) => {
    return (
      accumulator + (delegateVotingPower.get(key.toPublicKey().toBase58()) ?? 0n)
    );
  }, 0n);
  assert(selectedVotingPower > 0n, "expected selected voters to have non-zero voting power");

  const selectedParticipationBp =
    totalVotingPower > 0n
      ? Number((selectedVotingPower * 10_000n) / totalVotingPower)
      : 0;
  logStep("selected voters voting power", {
    selectedVotingPower: selectedVotingPower.toString(),
    totalLedgerVotingPower: totalVotingPower.toString(),
    selectedParticipationBp,
    selectedParticipationPct: selectedParticipationBp / 100,
    selectedVoterPublicKeys: voterPrivateKeys.map((key) =>
      key.toPublicKey().toBase58(),
    ),
  });
  assert(
    selectedParticipationBp >= 2_000,
    "expected selected voters to satisfy minimum participation threshold baseline",
  );

  const multisigParticipantsPublicKeys = Array.from({ length: 5 }, () =>
    PrivateKey.random().toPublicKey(),
  );
  const senderPublicKey = senderPrivateKey.toPublicKey();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();
  const proposalPublicKey = proposalPrivateKey.toPublicKey();

  Provable.log("treasury owner e2e keys", {
    senderPublicKey: senderPublicKey.toBase58(),
    treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
    pauseControllerPublicKey: pauseControllerPublicKey.toBase58(),
    proposalPublicKey: proposalPublicKey.toBase58(),
    recipientPublicKey: recipientPublicKey.toBase58(),
    multisigParticipantsPublicKeys: multisigParticipantsPublicKeys.map((key) =>
      key.toBase58(),
    ),
  });

  logStep("deploying treasury-owner and pause-controller contracts");
  const currentSlot = await getCurrentGlobalSlot();
  const treasuryDeployedAtSlot = currentSlot;
  logStep("choosing treasury deployment slot at current slot", {
    currentSlot,
    treasuryDeployedAtSlot,
  });
  console.time("treasury-owner.e2e.lightnet.deploy");
  const deployOutput = await runTreasuryCliWithSqliteFixtures([
    "treasury-owner",
    "deploy",
    "--sender-private-key",
    senderPrivateKey.toBase58(),
    "--treasury-owner-private-key",
    treasuryOwnerPrivateKey.toBase58(),
    "--pause-controller-private-key",
    pauseControllerPrivateKey.toBase58(),
    "--treasury-deployed-at-slot",
    String(treasuryDeployedAtSlot),
    "--multisig-participants-public-keys",
    multisigParticipantsPublicKeys.map((key) => key.toBase58()).join(","),
    "--allow-deploy-to-existing-account",
    "true",
    "--fee",
    txFee.toString(),
  ]);
  console.timeEnd("treasury-owner.e2e.lightnet.deploy");
  assert(deployOutput.length > 0, "expected treasury-owner deploy CLI output");
  const slotAfterDeploy = await getCurrentGlobalSlot();
  await waitForSlotWithProgress(slotAfterDeploy + 1, "post-deploy block", 120_000);

  const treasuryFundingAmount = UInt64.from(10 * 10 ** 9);
  const fundOutput = await runTreasuryCliWithSqliteFixtures([
    "treasury-owner",
    "fund-treasury",
    "--sender-private-key",
    senderPrivateKey.toBase58(),
    "--treasury-owner-public-key",
    treasuryOwnerPublicKey.toBase58(),
    "--amount",
    treasuryFundingAmount.toString(),
    "--fee",
    txFee.toString(),
  ]);
  const transferResult = parseTreasuryFundResult(fundOutput);
  assert(transferResult, "expected treasury funding JSON marker output");
  assert(transferResult.transferTxHash, "expected treasury funding transaction hash");
  const slotAfterFund = await getCurrentGlobalSlot();
  await waitForSlotWithProgress(slotAfterFund + 1, "post-fund block", 120_000);

  const treasuryOwnerContract = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const deployedAtSlot = treasuryDeployedAtSlot;
  const cycleLength = lifecyclePeriodDuration * 4;
  const currentLifecycleSlot = await getCurrentGlobalSlot();
  let proposalLifecycleId = Math.max(
    0,
    Math.floor((currentLifecycleSlot - deployedAtSlot) / cycleLength),
  );
  let proposalPhaseStartSlot = deployedAtSlot + proposalLifecycleId * cycleLength;
  let proposalPhaseEndSlot = proposalPhaseStartSlot + lifecyclePeriodDuration;
  if (currentLifecycleSlot > proposalPhaseEndSlot) {
    proposalLifecycleId += 1;
    proposalPhaseStartSlot += cycleLength;
    proposalPhaseEndSlot += cycleLength;
  }

  if (currentLifecycleSlot < proposalPhaseStartSlot) {
    await waitForSlotWithProgress(
      proposalPhaseStartSlot,
      "proposal phase",
      Math.max(1, proposalPhaseStartSlot - currentLifecycleSlot) * SLOT_TIME_MS +
        120_000,
    );
  }

  console.time("treasury-owner.e2e.lightnet.createProposal");
  const createProposalOutput = await runTreasuryCliWithSqliteFixtures([
    "proposal",
    "create",
    "--sender-private-key",
    senderPrivateKey.toBase58(),
    "--treasury-owner-public-key",
    treasuryOwnerPublicKey.toBase58(),
    "--proposal-private-key",
    proposalPrivateKey.toBase58(),
    "--proposal-lifecycle-id",
    String(proposalLifecycleId),
    "--recipient-public-key",
    recipientPublicKey.toBase58(),
    "--amount",
    String(1_000_000_000),
    "--proposal-zkapp-uri",
    "https://example.com/proposals/test-e2e",
    "--fee",
    txFee.toString(),
  ]);
  const proposalResult = parseTreasuryProposalResult(createProposalOutput);
  console.timeEnd("treasury-owner.e2e.lightnet.createProposal");
  assert(proposalResult, "expected proposal create JSON marker output");
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
      Math.max(1, voteStartSlot - currentVoteWaitSlot) * SLOT_TIME_MS + 120_000,
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
      "yay",
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
  assert(Array.isArray(actionsFile.voteActions), "expected voteActions in output file");
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

    await runTreasuryCliWithSqliteFixtures([
      "vote-reducer",
      "compile",
      "--lifecycle-id",
      proofLifecycleId,
    ]);
    await runTreasuryCliWithSqliteFixtures([
      "vote-reducer",
      "trace-run-batch",
      "--lifecycle-id",
      proofLifecycleId,
      "--vote-actions-path",
      actionsOutputPath,
    ]);
    await runTreasuryCliWithSqliteFixtures([
      "vote-reducer",
      "prove-run-batch",
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
      uri: join(SQLITE_FIXTURE_DIRECTORY, `${proofLifecycleId}.sqlite`),
    });
    const proofStorage = createSqliteVoteReducerProofStorage(
      proofLifecycleId,
      proofStore,
    );

    let mergedProofFile: { publicInput?: unknown; publicOutput?: unknown };
    try {
      const baseProofCount = await proofStorage.count();
      const mergeProofCount = await proofStorage.mergeCount();
      const baseProof = await proofStorage.getProof("0");
      assert(baseProof, "expected vote-reducer base proof with id 0 after prove-run-batch");
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
