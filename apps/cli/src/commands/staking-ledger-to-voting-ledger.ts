import { Command, Option } from "commander";
import { SqliteStakingLedgerToVotingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { logger, provableLog } from "@repo/sdk/src/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseIntOption } from "./option-parsers.js";

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
}: Pick<BaseOptions, "lifecycleId"> & {
  startIndex?: number;
  endIndex?: number;
}) {
  const startedAt = Date.now();
  let tracedCount = 0;
  logger.info(
    `[staking-ledger-to-voting-ledger:trace-digest] starting (lifecycleId=${lifecycleId}, startIndex=${String(startIndex ?? 0)}, endIndex=${String(endIndex ?? Infinity)})`,
  );
  const service = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId,
  });
  try {
    await service.start();
    await service.traceDigest(startIndex, endIndex, (index) => {
      tracedCount += 1;
      logger.info(
        `[staking-ledger-to-voting-ledger:trace-digest] traced index=${index} (count=${tracedCount})`,
      );
    });
    logger.info(
      `[staking-ledger-to-voting-ledger:trace-digest] done (count=${tracedCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
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
    .action(traceDigest);

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
