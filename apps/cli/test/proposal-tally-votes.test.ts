import assert from "node:assert";
import { before, describe, it } from "node:test";
import { type ChildProcess } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mina, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import { BOND_AMOUNT_DIVISOR } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { type ProposalVote } from "@repo/sdk/src/services/treasury-owner-service.js";
import {
  ARCHIVE_NODE_URL,
  CLI_PACKAGE_DIRECTORY,
  ensureLightnetReady,
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  logTestStep,
  MINA_NODE_URL,
  parseTreasuryProposalActionsResult,
  parseTreasuryProposalExecuteResult,
  parseTreasuryProposalTallyResult,
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
  waitForGlobalSlot,
} from "./utils/cli-test-utils.js";

const TEST_NAME = "proposal-tally-votes.test";
const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/vote-reducer-lightnet-actions.json", import.meta.url),
);
const STAKING_EPOCH_LEDGER_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/staking-epoch-ledger-lightnet.json", import.meta.url),
);
const PREP_STATE_PATH = fileURLToPath(
  new URL("./fixtures/proposal-tally-votes-state.json", import.meta.url),
);
const VOTE_ACTIONS_OUTPUT_PATH = fileURLToPath(
  new URL("./fixtures/proposal-tally-votes-actions.json", import.meta.url),
);
const VOTE_REDUCER_MERGED_PROOF_PATH = fileURLToPath(
  new URL("./fixtures/proposal-tally-votes-vote-reducer-merge.json", import.meta.url),
);
const STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH = fileURLToPath(
  new URL("../artifacts/exhausted-proof.json", import.meta.url),
);
const READONLY_VOTING_LEDGER_SQLITE_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/0-data-voting-ledger.sqlite", import.meta.url),
);
const CACHE_PATH = fileURLToPath(new URL("../cache", import.meta.url));

const VOTES_TO_CAST = 5;
const PROPOSAL_ZKAPP_URI = "https://example.com/proposals/cli-manual-vote-reducer";
const PROPOSAL_AMOUNT = UInt64.from("1000000000");
const PROPOSAL_LIFECYCLE_ID = UInt32.from(0);
const PROOF_LIFECYCLE_ID = "0";
const LIFECYCLE_PERIOD_DURATION_SLOTS = 240;
const TX_FEE = UInt64.from(1_000_000_000);
const PROPOSAL_AMOUNT_WITH_BOND = PROPOSAL_AMOUNT.add(
  PROPOSAL_AMOUNT.div(BOND_AMOUNT_DIVISOR),
);

// These private keys are the known counterparts of fixture voteActions public keys.
const KNOWN_FIXTURE_VOTER_PRIVATE_KEYS = [
  "EKFGQcsWmQR9Jj1W2XoGNQzF43T1PNqRhaQrm1vDS948GVbyemrj",
  "EKEnVLUhYHDJvgmgQu5SzaV8MWKNfhAXYSkLBRk5KEfudWZRbs4P",
  "EKEXS3qUZRhxDzExtuAaQVHtxLzt8A3fqS7o7iL9NpvdATsshvB6",
  "EKF3qRhoze6r6bgF5uRmhMkEahfZJHHQ3hzxqCbPvaNzdhxMVCQh",
  "EKFd1GxnQ53H3shreTB2VzQJxECz9DE9NjorrkfKyEuKCsHDHVSE",
];
const KNOWN_BIG_STAKE_VOTER_PUBLIC_KEY =
  "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB";
// Known Lightnet account from staking ledger fixture with non-zero balance.
const KNOWN_EXISTING_TREASURY_OWNER_PRIVATE_KEY =
  "EKDpoov2DNs2aBLmm2yZNwLKHDvG42EdwPGaeCTrhm1kaFHc5f1g";

type FixtureVoteAction = {
  vote: string;
  publicKey: string;
};

type VoteReducerActionsFixture = {
  voteActions: FixtureVoteAction[];
};

type StakingEpochLedgerEntry = {
  pk: string;
  balance: string;
};

