import { Command, Option } from "commander";
import { SqliteStakingLedgerToVotingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";
import { logger, provableLog } from "@repo/sdk/src/index.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseIntOption } from "./option-parsers.js";
import {
  cleanCheckpoint,
  pullCheckpoint,
  pushCheckpoint,
} from "../lib/s3-checkpoint.js";

interface BaseOptions {
  lifecycleId: string;
  redisHost?: string;
  redisPort?: number;
  queueName?: string;
}

const STAKING_LEDGER_TO_VOTING_LEDGER_COMPILE_LIFECYCLE_ID =
  "staking-ledger-to-voting-ledger-compile";

function resolveRedisConfig({
  redisHost,
  redisPort,
  queueName,
}: Pick<BaseOptions, "redisHost" | "redisPort" | "queueName">): {
  redisHost: string;
  redisPort: number;
  queueName?: string;
} {
  const resolvedRedisHost = redisHost ?? process.env.REDIS_HOST;
  const resolvedRedisPort =
    redisPort ??
    (process.env.REDIS_PORT
      ? Number.parseInt(process.env.REDIS_PORT, 10)
      : undefined);
  const resolvedQueueName = queueName ?? process.env.QUEUE_NAME;

  if (!resolvedRedisHost) {
    throw new Error(
      "Missing Redis host. Pass --redis-host or set REDIS_HOST in environment.",
    );
  }
  if (resolvedRedisPort === undefined || Number.isNaN(resolvedRedisPort)) {
    throw new Error(
      "Missing or invalid Redis port. Pass --redis-port or set REDIS_PORT in environment.",
    );
  }

  return {
    redisHost: resolvedRedisHost,
    redisPort: resolvedRedisPort,
    queueName: resolvedQueueName,
  };
}

export async function compile() {
  logger.info(
    `[staking-ledger-to-voting-ledger:compile] starting (lifecycleId=${STAKING_LEDGER_TO_VOTING_LEDGER_COMPILE_LIFECYCLE_ID})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId: STAKING_LEDGER_TO_VOTING_LEDGER_COMPILE_LIFECYCLE_ID,
  });
  try {
    await service.compile();
    logger.info("[staking-ledger-to-voting-ledger:compile] done");
  } finally {
    await service.close();
  }
}

export async function traceDigest({
  lifecycleId,
  startIndex,
  endIndex,
  checkpointInterval,
  checkpointS3Uri,
  ledgerHash,
}: Pick<BaseOptions, "lifecycleId"> & {
  startIndex?: number;
  endIndex?: number;
  checkpointInterval?: number;
  checkpointS3Uri?: string;
  ledgerHash?: string;
}) {
  if (checkpointS3Uri && !checkpointInterval) {
    throw new Error(
      "--checkpoint-s3-uri requires --checkpoint-interval to be set",
    );
  }
  const checkpointEnabled = Boolean(checkpointS3Uri && checkpointInterval);

  const startedAt = Date.now();
  let tracedCount = 0;
  let lastTracedIndex = (startIndex ?? 0) - 1;
  logger.info(
    `[staking-ledger-to-voting-ledger:trace-digest] starting (lifecycleId=${lifecycleId}, startIndex=${String(startIndex ?? 0)}, endIndex=${String(endIndex ?? Infinity)}${checkpointEnabled ? `, checkpointInterval=${checkpointInterval}` : ""})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
  });
  let sigtermHandler: (() => void) | undefined;
  try {
    await service.start();

    if (checkpointEnabled && ledgerHash) {
      await service.writeCheckpointLedgerHash(ledgerHash);
    }

    // Never runs two checkpoints concurrently, and never queues one behind
    // another indefinitely. pushCheckpoint() has a hard timeout, so a stuck
    // attempt (observed happening in practice - an upload that neither
    // completed nor rejected) always eventually clears; a serial queue
    // instead let that one stuck attempt silently block every checkpoint for
    // the rest of the run, since each new one just piled up behind it. A
    // failed checkpoint is logged and swallowed - losing one interval's
    // snapshot should not fail an otherwise-successful run, since the
    // previous checkpoint (or a from-scratch restart) is still available.
    let checkpointInFlight: Promise<void> | null = null;
    const runCheckpoint = async (index: number): Promise<void> => {
      try {
        await service.checkpointWal();
        await pushCheckpoint(checkpointS3Uri!, lifecycleId, getSqliteDbPath(lifecycleId));
        logger.info(
          `[staking-ledger-to-voting-ledger:trace-digest] checkpointed lifecycleId=${lifecycleId} through index=${index}`,
        );
      } catch (error) {
        logger.error(
          `[staking-ledger-to-voting-ledger:trace-digest] checkpoint at index=${index} failed: ${String(error)} - continuing without it`,
        );
      }
    };
    const scheduleCheckpoint = (index: number): Promise<void> => {
      if (checkpointInFlight) {
        return checkpointInFlight;
      }
      const attempt = runCheckpoint(index).finally(() => {
        if (checkpointInFlight === attempt) {
          checkpointInFlight = null;
        }
      });
      checkpointInFlight = attempt;
      return attempt;
    };

    if (checkpointEnabled) {
      // Kubernetes sends SIGTERM before a spot reclaim tears the pod down, so
      // taking one immediate checkpoint here bounds the lost work to whatever
      // happens between this handler and the grace period expiring, rather
      // than the full interval - the periodic checkpoint below is the
      // fallback for a hard kill that skips SIGTERM entirely.
      sigtermHandler = () => {
        logger.info(
          "[staking-ledger-to-voting-ledger:trace-digest] SIGTERM received - checkpointing before exit",
        );
        void scheduleCheckpoint(lastTracedIndex).finally(() => {
          process.exit(143);
        });
      };
      process.once("SIGTERM", sigtermHandler);
    }

    let sinceCheckpoint = 0;
    await service.traceDigest(startIndex, endIndex, (index) => {
      tracedCount += 1;
      lastTracedIndex = index;
      logger.info(
        `[staking-ledger-to-voting-ledger:trace-digest] traced index=${index} (count=${tracedCount})`,
      );
      if (checkpointEnabled) {
        sinceCheckpoint += 1;
        if (sinceCheckpoint >= checkpointInterval!) {
          sinceCheckpoint = 0;
          void scheduleCheckpoint(index);
        }
      }
    });

    if (checkpointEnabled) {
      // Covers the tail: the run may finish partway through an interval, and
      // that last partial batch would otherwise never get checkpointed.
      await scheduleCheckpoint(lastTracedIndex);
    }

    logger.info(
      `[staking-ledger-to-voting-ledger:trace-digest] done (count=${tracedCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    if (sigtermHandler) {
      process.removeListener("SIGTERM", sigtermHandler);
    }
    await service.close();
  }
}

// Attempts to resume lifecycleId's trace-digest from its last checkpoint.
// Prints RESUME_INDEX=<n> and leaves a validated, downloaded checkpoint in
// place when one exists and matches expectedLedgerHash; otherwise prints
// FRESH and leaves no local file behind (removing one that failed to
// validate), so the caller always starts clean in that case.
export async function checkpointRestore({
  lifecycleId,
  expectedLedgerHash,
  s3Uri,
}: {
  lifecycleId: string;
  expectedLedgerHash: string;
  s3Uri: string;
}) {
  const destinationPath = getSqliteDbPath(lifecycleId);
  const found = await pullCheckpoint(s3Uri, lifecycleId, destinationPath);
  if (!found) {
    logger.info(
      `[staking-ledger-to-voting-ledger:checkpoint-restore] no checkpoint for lifecycleId=${lifecycleId}`,
    );
    process.stdout.write("FRESH\n");
    return;
  }

  let resumeIndex: number | undefined;
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
  });
  try {
    await service.start();
    const storedLedgerHash = await service.readCheckpointLedgerHash();
    if (storedLedgerHash === expectedLedgerHash) {
      resumeIndex = await service.getTracedIndexCount();
    } else {
      logger.info(
        `[staking-ledger-to-voting-ledger:checkpoint-restore] checkpoint for lifecycleId=${lifecycleId} was for ledgerHash=${String(storedLedgerHash)}, expected ${expectedLedgerHash} - discarding`,
      );
    }
  } finally {
    await service.close();
  }

  if (resumeIndex === undefined) {
    await unlink(destinationPath).catch(() => {});
    process.stdout.write("FRESH\n");
    return;
  }

  logger.info(
    `[staking-ledger-to-voting-ledger:checkpoint-restore] restored lifecycleId=${lifecycleId} at index=${resumeIndex}`,
  );
  process.stdout.write(`RESUME_INDEX=${resumeIndex}\n`);
}

export async function checkpointClean({
  lifecycleId,
  s3Uri,
}: {
  lifecycleId: string;
  s3Uri: string;
}) {
  await cleanCheckpoint(s3Uri, lifecycleId);
  logger.info(
    `[staking-ledger-to-voting-ledger:checkpoint-clean] removed checkpoint for lifecycleId=${lifecycleId} (if any existed)`,
  );
}

export async function proveDigest({
  lifecycleId,
  redisHost,
  redisPort,
  queueName,
  startIndex,
  endIndex,
}: BaseOptions & { startIndex?: number; endIndex?: number }) {
  const startedAt = Date.now();
  let provedCount = 0;
  const redisConfig = resolveRedisConfig({ redisHost, redisPort, queueName });
  logger.info(
    `[staking-ledger-to-voting-ledger:prove-digest] starting (lifecycleId=${lifecycleId}, redis=${redisConfig.redisHost}:${redisConfig.redisPort}, queueName=${redisConfig.queueName ?? `staking-ledger-to-voting-ledger-${lifecycleId}`}, startIndex=${String(startIndex ?? 0)}, endIndex=${String(endIndex ?? Infinity)})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
    redisConnection: {
      host: redisConfig.redisHost,
      port: redisConfig.redisPort,
    },
    queueName: redisConfig.queueName,
  });
  try {
    await service.start();
    await service.proveDigest(startIndex, endIndex, (index) => {
      provedCount += 1;
      logger.info(
        `[staking-ledger-to-voting-ledger:prove-digest] proved index=${index} (count=${provedCount})`,
      );
    });
    logger.info(
      `[staking-ledger-to-voting-ledger:prove-digest] done (count=${provedCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
}

export async function proveMerge({
  lifecycleId,
  redisHost,
  redisPort,
  queueName,
  proofOutputPath,
}: BaseOptions & { proofOutputPath?: string }) {
  const startedAt = Date.now();
  let mergeCount = 0;
  const redisConfig = resolveRedisConfig({ redisHost, redisPort, queueName });
  logger.info(
    `[staking-ledger-to-voting-ledger:prove-merge] starting (lifecycleId=${lifecycleId}, redis=${redisConfig.redisHost}:${redisConfig.redisPort}, queueName=${redisConfig.queueName ?? `staking-ledger-to-voting-ledger-${lifecycleId}`})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
    redisConnection: {
      host: redisConfig.redisHost,
      port: redisConfig.redisPort,
    },
    queueName: redisConfig.queueName,
  });
  try {
    await service.start();
    const mergedProof = await service.proveMerge((index) => {
      mergeCount += 1;
      logger.info(
        `[staking-ledger-to-voting-ledger:prove-merge] merged step=${index} (mergeCount=${mergeCount})`,
      );
    });
    const mergedProofJson = mergedProof.toJSON();
    provableLog("mergedProof", mergedProofJson);
    if (proofOutputPath) {
      await mkdir(dirname(proofOutputPath), { recursive: true });
      await writeFile(
        proofOutputPath,
        JSON.stringify(mergedProofJson, null, 2),
      );
      logger.info(
        `[staking-ledger-to-voting-ledger:prove-merge] wrote merged proof to ${proofOutputPath}`,
      );
    }
    logger.info(
      `[staking-ledger-to-voting-ledger:prove-merge] done (mergeCount=${mergeCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
}

export async function proveExhaust({
  lifecycleId,
  proofOutputPath,
}: Pick<BaseOptions, "lifecycleId"> & { proofOutputPath?: string }) {
  const startedAt = Date.now();
  logger.info(
    `[staking-ledger-to-voting-ledger:prove-exhaust] starting (lifecycleId=${lifecycleId})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
  });
  try {
    await service.start();
    const exhaustedProof = await service.proveExhaust();
    const exhaustedProofJson = exhaustedProof.toJSON();
    provableLog("exhaustedProof", exhaustedProofJson);
    if (proofOutputPath) {
      await mkdir(dirname(proofOutputPath), { recursive: true });
      await writeFile(
        proofOutputPath,
        JSON.stringify(exhaustedProofJson, null, 2),
      );
      logger.info(
        `[staking-ledger-to-voting-ledger:prove-exhaust] wrote exhausted proof to ${proofOutputPath}`,
      );
    }
    logger.info(
      `[staking-ledger-to-voting-ledger:prove-exhaust] done (elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
}

export default function stakingLedgerToVotingLedgerCommandFactory(
  program: Command,
) {
  const command = program.command("staking-ledger-to-voting-ledger");

  command
    .command("compile")
    .action(compile);

  command
    .command("trace-digest")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--start-index <start-index>", "Start index")
        .env("START_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--end-index <end-index>", "End index")
        .env("END_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option(
        "--checkpoint-interval <checkpoint-interval>",
        "Indices between S3 checkpoints. Requires --checkpoint-s3-uri.",
      )
        .env("CHECKPOINT_INTERVAL")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option(
        "--checkpoint-s3-uri <checkpoint-s3-uri>",
        "S3 URI prefix to checkpoint progress under, e.g. s3://bucket/devnet",
      ).env("CHECKPOINT_S3_URI"),
    )
    .addOption(
      new Option(
        "--ledger-hash <ledger-hash>",
        "Ledger hash this run traces, recorded in the checkpoint for later validation",
      ).env("LEDGER_HASH"),
    )
    .action(traceDigest);

  command
    .command("checkpoint-restore")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--expected-ledger-hash <expected-ledger-hash>",
        "Ledger hash the restored checkpoint must match to be resumable",
      )
        .env("EXPECTED_LEDGER_HASH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--s3-uri <s3-uri>",
        "S3 URI prefix checkpoints are stored under",
      )
        .env("CHECKPOINT_S3_URI")
        .makeOptionMandatory(),
    )
    .action(checkpointRestore);

  command
    .command("checkpoint-clean")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--s3-uri <s3-uri>",
        "S3 URI prefix checkpoints are stored under",
      )
        .env("CHECKPOINT_S3_URI")
        .makeOptionMandatory(),
    )
    .action(checkpointClean);

  command
    .command("prove-digest")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--redis-host <redis-host>", "Redis host").env("REDIS_HOST"),
    )
    .addOption(
      new Option("--redis-port <redis-port>", "Redis port")
        .env("REDIS_PORT")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--queue-name <queue-name>", "Queue name").env("QUEUE_NAME"),
    )
    .addOption(
      new Option("--start-index <start-index>", "Start index")
        .env("START_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--end-index <end-index>", "End index")
        .env("END_INDEX")
        .argParser(parseIntOption),
    )
    .action(proveDigest);

  command
    .command("prove-merge")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--redis-host <redis-host>", "Redis host").env("REDIS_HOST"),
    )
    .addOption(
      new Option("--redis-port <redis-port>", "Redis port")
        .env("REDIS_PORT")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--queue-name <queue-name>", "Queue name").env("QUEUE_NAME"),
    )
    .addOption(
      new Option(
        "--proof-output-path <proof-output-path>",
        "Write merged proof JSON to file",
      ).env("PROOF_OUTPUT_PATH"),
    )
    .action(proveMerge);

  command
    .command("prove-exhaust")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--proof-output-path <proof-output-path>",
        "Write exhausted proof JSON to file",
      ).env("PROOF_OUTPUT_PATH"),
    )
    .action(proveExhaust);
}

/**
 * TODO:
 * CLI:
 * - deploy treasury
 * - create proposal
 * - vote on proposal
 * - tally votes
 * - execute proposal
 */
