import assert from "node:assert";
import { it } from "node:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RedisMemoryServer } from "redis-memory-server";
import { KeyvSqlite } from "@keyv/sqlite";
import { Reducer, UInt64 } from "o1js";
import { VoteAction } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { getVoteReducerScope, SqliteVoteReducerService } from "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import type { VoteReducerActionStateHistoryTargetSnapshot } from "@repo/sdk/src/services/vote-reducer-types.js";
import { VotingAccount } from "@repo/sdk/src/provable/voting-account.js";
import { createSqliteVoteReducerProofStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { createSqliteNullifierLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { runCli, sleep, spawnCliWorker, waitForExit } from "./utils/cli-test-utils.js";

const FIXTURES_DIRECTORY = fileURLToPath(new URL("./fixtures", import.meta.url));
const SQLITE_FIXTURE_DIRECTORY = join(FIXTURES_DIRECTORY, ".data", "sqlite");

const runSdkCli = (args: string[]) =>
  runCli(args, {
    envOverrides: {
      SQLITE_DATA_DIRECTORY: SQLITE_FIXTURE_DIRECTORY,
    },
  });

function assertVoteReducerProofMatchesExpectedActionHistory(
  proofLabel: string,
  proofFile: { publicInput?: unknown; publicOutput?: unknown },
  actionStateHistoryTarget: VoteReducerActionStateHistoryTargetSnapshot,
) {
  assert(proofFile.publicInput, `expected ${proofLabel} to contain publicInput`);
  assert(proofFile.publicOutput, `expected ${proofLabel} to contain publicOutput`);
  assert(Array.isArray(proofFile.publicInput), `expected ${proofLabel} publicInput array`);
  assert(Array.isArray(proofFile.publicOutput), `expected ${proofLabel} publicOutput array`);

  const publicInput = proofFile.publicInput as unknown[];
  const publicOutput = proofFile.publicOutput as unknown[];

  assert.strictEqual(
    publicInput[0],
    Reducer.initialActionState.toString(),
    `expected ${proofLabel} publicInput[0] to be Reducer.initialActionState`,
  );
  assert.deepStrictEqual(
    publicInput.slice(3, 8),
    [
      actionStateHistoryTarget.actionStateOne,
      actionStateHistoryTarget.actionStateTwo,
      actionStateHistoryTarget.actionStateThree,
      actionStateHistoryTarget.actionStateFour,
      actionStateHistoryTarget.actionStateFive,
    ],
    `expected ${proofLabel} publicInput to preserve action-state history target order`,
  );
  assert.strictEqual(
    publicOutput[0],
    publicOutput[5],
    `expected ${proofLabel} toActionsHash to match actionStateOne.hash`,
  );
  assert.strictEqual(
    publicOutput[6],
    "1",
    `expected ${proofLabel} actionStateOne.found to be true`,
  );
}

it("exposes vote-reducer commands in help", async () => {
  const rootHelp = await runCli(["--help"]);
  assert(
    rootHelp.includes("vote-reducer"),
    "expected root help to list vote-reducer command",
  );

  const voteReducerHelp = await runCli(["vote-reducer", "--help"]);
  assert(
    voteReducerHelp.includes("compile"),
    "expected vote-reducer help to list compile subcommand",
  );
  assert(
    voteReducerHelp.includes("trace-run-batch"),
    "expected vote-reducer help to list trace-run-batch subcommand",
  );
  assert(
    voteReducerHelp.includes("prove-run-batch"),
    "expected vote-reducer help to list prove-run-batch subcommand",
  );
  assert(
    voteReducerHelp.includes("prove-merge"),
    "expected vote-reducer help to list prove-merge subcommand",
  );
  assert(
    voteReducerHelp.includes("clear-state"),
    "expected vote-reducer help to list clear-state subcommand",
  );
});

it("clears vote-reducer dependencies while preserving voting ledger", async () => {
  const lifecycleId = "cli-vote-reducer-clear-state";
  const voteActionsPath = join(FIXTURES_DIRECTORY, "vote-reducer-lightnet-actions.json");
  const scopeId = getVoteReducerScope({ lifecycleId, ...JSON.parse(await readFile(voteActionsPath, "utf8")) });
  const dbPath = join(SQLITE_FIXTURE_DIRECTORY, `${lifecycleId}.sqlite`);
  await mkdir(SQLITE_FIXTURE_DIRECTORY, { recursive: true });
  await rm(dbPath, { force: true });

  const sqliteStore = new KeyvSqlite({ uri: dbPath });
  const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(
    scopeId,
    sqliteStore,
  );
  const votingLedgerStorage = createSqliteVotingLedgerStorage(
    lifecycleId,
    sqliteStore,
  );

  try {
    await nullifierLedgerStorage.nullifierStorage.setNullifier(
      "B62qtest-nullifier-key",
      true,
    );
    await votingLedgerStorage.votingAccountStorage.setVotingAccount(
      "B62qtest-voting-key",
      new VotingAccount({ balance: UInt64.from(42) }),
    );
  } finally {
    await nullifierLedgerStorage.nullifierStorage.close();
    await nullifierLedgerStorage.merkleTreeStorage.close();
    await votingLedgerStorage.votingAccountStorage.close();
    await votingLedgerStorage.merkleTreeStorage.close();
    await sqliteStore.disconnect();
  }

  await runSdkCli([
    "vote-reducer",
    "clear-state",
    "--lifecycle-id",
    lifecycleId,
    "--vote-actions-path",
    voteActionsPath,
  ]);

  const verifyStore = new KeyvSqlite({ uri: dbPath });
  const verifyNullifierLedgerStorage = createSqliteNullifierLedgerStorage(
    scopeId,
    verifyStore,
  );
  const verifyVotingLedgerStorage = createSqliteVotingLedgerStorage(
    lifecycleId,
    verifyStore,
  );
  try {
    const nullifier = await verifyNullifierLedgerStorage.nullifierStorage.getNullifier(
      "B62qtest-nullifier-key",
    );
    assert.strictEqual(
      nullifier,
      undefined,
      "expected nullifier state to be cleared by vote-reducer clear-state",
    );
    const votingAccount =
      await verifyVotingLedgerStorage.votingAccountStorage.getVotingAccount(
        "B62qtest-voting-key",
      );
    assert(votingAccount, "expected voting account to be preserved after clear-state");
    assert.strictEqual(votingAccount.balance.toString(), "42");
  } finally {
    await verifyNullifierLedgerStorage.nullifierStorage.close();
    await verifyNullifierLedgerStorage.merkleTreeStorage.close();
    await verifyVotingLedgerStorage.votingAccountStorage.close();
    await verifyVotingLedgerStorage.merkleTreeStorage.close();
    await verifyStore.disconnect();
  }
});

it("runs vote-reducer cli flow end-to-end with Lightnet action-state snapshot ordering", { concurrency: false }, async () => {
  const lifecycleId = "cli-vote-reducer-lightnet-actions";
  const queueName = `${lifecycleId}-queue`;
  const dbPath = join(SQLITE_FIXTURE_DIRECTORY, `${lifecycleId}.sqlite`);
  const voteActionsPath = join(
    FIXTURES_DIRECTORY,
    "vote-reducer-lightnet-actions.json",
  );
  const mergedProofPath = join(
    FIXTURES_DIRECTORY,
    "vote-reducer-cli-test-merged-proof.json",
  );
  await mkdir(SQLITE_FIXTURE_DIRECTORY, { recursive: true });
  await rm(dbPath, { force: true });
  await rm(mergedProofPath, { force: true });
  const voteActionsPayload = JSON.parse(await readFile(voteActionsPath, "utf8")) as {
    proposalPublicKey: string;
    proposalTokenId: string;
    actionStateHistoryTarget?: VoteReducerActionStateHistoryTargetSnapshot;
    voteActions?: Record<string, unknown>[];
  };
  assert(
    voteActionsPayload.actionStateHistoryTarget,
    "expected vote-reducer Lightnet fixture to include actionStateHistoryTarget",
  );
  assert(
    Array.isArray(voteActionsPayload.voteActions),
    "expected vote-reducer Lightnet fixture to include voteActions",
  );
  const voteActions = voteActionsPayload.voteActions.map((voteAction) =>
    VoteAction.fromJSON(voteAction),
  );
  assert.strictEqual(voteActions.length, 5, "expected 5 Lightnet vote actions");

  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  const workerProcess = spawnCliWorker(queueName, {
    redisHost,
    redisPort,
    stdio: "inherit",
  });
  await sleep(400);

  try {
    const baseArgs = ["--lifecycle-id", lifecycleId, "--vote-actions-path", voteActionsPath];
    const provingArgs = [
      ...baseArgs,
      "--queue-name",
      queueName,
      "--redis-host",
      redisHost,
      "--redis-port",
      String(redisPort),
    ];

    await runSdkCli(["vote-reducer", "compile"]);
    const previousDirectory = process.env.SQLITE_DATA_DIRECTORY;
    process.env.SQLITE_DATA_DIRECTORY = SQLITE_FIXTURE_DIRECTORY;
    // This archive fixture has no live Proposal. Trace through the SDK here;
    // vote-reducer-proof-input.test.ts tests CLI validation against Proposal state.
    const service = new SqliteVoteReducerService({
      lifecycleId,
      proposalPublicKey: voteActionsPayload.proposalPublicKey,
      proposalTokenId: voteActionsPayload.proposalTokenId,
      actionStateHistoryTarget: voteActionsPayload.actionStateHistoryTarget,
    });
    try {
      await service.start();
      await service.traceRunBatch(voteActions);
    } finally {
      await service.close();
      if (previousDirectory === undefined) delete process.env.SQLITE_DATA_DIRECTORY;
      else process.env.SQLITE_DATA_DIRECTORY = previousDirectory;
    }
    await runSdkCli(["vote-reducer", "prove-run-batch", ...provingArgs]);

    const proofStore = new KeyvSqlite({ uri: dbPath });
    const proofStorage = createSqliteVoteReducerProofStorage(getVoteReducerScope({ lifecycleId, ...voteActionsPayload }), proofStore);
    const baseProofCount = await proofStorage.count();
    const mergeProofCount = await proofStorage.mergeCount();
    const baseProof = await proofStorage.getProof("0");
    await proofStorage.close();
    await proofStore.disconnect();

    assert.strictEqual(
      baseProofCount,
      1,
      `expected exactly 1 base proof for ${voteActions.length} vote actions`,
    );
    assert.strictEqual(
      mergeProofCount,
      0,
      "expected 0 merge proofs before prove-merge",
    );
    assert(baseProof, "expected base run-batch proof with id 0");
    const baseProofJson = baseProof.toJSON() as {
      publicInput?: unknown;
      publicOutput?: unknown;
    };
    assertVoteReducerProofMatchesExpectedActionHistory(
      "base proof",
      baseProofJson,
      voteActionsPayload.actionStateHistoryTarget,
    );

    await runSdkCli(
      [
        "vote-reducer",
        "prove-merge",
        ...provingArgs,
        "--proof-output-path",
        mergedProofPath,
      ],
    );

    const mergedProof = JSON.parse(await readFile(mergedProofPath, "utf8")) as {
      publicInput?: unknown;
      publicOutput?: unknown;
    };
    assertVoteReducerProofMatchesExpectedActionHistory(
      "merged proof",
      mergedProof,
      voteActionsPayload.actionStateHistoryTarget,
    );
    assert.deepStrictEqual(
      mergedProof.publicInput,
      baseProofJson.publicInput,
      "expected prove-merge to return the single base proof unchanged",
    );
    assert.deepStrictEqual(
      mergedProof.publicOutput,
      baseProofJson.publicOutput,
      "expected prove-merge publicOutput to match the single base proof",
    );
  } finally {
    workerProcess.kill("SIGTERM");
    await waitForExit(workerProcess, 5_000);
    await redisServer.stop();
  }
});


it("selects Proposal state from VOTE_ACTIONS_PATH and rejects missing identity", async () => {
  const voteActionsPath = join(
    FIXTURES_DIRECTORY,
    "vote-reducer-lightnet-actions.json",
  );
  const result = await runCli(["vote-reducer", "clear-state"], {
    envOverrides: {
      LIFECYCLE_ID: "cli-vote-reducer-clear-state",
      VOTE_ACTIONS_PATH: voteActionsPath,
      SQLITE_DATA_DIRECTORY: SQLITE_FIXTURE_DIRECTORY,
    },
  });
  assert.match(result, /done/);
  for (const command of [
    "trace-run-batch",
    "prove-run-batch",
    "prove-merge",
    "clear-state",
  ]) {
    await assert.rejects(
      runCli(["vote-reducer", command, "--lifecycle-id", "missing-scope"], {
        envOverrides: {
          VOTE_ACTIONS_PATH: "",
          STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH: "unused-proof.json",
          TREASURY_OWNER_PUBLIC_KEY: JSON.parse(await readFile(voteActionsPath, "utf8")).proposalPublicKey,
        },
      }),
      /vote-actions-path/,
    );
  }
});