function fixtureVoteToProposalVote(vote: string): ProposalVote {
  if (vote === "1") return "yay";
  if (vote === "2") return "nay";
  if (vote === "3") return "abstain";
  throw new Error(`Unsupported fixture vote value: ${vote}`);
}

async function waitForSlotWithPollingLogs(
  phaseLabel: string,
  targetSlot: number,
  timeoutMs = 900_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentSlot = await getCurrentGlobalSlot();
    if (currentSlot >= targetSlot) {
      logTestStep(TEST_NAME, `${phaseLabel}: reached`, {
        currentSlot,
        targetSlot,
      });
      return;
    }

    logTestStep(TEST_NAME, `${phaseLabel}: polling`, {
      currentSlot,
      targetSlot,
      remainingSlots: targetSlot - currentSlot,
    });

    await waitForGlobalSlot(currentSlot + 1, 120_000);
  }

  throw new Error(`Timed out waiting for ${phaseLabel} at slot ${targetSlot}`);
}

function resolveSqliteLifecycleDbPath(lifecycleId: string): string {
  const sqliteDataDirectory =
    process.env.SQLITE_DATA_DIRECTORY ?? join(CLI_PACKAGE_DIRECTORY, ".data", "sqlite");
  const resolvedSqliteDataDirectory = isAbsolute(sqliteDataDirectory)
    ? sqliteDataDirectory
    : join(CLI_PACKAGE_DIRECTORY, sqliteDataDirectory);
  return join(resolvedSqliteDataDirectory, `${lifecycleId}.sqlite`);
}

