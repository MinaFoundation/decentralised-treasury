import { Command, Option } from "commander";
import {
  VoteAction,
  VOTE_ACTION_BATCH_SIZE,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SqliteVoteReducerService } from "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import type { VoteReducerActionStateHistoryTargetSnapshot } from "@repo/sdk/src/services/vote-reducer-types.js";
import { logger, provableLog } from "@repo/sdk/src/index.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseIntOption } from "./option-parsers.js";

interface BaseOptions {
  lifecycleId: string;
  redisHost?: string;
  redisPort?: number;
  queueName?: string;
}

const VOTE_REDUCER_COMPILE_LIFECYCLE_ID = "vote-reducer-compile";

interface VoteActionsFilePayload {
  voteActions: VoteAction[];
  proposalPublicKey?: string;
  proposalTokenId?: string;
  actionStateHistoryTarget?: VoteReducerActionStateHistoryTargetSnapshot;
}

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

async function readVoteActions(
  voteActionsPath: string,
): Promise<VoteActionsFilePayload> {
  const file = await readFile(voteActionsPath, "utf8");
  const parsed = JSON.parse(file) as unknown;
  const parsedObject =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  const actionStateHistoryTargetInput =
    parsedObject &&
    typeof parsedObject.actionStateHistoryTarget === "object" &&
    parsedObject.actionStateHistoryTarget !== null
      ? (parsedObject.actionStateHistoryTarget as Record<string, unknown>)
      : undefined;
  const voteActionsInput = Array.isArray(parsed)
    ? parsed
    : parsedObject &&
        "voteActions" in parsedObject &&
        Array.isArray(parsedObject.voteActions)
      ? (parsedObject.voteActions as unknown[])
      : undefined;

  if (!voteActionsInput) {
    throw new Error(
      "Invalid vote actions JSON. Expected an array or an object with a voteActions array.",
    );
  }

  return {
    voteActions: voteActionsInput.map((voteAction, index) => {
      if (typeof voteAction !== "object" || voteAction === null) {
        throw new Error(
          `Invalid vote action at index ${index}. Expected JSON object.`,
        );
      }
      return VoteAction.fromJSON(voteAction as Record<string, unknown>);
    }),
    proposalPublicKey:
      parsedObject && typeof parsedObject.proposalPublicKey === "string"
        ? parsedObject.proposalPublicKey
        : undefined,
    proposalTokenId:
      parsedObject && typeof parsedObject.proposalTokenId === "string"
        ? parsedObject.proposalTokenId
        : undefined,
    actionStateHistoryTarget:
      actionStateHistoryTargetInput &&
      typeof actionStateHistoryTargetInput.actionStateOne === "string" &&
      typeof actionStateHistoryTargetInput.actionStateTwo === "string" &&
      typeof actionStateHistoryTargetInput.actionStateThree === "string" &&
      typeof actionStateHistoryTargetInput.actionStateFour === "string" &&
      typeof actionStateHistoryTargetInput.actionStateFive === "string"
        ? {
            actionStateOne: actionStateHistoryTargetInput.actionStateOne,
            actionStateTwo: actionStateHistoryTargetInput.actionStateTwo,
            actionStateThree: actionStateHistoryTargetInput.actionStateThree,
            actionStateFour: actionStateHistoryTargetInput.actionStateFour,
            actionStateFive: actionStateHistoryTargetInput.actionStateFive,
          }
        : undefined,
  };
}

export async function compile() {
  logger.info(
    `[vote-reducer:compile] starting (lifecycleId=${VOTE_REDUCER_COMPILE_LIFECYCLE_ID})`,
  );
  const service = new SqliteVoteReducerService({
    lifecycleId: VOTE_REDUCER_COMPILE_LIFECYCLE_ID,
  });
  try {
    await service.compile();
    logger.info("[vote-reducer:compile] done");
  } finally {
    await service.close();
  }
}

