import { createInMemoryTransactionSigner } from "@repo/sdk/src/services/transaction-signing.js";
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import { BOND_AMOUNT_DIVISOR } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { type ProposalVote } from "@repo/sdk/src/services/treasury-owner-service.js";
import {
  ARCHIVE_NODE_URL,
  getCurrentGlobalSlot,
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
import {
  loadPreparedLightnetFixture,
  prepareVotingLedgerForLifecycle,
  selectPreparedProposalLifecycle,
  type PreparedLightnetFixture,
  validatePreparedLightnetFixture,
} from "./utils/prepared-lightnet-fixture.js";

const TEST_NAME = "proposal-tally-votes.test";
const CACHE_PATH = fileURLToPath(new URL("../cache", import.meta.url));

const VOTES_TO_CAST = 5;
const PROPOSAL_ZKAPP_URI =
  "https://example.com/proposals/cli-manual-vote-reducer";
const PROPOSAL_AMOUNT = UInt64.from("10000000000");
const TX_FEE = UInt64.from(1_000_000_000);
const PROPOSAL_AMOUNT_WITH_BOND = PROPOSAL_AMOUNT.add(
  PROPOSAL_AMOUNT.div(BOND_AMOUNT_DIVISOR),
);

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

async function fetchAccountBalanceNanomina(
  publicKeyBase58: string,
): Promise<bigint> {
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

describe(
  "proposal tally votes prep",
  {
    concurrency: 1,
    skip: !process.env.LIGHTNET_FIXTURE_MANIFEST_PATH,
  },
  () => {
    let fixture: PreparedLightnetFixture;
    let runDirectory: string;
    let originalSqliteDataDirectory: string | undefined;
    let originalProofsEnabled: string | undefined;
    let originalNetworkId: string | undefined;
    let originalMinaNodeUrl: string | undefined;
    let originalArchiveNodeUrl: string | undefined;
    let originalAccountManagerUrl: string | undefined;

    before(async () => {
      fixture = await loadPreparedLightnetFixture();
      await validatePreparedLightnetFixture(fixture);
      runDirectory = await mkdtemp(join(tmpdir(), "proposal-tally-votes-"));
      originalSqliteDataDirectory = process.env.SQLITE_DATA_DIRECTORY;
      originalProofsEnabled = process.env.PROOFS_ENABLED;
      originalNetworkId = process.env.NETWORK;
      originalMinaNodeUrl = process.env.MINA_NODE_URL;
      originalArchiveNodeUrl = process.env.ARCHIVE_NODE_URL;
      originalAccountManagerUrl = process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT;
      process.env.PROOFS_ENABLED = String(fixture.proofsEnabled);
      process.env.NETWORK = fixture.networkId;
      process.env.MINA_NODE_URL = fixture.minaNodeUrl;
      process.env.ARCHIVE_NODE_URL = fixture.archiveNodeUrl;
      process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT = fixture.accountManagerUrl;
    });

    after(() => {
      if (originalSqliteDataDirectory === undefined) {
        delete process.env.SQLITE_DATA_DIRECTORY;
      } else {
        process.env.SQLITE_DATA_DIRECTORY = originalSqliteDataDirectory;
      }
      if (originalProofsEnabled === undefined)
        delete process.env.PROOFS_ENABLED;
      else process.env.PROOFS_ENABLED = originalProofsEnabled;
      if (originalNetworkId === undefined) delete process.env.NETWORK;
      else process.env.NETWORK = originalNetworkId;
      if (originalMinaNodeUrl === undefined) delete process.env.MINA_NODE_URL;
      else process.env.MINA_NODE_URL = originalMinaNodeUrl;
      if (originalArchiveNodeUrl === undefined)
        delete process.env.ARCHIVE_NODE_URL;
      else process.env.ARCHIVE_NODE_URL = originalArchiveNodeUrl;
      if (originalAccountManagerUrl === undefined) {
        delete process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT;
      } else {
        process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT =
          originalAccountManagerUrl;
      }
    });

    it("reuses a prepared treasury and sends 5 snapshot-backed votes", async () => {
      const lifecycle = await selectPreparedProposalLifecycle(fixture, {
        minimumRemainingSlots: Math.ceil(
          fixture.lifecyclePeriodDurationSlots / 2,
        ),
      });
      const proposalLifecycleId = UInt32.from(lifecycle.lifecycleId);
      const proofLifecycleId = String(lifecycle.lifecycleId);
      const { sqliteDataDirectory, sqliteDbPath } =
        await prepareVotingLedgerForLifecycle(
          fixture,
          proofLifecycleId,
          runDirectory,
        );
      process.env.SQLITE_DATA_DIRECTORY = sqliteDataDirectory;
      const voteActionsOutputPath = join(runDirectory, "proposal-actions.json");
      const voteReducerMergedProofPath = join(
        runDirectory,
        "vote-reducer-merge.json",
      );
      const prepStatePath = join(
        runDirectory,
        "proposal-tally-votes-state.json",
      );
      logTestStep(TEST_NAME, "prepared the run-scoped voting ledger", {
        sourcePath: fixture.votingLedgerSqlitePath,
        destinationPath: sqliteDbPath,
        lifecycleId: proofLifecycleId,
      });

      const selectedVoters = fixture.voters.slice(0, VOTES_TO_CAST);
      const voterPrivateKeys = selectedVoters.map(({ privateKey }) =>
        PrivateKey.fromBase58(privateKey),
      );
      const senderPrivateKey = voterPrivateKeys[0];
      assert(senderPrivateKey);
      const treasuryOwnerPublicKey = PublicKey.fromBase58(
        fixture.ownerPublicKey,
      );
      const service = new SqliteTreasuryOwnerService();
      const lifecyclePeriodDuration = UInt32.from(
        fixture.lifecyclePeriodDurationSlots,
      );
      logTestStep(TEST_NAME, "compiling treasury owner service artifacts", {
        proofsEnabled: fixture.proofsEnabled,
        lifecyclePeriodDuration: lifecyclePeriodDuration.toString(),
        cachePath: CACHE_PATH,
      });
      await service.compile({
        proofsEnabled: fixture.proofsEnabled,
        lifecyclePeriodDuration,
        cachePath: CACHE_PATH,
      });
      await validatePreparedLightnetFixture(fixture);

      const proposalPrivateKey = PrivateKey.random();
      const proposalPublicKey = proposalPrivateKey.toPublicKey();
      const recipientPublicKey = PrivateKey.random().toPublicKey();
      logTestStep(TEST_NAME, "creating proposal in prepared lifecycle", {
        treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
        proposalPublicKey: proposalPublicKey.toBase58(),
        proposalLifecycleId: proposalLifecycleId.toString(),
        recipientPublicKey: recipientPublicKey.toBase58(),
        amount: PROPOSAL_AMOUNT.toString(),
      });
      const createResult = await service.createProposal({
        ...(await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
          proofLifecycleId,
          treasuryOwnerPublicKey,
        )),
        minaNodeUrl: MINA_NODE_URL,
        senderPublicKey: senderPrivateKey.toPublicKey(),
        treasuryOwnerPublicKey,
        proposalPublicKey: proposalPrivateKey.toPublicKey(),
        proposalLifecycleId,
        recipientPublicKey,
        amount: PROPOSAL_AMOUNT,
        proposalZkappUri: PROPOSAL_ZKAPP_URI,
        fee: TX_FEE,
        wait: true,
        transactionSigner: createInMemoryTransactionSigner([
          senderPrivateKey,
          proposalPrivateKey,
        ]),
      });
      assert.strictEqual(
        createResult.proposalAddress,
        proposalPublicKey.toBase58(),
      );

      const votePhaseStartSlot =
        lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 2;
      const slotBeforeVotes = await getCurrentGlobalSlot();
      if (slotBeforeVotes < votePhaseStartSlot) {
        await waitForSlotWithPollingLogs(
          "waiting for vote phase",
          votePhaseStartSlot,
        );
      }

      const sentVoteActions: Array<{
        index: number;
        vote: ProposalVote;
        voterPublicKey: string;
        voteTxHash?: string;
      }> = [];

      for (let index = 0; index < selectedVoters.length; index += 1) {
        const fixtureVoter = selectedVoters[index]!;
        const voterPrivateKey = voterPrivateKeys[index];
        assert(voterPrivateKey);
        const voterPublicKey = voterPrivateKey.toPublicKey().toBase58();
        const vote: ProposalVote = fixtureVoter.vote;
        logTestStep(TEST_NAME, "casting vote", {
          index: index + 1,
          voterPublicKey,
          vote,
        });

        const voteResult = await service.voteProposal({
          minaNodeUrl: MINA_NODE_URL,
          senderPublicKey: voterPrivateKey.toPublicKey(),
          treasuryOwnerPublicKey,
          proposalPublicKey,
          voterPublicKey: voterPrivateKey.toPublicKey(),
          vote,
          fee: TX_FEE,
          wait: true,
          transactionSigner: createInMemoryTransactionSigner([voterPrivateKey]),
        });
        assert.strictEqual(
          voteResult.proposalAddress,
          proposalPublicKey.toBase58(),
        );
        assert(voteResult.voteTxHash, "expected vote transaction hash");

        sentVoteActions.push({
          index: index + 1,
          vote,
          voterPublicKey,
          voteTxHash: voteResult.voteTxHash,
        });

        if (index < selectedVoters.length - 1) {
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
        outputPath: voteActionsOutputPath,
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
            voteActionsOutputPath,
          ],
          {
            timeoutMs: 120_000,
            streamOutput: true,
            streamLabel: "proposal fetch-actions test",
          },
        );
        const parsedResult =
          parseTreasuryProposalActionsResult(fetchActionsOutput);
        fetchActionsResult = parsedResult;
        if (
          parsedResult &&
          parsedResult.proposalPublicKey === proposalPublicKey.toBase58() &&
          parsedResult.count >= selectedVoters.length
        ) {
          break;
        }
        logTestStep(
          TEST_NAME,
          "proposal actions not fully indexed yet, retrying next slot",
          {
            fetchedCount: parsedResult?.count,
            expectedCount: selectedVoters.length,
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
        selectedVoters.length,
        "expected fetched proposal actions count to match sent votes",
      );

      logTestStep(
        TEST_NAME,
        "running vote-reducer trace-run-batch CLI command",
        {
          lifecycleId: proofLifecycleId,
          voteActionsPath: voteActionsOutputPath,
        },
      );
      await runCli(
        [
          "vote-reducer",
          "trace-run-batch",
          "--staking-ledger-to-voting-ledger-proof-path",
          fixture.exhaustedProofPath,
          "--treasury-owner-public-key",
          treasuryOwnerPublicKey.toBase58(),
          "--lifecycle-id",
          proofLifecycleId,
          "--vote-actions-path",
          voteActionsOutputPath,
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
        logTestStep(
          TEST_NAME,
          "running vote-reducer prove-run-batch CLI command",
          {
            lifecycleId: proofLifecycleId,
            queueName,
            redisHost,
            redisPort,
          },
        );
        await runCli(
          [
            "vote-reducer",
            "prove-run-batch",
            "--vote-actions-path",
            voteActionsOutputPath,
            "--lifecycle-id",
            proofLifecycleId,
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
          lifecycleId: proofLifecycleId,
          queueName,
          outputPath: voteReducerMergedProofPath,
        });
        await runCli(
          [
            "vote-reducer",
            "prove-merge",
            "--vote-actions-path",
            voteActionsOutputPath,
            "--lifecycle-id",
            proofLifecycleId,
            "--queue-name",
            queueName,
            "--redis-host",
            redisHost,
            "--redis-port",
            String(redisPort),
            "--proof-output-path",
            voteReducerMergedProofPath,
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
        await readFile(voteReducerMergedProofPath, "utf8"),
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
      JSON.parse(await readFile(fixture.exhaustedProofPath, "utf8")) as unknown;

      const cooldownStartSlot =
        lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 3;
      const slotBeforeTally = await getCurrentGlobalSlot();
      if (slotBeforeTally < cooldownStartSlot) {
        await waitForSlotWithPollingLogs(
          "waiting for cooldown phase",
          cooldownStartSlot,
          (cooldownStartSlot - slotBeforeTally) * fixture.slotDurationMs +
            120_000,
        );
      }

      logTestStep(TEST_NAME, "running proposal tally-votes CLI command", {
        lifecycleId: proofLifecycleId,
        treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
        proposalPublicKey: proposalPublicKey.toBase58(),
        voteReducerProofPath: voteReducerMergedProofPath,
        stakingLedgerToVotingLedgerProofPath: fixture.exhaustedProofPath,
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
          voteReducerMergedProofPath,
          "--staking-ledger-to-voting-ledger-proof-path",
          fixture.exhaustedProofPath,
          "--lifecycle-id",
          proofLifecycleId,
          "--lifecycle-period-duration",
          String(fixture.lifecyclePeriodDurationSlots),
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
      assert.strictEqual(
        tallyResult.proposalAddress,
        proposalPublicKey.toBase58(),
      );
      assert(tallyResult.tallyTxHash, "expected proposal tally-votes tx hash");

      const executePhaseStartSlot =
        lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 4;
      const slotBeforeExecute = await getCurrentGlobalSlot();
      if (slotBeforeExecute < executePhaseStartSlot) {
        await waitForSlotWithPollingLogs(
          "waiting for execute phase",
          executePhaseStartSlot,
        );
      }

      const recipientPublicKeyBase58 = recipientPublicKey.toBase58();
      const recipientBalanceBeforeExecute = await fetchAccountBalanceNanomina(
        recipientPublicKeyBase58,
      );

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
          String(fixture.lifecyclePeriodDurationSlots),
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
      assert.strictEqual(
        executeResult.proposalAddress,
        proposalPublicKey.toBase58(),
      );
      assert.strictEqual(
        executeResult.recipientPublicKey,
        recipientPublicKeyBase58,
      );
      assert.strictEqual(
        executeResult.amountToPayOut,
        PROPOSAL_AMOUNT_WITH_BOND.toString(),
        "expected execute payout to match configured amount",
      );
      assert(executeResult.executeTxHash, "expected proposal execute tx hash");

      const recipientBalanceAfterExecute = await fetchAccountBalanceNanomina(
        recipientPublicKeyBase58,
      );
      const recipientBalanceDelta =
        recipientBalanceAfterExecute - recipientBalanceBeforeExecute;
      assert.strictEqual(
        recipientBalanceDelta.toString(),
        PROPOSAL_AMOUNT_WITH_BOND.toString(),
        "expected recipient balance delta to match payout amount",
      );

      await writeFile(
        prepStatePath,
        JSON.stringify(
          {
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            proposalPublicKey: proposalPublicKey.toBase58(),
            recipientPublicKey: recipientPublicKeyBase58,
            proposalLifecycleId: proposalLifecycleId.toString(),
            proofLifecycleId: proofLifecycleId,
            lifecyclePeriodDuration: fixture.lifecyclePeriodDurationSlots,
            expectedVoteActions: selectedVoters.length,
            fetchedVoteActionsPath: voteActionsOutputPath,
            voteReducerMergedProofPath: voteReducerMergedProofPath,
            stakingLedgerToVotingLedgerProofPath: fixture.exhaustedProofPath,
            fixtureManifestPath: process.env.LIGHTNET_FIXTURE_MANIFEST_PATH,
            sentVoteActions,
            tallyTxHash: tallyResult.tallyTxHash,
            executeTxHash: executeResult.executeTxHash,
            amountToPayOut: executeResult.amountToPayOut,
            recipientBalanceBeforeExecute:
              recipientBalanceBeforeExecute.toString(),
            recipientBalanceAfterExecute:
              recipientBalanceAfterExecute.toString(),
            recipientBalanceDelta: recipientBalanceDelta.toString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      logTestStep(
        TEST_NAME,
        "done: completed vote-reducer and proposal tally-votes CLI flow",
        {
          treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
          proposalPublicKey: proposalPublicKey.toBase58(),
          preparedVotes: sentVoteActions.length,
          fixtureManifestPath: process.env.LIGHTNET_FIXTURE_MANIFEST_PATH,
          fetchedVoteActionsPath: voteActionsOutputPath,
          voteReducerMergedProofPath: voteReducerMergedProofPath,
          stakingLedgerToVotingLedgerProofPath: fixture.exhaustedProofPath,
          tallyTxHash: tallyResult.tallyTxHash,
          executeTxHash: executeResult.executeTxHash,
          recipientPublicKey: recipientPublicKeyBase58,
          amountToPayOut: executeResult.amountToPayOut,
          recipientBalanceBeforeExecute:
            recipientBalanceBeforeExecute.toString(),
          recipientBalanceAfterExecute: recipientBalanceAfterExecute.toString(),
          recipientBalanceDelta: recipientBalanceDelta.toString(),
          prepStatePath: prepStatePath,
        },
      );
    });
  },
);