async function fetchAccountBalanceNanomina(publicKeyBase58: string): Promise<bigint> {
  const response = await fetch(MINA_NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query AccountBalance($publicKey: PublicKey!) {
          account(publicKey: $publicKey) {
            balance {
              total
            }
          }
        }
      `,
      variables: {
        publicKey: publicKeyBase58,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch account balance for ${publicKeyBase58}: HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    data?: {
      account?: {
        balance?: {
          total?: string;
        } | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map((error) => error.message)
        .filter((message): message is string => Boolean(message))
        .join("; ") || "Unknown GraphQL error while reading account balance",
    );
  }

  const total = payload.data?.account?.balance?.total;
  return total ? BigInt(total) : 0n;
}

describe("proposal tally votes prep", { concurrency: 1 }, () => {
  let lightnetProcess: ChildProcess | undefined;

  before(async () => {
    logTestStep(
      TEST_NAME,
      "setup: starting Lightnet (left running for manual vote-reducer run)",
    );
    lightnetProcess = await ensureLightnetReady();
    lightnetProcess?.unref();

    Mina.setActiveInstance(
      Mina.Network({
        mina: MINA_NODE_URL,
        lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
      }),
    );
  });

  it("deploys treasury, creates proposal, and sends 5 fixture-ordered votes", async () => {
    assert.strictEqual(
      PROPOSAL_LIFECYCLE_ID.toString(),
      PROOF_LIFECYCLE_ID,
      "expected proposal lifecycle and proof lifecycle IDs to match",
    );
    const sqliteLifecycleDbPath = resolveSqliteLifecycleDbPath(PROOF_LIFECYCLE_ID);
    await mkdir(dirname(sqliteLifecycleDbPath), { recursive: true });
    await copyFile(READONLY_VOTING_LEDGER_SQLITE_FIXTURE_PATH, sqliteLifecycleDbPath);
    logTestStep(
      TEST_NAME,
      "copied readonly voting-ledger sqlite fixture to active lifecycle sqlite db",
      {
        sourcePath: READONLY_VOTING_LEDGER_SQLITE_FIXTURE_PATH,
        destinationPath: sqliteLifecycleDbPath,
        lifecycleId: PROOF_LIFECYCLE_ID,
      },
    );

    await rm(VOTE_ACTIONS_OUTPUT_PATH, { force: true });
    await rm(VOTE_REDUCER_MERGED_PROOF_PATH, { force: true });

    const fixture = JSON.parse(
      await readFile(FIXTURE_PATH, "utf8"),
    ) as VoteReducerActionsFixture;
    assert(
      fixture.voteActions.length >= VOTES_TO_CAST,
      `expected at least ${VOTES_TO_CAST} vote actions in ${FIXTURE_PATH}`,
    );

    const privateKeyByPublicKey = new Map(
      KNOWN_FIXTURE_VOTER_PRIVATE_KEYS.map((privateKeyBase58) => {
        const privateKey = PrivateKey.fromBase58(privateKeyBase58);
        return [privateKey.toPublicKey().toBase58(), privateKeyBase58];
      }),
    );

    const selectedVoteActions = fixture.voteActions.slice(0, VOTES_TO_CAST);
    assert(
      selectedVoteActions.some(
        (voteAction) =>
          voteAction.publicKey === KNOWN_BIG_STAKE_VOTER_PUBLIC_KEY,
      ),
      `expected selected fixture votes to include big stake voter ${KNOWN_BIG_STAKE_VOTER_PUBLIC_KEY}`,
    );
    const voterPrivateKeys = selectedVoteActions.map((voteAction, index) => {
      const privateKeyBase58 = privateKeyByPublicKey.get(voteAction.publicKey);
      assert(
        privateKeyBase58,
        `missing known private key for fixture vote #${index + 1}: ${voteAction.publicKey}`,
      );
      return PrivateKey.fromBase58(privateKeyBase58);
    });

    const treasuryOwnerPrivateKey = PrivateKey.fromBase58(
      KNOWN_EXISTING_TREASURY_OWNER_PRIVATE_KEY,
    );
    const treasuryOwnerPublicKeyBase58 =
      treasuryOwnerPrivateKey.toPublicKey().toBase58();

    const stakingEpochLedger = JSON.parse(
      await readFile(STAKING_EPOCH_LEDGER_FIXTURE_PATH, "utf8"),
    ) as StakingEpochLedgerEntry[];
    const treasuryOwnerLedgerEntry = stakingEpochLedger.find(
      (entry) => entry.pk === treasuryOwnerPublicKeyBase58,
    );
    assert(
      treasuryOwnerLedgerEntry,
      `known treasury owner account must exist in ${STAKING_EPOCH_LEDGER_FIXTURE_PATH}: ${treasuryOwnerPublicKeyBase58}`,
    );
    assert(
      BigInt(treasuryOwnerLedgerEntry.balance) > 0n,
      `known treasury owner account must have non-zero balance in ${STAKING_EPOCH_LEDGER_FIXTURE_PATH}: ${treasuryOwnerPublicKeyBase58}`,
    );

    const senderPrivateKey = voterPrivateKeys[0];
    const senderPublicKeyBase58 = senderPrivateKey.toPublicKey().toBase58();
    assert.notStrictEqual(
      treasuryOwnerPublicKeyBase58,
      senderPublicKeyBase58,
      "treasury owner deploy account must not reuse sender account",
    );
    for (const voterPrivateKey of voterPrivateKeys) {
      assert.notStrictEqual(
        treasuryOwnerPublicKeyBase58,
        voterPrivateKey.toPublicKey().toBase58(),
        "treasury owner deploy account must not reuse any voter account",
      );
    }

    const service = new SqliteTreasuryOwnerService();
    const lifecyclePeriodDuration = UInt32.from(LIFECYCLE_PERIOD_DURATION_SLOTS);
    logTestStep(TEST_NAME, "compiling treasury owner service artifacts", {
      proofsEnabled: false,
      lifecyclePeriodDuration: lifecyclePeriodDuration.toString(),
      cachePath: CACHE_PATH,
    });
    await service.compile({
      proofsEnabled: false,
      lifecyclePeriodDuration,
      cachePath: CACHE_PATH,
    });

    const pauseControllerPrivateKey = PrivateKey.random();
    const multisigParticipantsPublicKeys = Array.from({ length: 5 }, () =>
      PrivateKey.random().toPublicKey(),
    );

    const currentSlot = await getCurrentGlobalSlot();
    // Proposal period for lifecycle 0 should be active immediately after deploy.
    const treasuryDeployedAtSlot = currentSlot;

    logTestStep(TEST_NAME, "deploying treasury owner", {
      treasuryOwnerPublicKey: treasuryOwnerPrivateKey.toPublicKey().toBase58(),
      pauseControllerPublicKey: pauseControllerPrivateKey.toPublicKey().toBase58(),
      treasuryDeployedAtSlot,
      lifecyclePeriodDurationSlots: LIFECYCLE_PERIOD_DURATION_SLOTS,
      allowDeployToExistingAccount: true,
      stakingEpochLedgerFixturePath: STAKING_EPOCH_LEDGER_FIXTURE_PATH,
      treasuryOwnerLedgerBalance: treasuryOwnerLedgerEntry.balance,
    });
    const deployResult = await service.deploy({
      minaNodeUrl: MINA_NODE_URL,
      senderPrivateKey,
      treasuryOwnerPrivateKey,
      pauseControllerPrivateKey,
      treasuryDeployedAtSlot: UInt32.from(treasuryDeployedAtSlot),
      multisigParticipantsPublicKeys,
      allowDeployToExistingAccount: true,
      fee: TX_FEE,
      wait: true,
    });
    const treasuryOwnerPublicKey = PublicKey.fromBase58(
      deployResult.treasuryOwnerAddress,
    );

    const proposalPrivateKey = PrivateKey.random();
    const proposalPublicKey = proposalPrivateKey.toPublicKey();
    const recipientPublicKey = PrivateKey.random().toPublicKey();
    logTestStep(TEST_NAME, "creating proposal in lifecycle 0", {
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      proposalLifecycleId: PROPOSAL_LIFECYCLE_ID.toString(),
      recipientPublicKey: recipientPublicKey.toBase58(),
      amount: PROPOSAL_AMOUNT.toString(),
    });
    const createResult = await service.createProposal({
      minaNodeUrl: MINA_NODE_URL,
      senderPrivateKey,
      treasuryOwnerPublicKey,
      proposalPrivateKey,
      proposalLifecycleId: PROPOSAL_LIFECYCLE_ID,
      recipientPublicKey,
      amount: PROPOSAL_AMOUNT,
      proposalZkappUri: PROPOSAL_ZKAPP_URI,
      fee: TX_FEE,
      wait: true,
    });
    assert.strictEqual(createResult.proposalAddress, proposalPublicKey.toBase58());

    const votePhaseStartSlot =
      treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION_SLOTS * 2;
    const slotBeforeVotes = await getCurrentGlobalSlot();
    if (slotBeforeVotes < votePhaseStartSlot) {
      await waitForSlotWithPollingLogs("waiting for vote phase", votePhaseStartSlot);
    }

    const sentVoteActions: Array<{
      index: number;
      vote: ProposalVote;
      voterPublicKey: string;
      voteTxHash?: string;
    }> = [];

    for (let index = 0; index < selectedVoteActions.length; index += 1) {
      const fixtureVoteAction = selectedVoteActions[index];
      const voterPrivateKey = voterPrivateKeys[index];
      const voterPublicKey = voterPrivateKey.toPublicKey().toBase58();
      assert.strictEqual(
        voterPublicKey,
        fixtureVoteAction.publicKey,
        `fixture voter #${index + 1} public key mismatch`,
      );

      const vote = fixtureVoteToProposalVote(fixtureVoteAction.vote);
      logTestStep(TEST_NAME, "casting vote", {
        index: index + 1,
        voterPublicKey,
        vote,
      });

      const voteResult = await service.voteProposal({
        minaNodeUrl: MINA_NODE_URL,
        senderPrivateKey: voterPrivateKey,
        treasuryOwnerPublicKey,
        proposalPublicKey,
        voterPrivateKey,
        vote,
        fee: TX_FEE,
        wait: true,
      });
      assert.strictEqual(voteResult.proposalAddress, proposalPublicKey.toBase58());
      assert(voteResult.voteTxHash, "expected vote transaction hash");

      sentVoteActions.push({
        index: index + 1,
        vote,
        voterPublicKey,
        voteTxHash: voteResult.voteTxHash,
      });

      if (index < selectedVoteActions.length - 1) {
        const currentVoteSlot = await getCurrentGlobalSlot();
        await waitForSlotWithPollingLogs(
          `waiting one block after vote ${index + 1}`,
          currentVoteSlot + 1,
          120_000,
        );
      }
    }

    const postVotesSlot = await getCurrentGlobalSlot();
    await waitForSlotWithPollingLogs(
      "waiting one block after final vote",
      postVotesSlot + 1,
      120_000,
    );

    logTestStep(TEST_NAME, "fetching proposal actions via CLI", {
      archiveNodeUrl: ARCHIVE_NODE_URL,
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      outputPath: VOTE_ACTIONS_OUTPUT_PATH,
    });
    let fetchActionsResult:
      | ReturnType<typeof parseTreasuryProposalActionsResult>
      | undefined;
    const fetchActionsStartedAt = Date.now();
    while (Date.now() - fetchActionsStartedAt < 180_000) {
      const fetchActionsOutput = await runCli(
        [
          "proposal",
          "fetch-actions",
          "--archive-node-url",
          ARCHIVE_NODE_URL,
          "--treasury-owner-public-key",
          treasuryOwnerPublicKey.toBase58(),
          "--proposal-public-key",
          proposalPublicKey.toBase58(),
          "--output-path",
          VOTE_ACTIONS_OUTPUT_PATH,
        ],
        {
          timeoutMs: 120_000,
          streamOutput: true,
          streamLabel: "proposal fetch-actions test",
        },
      );
      const parsedResult = parseTreasuryProposalActionsResult(fetchActionsOutput);
      fetchActionsResult = parsedResult;
      if (
        parsedResult &&
        parsedResult.proposalPublicKey === proposalPublicKey.toBase58() &&
        parsedResult.count >= selectedVoteActions.length
      ) {
        break;
      }
      logTestStep(
        TEST_NAME,
        "proposal actions not fully indexed yet, retrying next slot",
        {
          fetchedCount: parsedResult?.count,
          expectedCount: selectedVoteActions.length,
        },
      );
      const retrySlot = await getCurrentGlobalSlot();
      await waitForSlotWithPollingLogs(
        "waiting before proposal fetch-actions retry",
        retrySlot + 1,
        120_000,
      );
    }
    assert(fetchActionsResult, "expected proposal fetch-actions JSON output");
    assert.strictEqual(
      fetchActionsResult.proposalPublicKey,
      proposalPublicKey.toBase58(),
    );
    assert.strictEqual(
      fetchActionsResult.count,
      selectedVoteActions.length,
      "expected fetched proposal actions count to match sent votes",
    );

    logTestStep(TEST_NAME, "running vote-reducer trace-run-batch CLI command", {
      lifecycleId: PROOF_LIFECYCLE_ID,
      voteActionsPath: VOTE_ACTIONS_OUTPUT_PATH,
    });
    await runCli(
      [
        "vote-reducer",
        "trace-run-batch",
        "--lifecycle-id",
        PROOF_LIFECYCLE_ID,
        "--vote-actions-path",
        VOTE_ACTIONS_OUTPUT_PATH,
      ],
      {
        timeoutMs: 600_000,
        streamOutput: true,
        streamLabel: "vote-reducer trace-run-batch test",
      },
    );

    const redisServer = new RedisMemoryServer();
    const redisHost = await redisServer.getHost();
    const redisPort = await redisServer.getPort();
    const queueName = `proposal-tally-votes-${Date.now()}-queue`;
    const workerProcess = spawnCliWorker(queueName, {
      redisHost,
      redisPort,
      stdio: "inherit",
    });
    await sleep(400);
    try {
      logTestStep(TEST_NAME, "running vote-reducer prove-run-batch CLI command", {
        lifecycleId: PROOF_LIFECYCLE_ID,
        queueName,
        redisHost,
        redisPort,
      });
      await runCli(
        [
          "vote-reducer",
          "prove-run-batch",
          "--lifecycle-id",
          PROOF_LIFECYCLE_ID,
          "--queue-name",
          queueName,
          "--redis-host",
          redisHost,
          "--redis-port",
          String(redisPort),
        ],
        {
          timeoutMs: 900_000,
          streamOutput: true,
          streamLabel: "vote-reducer prove-run-batch test",
        },
      );

      logTestStep(TEST_NAME, "running vote-reducer prove-merge CLI command", {
        lifecycleId: PROOF_LIFECYCLE_ID,
        queueName,
        outputPath: VOTE_REDUCER_MERGED_PROOF_PATH,
      });
      await runCli(
        [
          "vote-reducer",
          "prove-merge",
          "--lifecycle-id",
          PROOF_LIFECYCLE_ID,
          "--queue-name",
          queueName,
          "--redis-host",
          redisHost,
          "--redis-port",
          String(redisPort),
          "--proof-output-path",
          VOTE_REDUCER_MERGED_PROOF_PATH,
        ],
        {
          timeoutMs: 900_000,
          streamOutput: true,
          streamLabel: "vote-reducer prove-merge test",
        },
      );
    } finally {
      workerProcess.kill("SIGTERM");
      await waitForExit(workerProcess, 5_000).catch(() => undefined);
      await redisServer.stop();
    }

    const mergedProof = JSON.parse(
      await readFile(VOTE_REDUCER_MERGED_PROOF_PATH, "utf8"),
    ) as { publicInput?: unknown; publicOutput?: unknown };
    assert(
      mergedProof.publicInput,
      "expected vote-reducer merged proof JSON to contain publicInput",
    );
    assert(
      mergedProof.publicOutput,
      "expected vote-reducer merged proof JSON to contain publicOutput",
    );

    // Ensure the referenced staking-ledger-to-voting-ledger proof is present before tally.
    JSON.parse(
      await readFile(STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH, "utf8"),
    ) as unknown;

    logTestStep(TEST_NAME, "running proposal tally-votes CLI command", {
      lifecycleId: PROOF_LIFECYCLE_ID,
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      voteReducerProofPath: VOTE_REDUCER_MERGED_PROOF_PATH,
      stakingLedgerToVotingLedgerProofPath: STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH,
    });
    const tallyOutput = await runCli(
      [
        "proposal",
        "tally-votes",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--treasury-owner-public-key",
        treasuryOwnerPublicKey.toBase58(),
        "--proposal-public-key",
        proposalPublicKey.toBase58(),
        "--vote-reducer-proof-path",
        VOTE_REDUCER_MERGED_PROOF_PATH,
        "--staking-ledger-to-voting-ledger-proof-path",
        STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH,
        "--lifecycle-id",
        PROOF_LIFECYCLE_ID,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION_SLOTS),
        "--fee",
        TX_FEE.toString(),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "proposal tally-votes test",
      },
    );
    const tallyResult = parseTreasuryProposalTallyResult(tallyOutput);
    assert(tallyResult, "expected proposal tally-votes JSON output");
    assert.strictEqual(tallyResult.proposalAddress, proposalPublicKey.toBase58());
    assert(tallyResult.tallyTxHash, "expected proposal tally-votes tx hash");

    const executePhaseStartSlot =
      treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION_SLOTS * 4;
    const slotBeforeExecute = await getCurrentGlobalSlot();
    if (slotBeforeExecute < executePhaseStartSlot) {
      await waitForSlotWithPollingLogs(
        "waiting for execute phase",
        executePhaseStartSlot,
      );
    }

    const recipientPublicKeyBase58 = recipientPublicKey.toBase58();
    const recipientBalanceBeforeExecute =
      await fetchAccountBalanceNanomina(recipientPublicKeyBase58);

    logTestStep(TEST_NAME, "running proposal execute CLI command", {
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      recipientPublicKey: recipientPublicKeyBase58,
      expectedAmountToPayOut: PROPOSAL_AMOUNT_WITH_BOND.toString(),
    });
    const executeOutput = await runCli(
      [
        "proposal",
        "execute",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--treasury-owner-public-key",
        treasuryOwnerPublicKey.toBase58(),
        "--proposal-public-key",
        proposalPublicKey.toBase58(),
        "--recipient-public-key",
        recipientPublicKeyBase58,
        "--amount-to-pay-out",
        PROPOSAL_AMOUNT_WITH_BOND.toString(),
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION_SLOTS),
        "--fee",
        TX_FEE.toString(),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "proposal execute test",
      },
    );
    const executeResult = parseTreasuryProposalExecuteResult(executeOutput);
    assert(executeResult, "expected proposal execute JSON output");
    assert.strictEqual(executeResult.proposalAddress, proposalPublicKey.toBase58());
    assert.strictEqual(executeResult.recipientPublicKey, recipientPublicKeyBase58);
    assert.strictEqual(
      executeResult.amountToPayOut,
      PROPOSAL_AMOUNT_WITH_BOND.toString(),
      "expected execute payout to match configured amount",
    );
    assert(executeResult.executeTxHash, "expected proposal execute tx hash");

    const recipientBalanceAfterExecute =
      await fetchAccountBalanceNanomina(recipientPublicKeyBase58);
    const recipientBalanceDelta =
      recipientBalanceAfterExecute - recipientBalanceBeforeExecute;
    assert.strictEqual(
      recipientBalanceDelta.toString(),
      PROPOSAL_AMOUNT_WITH_BOND.toString(),
      "expected recipient balance delta to match payout amount",
    );

    await writeFile(
      PREP_STATE_PATH,
      JSON.stringify(
        {
          treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
          proposalPublicKey: proposalPublicKey.toBase58(),
          recipientPublicKey: recipientPublicKeyBase58,
          proposalLifecycleId: PROPOSAL_LIFECYCLE_ID.toString(),
          proofLifecycleId: PROOF_LIFECYCLE_ID,
          lifecyclePeriodDuration: LIFECYCLE_PERIOD_DURATION_SLOTS,
          expectedVoteActions: selectedVoteActions.length,
          fetchedVoteActionsPath: VOTE_ACTIONS_OUTPUT_PATH,
          voteReducerMergedProofPath: VOTE_REDUCER_MERGED_PROOF_PATH,
          stakingLedgerToVotingLedgerProofPath:
            STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH,
          voteActionsFixturePath: FIXTURE_PATH,
          sentVoteActions,
          tallyTxHash: tallyResult.tallyTxHash,
          executeTxHash: executeResult.executeTxHash,
          amountToPayOut: executeResult.amountToPayOut,
          recipientBalanceBeforeExecute:
            recipientBalanceBeforeExecute.toString(),
          recipientBalanceAfterExecute: recipientBalanceAfterExecute.toString(),
          recipientBalanceDelta: recipientBalanceDelta.toString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    logTestStep(TEST_NAME, "done: completed vote-reducer and proposal tally-votes CLI flow", {
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      preparedVotes: sentVoteActions.length,
      voteActionsFixturePath: FIXTURE_PATH,
      fetchedVoteActionsPath: VOTE_ACTIONS_OUTPUT_PATH,
      voteReducerMergedProofPath: VOTE_REDUCER_MERGED_PROOF_PATH,
      stakingLedgerToVotingLedgerProofPath:
        STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH,
      tallyTxHash: tallyResult.tallyTxHash,
      executeTxHash: executeResult.executeTxHash,
      recipientPublicKey: recipientPublicKeyBase58,
      amountToPayOut: executeResult.amountToPayOut,
      recipientBalanceBeforeExecute: recipientBalanceBeforeExecute.toString(),
      recipientBalanceAfterExecute: recipientBalanceAfterExecute.toString(),
      recipientBalanceDelta: recipientBalanceDelta.toString(),
      prepStatePath: PREP_STATE_PATH,
    });
  });
});