export async function traceRunBatch({
  lifecycleId,
  voteActionsPath,
}: Pick<BaseOptions, "lifecycleId"> & {
  voteActionsPath: string;
}) {
  const startedAt = Date.now();
  const voteActionsPayload = await readVoteActions(voteActionsPath);
  const voteActions = voteActionsPayload.voteActions;
  if (
    !voteActionsPayload.proposalPublicKey ||
    !voteActionsPayload.proposalTokenId ||
    !voteActionsPayload.actionStateHistoryTarget
  ) {
    throw new Error(
      "trace-run-batch requires vote-actions JSON to include proposalPublicKey, proposalTokenId, and actionStateHistoryTarget",
    );
  }
  let tracedCount = 0;
  logger.info(
    `[vote-reducer:trace-run-batch] starting (lifecycleId=${lifecycleId}, voteActions=${voteActions.length}, batchSize=${VOTE_ACTION_BATCH_SIZE})`,
  );
  const service = new SqliteVoteReducerService({
    lifecycleId,
    proposalPublicKey: voteActionsPayload.proposalPublicKey,
    proposalTokenId: voteActionsPayload.proposalTokenId,
    actionStateHistoryTarget: voteActionsPayload.actionStateHistoryTarget,
  });
  try {
    await service.start();
    await service.traceRunBatch(voteActions, (index) => {
      tracedCount += 1;
      logger.info(
        `[vote-reducer:trace-run-batch] traced index=${index} (count=${tracedCount})`,
      );
    });
    logger.info(
      `[vote-reducer:trace-run-batch] done (count=${tracedCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
}

export async function proveRunBatch({
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
    `[vote-reducer:prove-run-batch] starting (lifecycleId=${lifecycleId}, redis=${redisConfig.redisHost}:${redisConfig.redisPort}, queueName=${redisConfig.queueName ?? `vote-reducer-${lifecycleId}`}, startIndex=${String(startIndex ?? 0)}, endIndex=${String(endIndex ?? Infinity)})`,
  );
  const service = new SqliteVoteReducerService({
    lifecycleId,
    redisConnection: {
      host: redisConfig.redisHost,
      port: redisConfig.redisPort,
    },
    queueName: redisConfig.queueName,
  });
  try {
    await service.start();
    await service.proveRunBatch(startIndex, endIndex, (index) => {
      provedCount += 1;
      logger.info(
        `[vote-reducer:prove-run-batch] proved index=${index} (count=${provedCount})`,
      );
    });
    logger.info(
      `[vote-reducer:prove-run-batch] done (count=${provedCount}, elapsedMs=${Date.now() - startedAt})`,
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
    `[vote-reducer:prove-merge] starting (lifecycleId=${lifecycleId}, redis=${redisConfig.redisHost}:${redisConfig.redisPort}, queueName=${redisConfig.queueName ?? `vote-reducer-${lifecycleId}`})`,
  );
  const service = new SqliteVoteReducerService({
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
        `[vote-reducer:prove-merge] merged step=${index} (mergeCount=${mergeCount})`,
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
        `[vote-reducer:prove-merge] wrote merged proof to ${proofOutputPath}`,
      );
    }
    logger.info(
      `[vote-reducer:prove-merge] done (mergeCount=${mergeCount}, elapsedMs=${Date.now() - startedAt})`,
    );
  } finally {
    await service.close();
  }
}

export async function clearState({
  lifecycleId,
}: Pick<BaseOptions, "lifecycleId">) {
  logger.info(`[vote-reducer:clear-state] starting (lifecycleId=${lifecycleId})`);
  const service = new SqliteVoteReducerService({
    lifecycleId,
  });
  try {
    await service.clearPersistentState();
    logger.info(`[vote-reducer:clear-state] done (lifecycleId=${lifecycleId})`);
  } finally {
    await service.close();
  }
}

export default function voteReducerCommandFactory(program: Command) {
  const command = program.command("vote-reducer");

  command
    .command("compile")
    .action(compile);

  command
    .command("trace-run-batch")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--vote-actions-path <vote-actions-path>",
        "Path to a JSON array (or { voteActions: [] }) of vote actions",
      )
        .env("VOTE_ACTIONS_PATH")
        .makeOptionMandatory(),
    )
    .action(traceRunBatch);

  command
    .command("prove-run-batch")
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
    .action(proveRunBatch);

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
    .command("clear-state")
    .description(
      "Clear vote-reducer traces/proofs/nullifier state while preserving voting ledger data",
    )
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .action(clearState);
}
