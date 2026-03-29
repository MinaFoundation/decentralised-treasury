import assert from "node:assert";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { ACCOUNT_BATCH_SIZE } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import {
  runCli,
  sleep,
  spawnCliWorker,
} from "./utils/cli-test-utils.js";

const runSdkCli = (args: string[]) => runCli(args);

const FIXTURES_DIRECTORY = fileURLToPath(new URL("./fixtures", import.meta.url));
const SQLITE_FIXTURE_DIRECTORY = join(FIXTURES_DIRECTORY, ".data", "sqlite");
const MINI_LEDGER_PATH = fileURLToPath(
  new URL("../../sdk/test/test-ledger-mini.json", import.meta.url),
);
const STAKING_LEDGER_TO_VOTING_LEDGER_FIXTURE_LIFECYCLE_ID =
  "cli-staking-to-voting-ledger-mini-fixture";
const EXPECTED_MINI_LEDGER_ROOT =
  "3982835709504547613460178343351902306072230308795146598392355811214701294803";

function readExhaustedFlagFromProofJson(
  proof: { publicOutput?: unknown },
): string | undefined {
  if (!Array.isArray(proof.publicOutput)) {
    return undefined;
  }
  const exhausted = proof.publicOutput[2];
  return typeof exhausted === "string" ? exhausted : undefined;
}

it("runs staking-ledger-to-voting-ledger cli flow end-to-end", { concurrency: false }, async () => {
  const lifecycleId = STAKING_LEDGER_TO_VOTING_LEDGER_FIXTURE_LIFECYCLE_ID;
  const queueName = `${lifecycleId}-queue`;
  const dbPath = join(
    SQLITE_FIXTURE_DIRECTORY,
    `${lifecycleId}.sqlite`,
  );
  const proofOutputPath = join(
    FIXTURES_DIRECTORY,
    "staking-ledger-to-voting-ledger-proof-mini.json",
  );
  await mkdir(SQLITE_FIXTURE_DIRECTORY, { recursive: true });
  await rm(dbPath, { force: true });
  await rm(proofOutputPath, { force: true });

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
    await runSdkCli([
      "staking-ledger",
      "from-file",
      "--lifecycle-id",
      lifecycleId,
      "--staking-ledger-path",
      MINI_LEDGER_PATH,
      "--start-index",
      "0",
      "--end-index",
      "9",
    ]);

    const stakingLedgerService = new SqliteStakingLedgerService({
      lifecycleId,
      dbPath,
    });
    await stakingLedgerService.start();
    const root = await stakingLedgerService.getRootHash();
    await stakingLedgerService.close();
    assert.strictEqual(root.toString(), EXPECTED_MINI_LEDGER_ROOT);

    const hydratedAccountCount = 10;
    const traceCount = Math.ceil(hydratedAccountCount / ACCOUNT_BATCH_SIZE);
    const maxTraceIndex = traceCount - 1;

    const baseArgs = [
      "--lifecycle-id",
      lifecycleId,
    ];
    const provingArgs = [
      ...baseArgs,
      "--queue-name",
      queueName,
      "--redis-host",
      redisHost,
      "--redis-port",
      String(redisPort),
    ];

    await runSdkCli([
      "staking-ledger-to-voting-ledger",
      "compile",
    ]);

    await runSdkCli([
      "staking-ledger-to-voting-ledger",
      "trace-digest",
      ...baseArgs,
      "--start-index",
      "0",
      "--end-index",
      String(maxTraceIndex),
    ]);

    await runSdkCli([
      "staking-ledger-to-voting-ledger",
      "prove-digest",
      ...provingArgs,
      "--start-index",
      "0",
      "--end-index",
      String(maxTraceIndex),
    ]);

    await runSdkCli([
      "staking-ledger-to-voting-ledger",
      "prove-merge",
      ...provingArgs,
      "--proof-output-path",
      proofOutputPath,
    ]);
    const proofFileContent = await readFile(proofOutputPath, "utf8");
    const savedProof = JSON.parse(proofFileContent) as { publicInput?: unknown };
    assert(savedProof.publicInput, "expected saved proof file to contain publicInput");

  } finally {
    workerProcess.kill();
    await redisServer.stop();
  }
});

it("proves exhaust using the merged proof from the flow test", { concurrency: false }, async () => {
  const lifecycleId = STAKING_LEDGER_TO_VOTING_LEDGER_FIXTURE_LIFECYCLE_ID;
  const mergedProofOutputPath = join(
    FIXTURES_DIRECTORY,
    "staking-ledger-to-voting-ledger-proof-mini.json",
  );
  const exhaustedProofOutputPath = join(
    FIXTURES_DIRECTORY,
    "staking-ledger-to-voting-ledger-proof-mini-exhaust.json",
  );
  await rm(exhaustedProofOutputPath, { force: true });
  const existingMergedProof = JSON.parse(
    await readFile(mergedProofOutputPath, "utf8"),
  ) as { publicInput?: unknown };
  assert(
    existingMergedProof.publicInput,
    "expected merged proof from previous flow test to exist before exhaust",
  );

  await runSdkCli([
    "staking-ledger-to-voting-ledger",
    "prove-exhaust",
    "--lifecycle-id",
    lifecycleId,
    "--proof-output-path",
    exhaustedProofOutputPath,
  ]);

  const exhaustedProofFileContent = await readFile(exhaustedProofOutputPath, "utf8");
  const exhaustedProofJson = JSON.parse(exhaustedProofFileContent) as {
    publicOutput?: unknown;
  };
  assert.strictEqual(
    readExhaustedFlagFromProofJson(exhaustedProofJson),
    "1",
    "expected exhausted proof publicOutput.exhausted to be true",
  );
});
