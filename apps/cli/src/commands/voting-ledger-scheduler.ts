import { Command, Option } from "commander";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { existsSync } from "node:fs";
import { LedgerHashBase58 } from "o1js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { SqliteStakingLedgerToVotingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";
import { logger } from "@repo/sdk/src/index.js";
import { parseIntOption } from "./option-parsers.js";

const NUMBER_OF_PERIODS_PER_LIFECYCLE = 4;
const COMPILE_LIFECYCLE_ID = "staking-ledger-to-voting-ledger-compile";
const LEDGER_FILENAME_PATTERN = /^(\d+)-([^.]+)\.tar\.gz$/;

interface VotingLedgerSchedulerOptions {
  stakingLedgersDirectory: string;
  lifecyclePeriodDuration: number;
  treasuryDeployedAtSlot: number;
  pollIntervalMs: number;
}

function doneMarkerPath(lifecycleId: string): string {
  return `${getSqliteDbPath(lifecycleId)}.done`;
}

function lifecycleIdForEpoch(
  epoch: number,
  deployedEpoch: number,
): string | undefined {
  const offset = epoch - deployedEpoch;
  if (offset < 0 || offset % NUMBER_OF_PERIODS_PER_LIFECYCLE !== 0) {
    return undefined;
  }
  return String(offset / NUMBER_OF_PERIODS_PER_LIFECYCLE);
}

async function processLedgerFile({
  filePath,
  epoch,
  expectedHash,
  lifecycleId,
}: {
  filePath: string;
  epoch: number;
  expectedHash: string;
  lifecycleId: string;
}): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "voting-ledger-"));
  try {
    await tar.x({ file: filePath, cwd: tmpDir });
    const stakingLedgerPath = join(tmpDir, `${epoch}.json`);

    const stakingLedgerService = new SqliteStakingLedgerService({
      lifecycleId,
    });
    await stakingLedgerService.start();
    try {
      await stakingLedgerService.hydrateAccounts({ stakingLedgerPath });
      await stakingLedgerService.hydrateMerkleTree();

      const computedRoot = await stakingLedgerService.getRootHash();
      const expectedRoot = LedgerHashBase58.fromBase58(expectedHash);
      if (!computedRoot.equals(expectedRoot).toBoolean()) {
        logger.error(
          `[voting-ledger-scheduler] hash mismatch for epoch=${epoch} lifecycleId=${lifecycleId}: computed=${computedRoot.toString()} expected=${expectedRoot.toString()} (from filename hash ${expectedHash}). Skipping — this lifecycle will be retried next cycle.`,
        );
        return;
      }
      logger.info(
        `[voting-ledger-scheduler] hash verified for epoch=${epoch} lifecycleId=${lifecycleId}: ${computedRoot.toString()}`,
      );
    } finally {
      await stakingLedgerService.close();
    }

    const votingLedgerService = new SqliteStakingLedgerToVotingLedgerService({
      lifecycleId,
    });
    await votingLedgerService.start();
    try {
      await votingLedgerService.traceDigest();
    } finally {
      await votingLedgerService.close();
    }

    await writeFile(
      doneMarkerPath(lifecycleId),
      JSON.stringify(
        {
          lifecycleId,
          epoch,
          ledgerHash: expectedHash,
          processedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    logger.info(
      `[voting-ledger-scheduler] done epoch=${epoch} lifecycleId=${lifecycleId}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function runVotingLedgerScheduler(
  options: VotingLedgerSchedulerOptions,
): Promise<void> {
  const deployedEpoch = Math.floor(
    options.treasuryDeployedAtSlot / options.lifecyclePeriodDuration,
  );

  logger.info(
    `[voting-ledger-scheduler] starting (stakingLedgersDirectory=${options.stakingLedgersDirectory}, deployedEpoch=${deployedEpoch}, pollIntervalMs=${options.pollIntervalMs})`,
  );

  logger.info("[voting-ledger-scheduler] compiling staking-ledger-to-voting-ledger circuit");
  const compileService = new SqliteStakingLedgerToVotingLedgerService({
    lifecycleId: COMPILE_LIFECYCLE_ID,
  });
  await compileService.compile();
  await compileService.close();
  logger.info("[voting-ledger-scheduler] compile done");

  async function findNewestCandidate(): Promise<
    { file: string; epoch: number; hash: string; lifecycleId: string } | undefined
  > {
    const files = await readdir(options.stakingLedgersDirectory);
    let newest:
      | { file: string; epoch: number; hash: string; lifecycleId: string }
      | undefined;
    for (const file of files) {
      const match = LEDGER_FILENAME_PATTERN.exec(file);
      if (!match) continue;
      const epoch = Number(match[1]);
      const hash = match[2];
      const lifecycleId = lifecycleIdForEpoch(epoch, deployedEpoch);
      if (lifecycleId === undefined) continue;
      if (existsSync(doneMarkerPath(lifecycleId))) continue;
      if (!newest || epoch > newest.epoch) {
        newest = { file, epoch, hash, lifecycleId };
      }
    }
    return newest;
  }

  let inFlight = false;
  const pollOnce = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      // Re-scan and re-pick the newest unprocessed lifecycle every cycle
      // (rather than queuing up the whole backlog at once) so a freshly
      // arrived epoch is picked up and prioritized as soon as the current
      // lifecycle finishes, instead of waiting behind an already-queued
      // backlog of older lifecycles.
      const candidate = await findNewestCandidate();
      if (!candidate) return;
      const { file, epoch, hash, lifecycleId } = candidate;

      logger.info(
        `[voting-ledger-scheduler] processing epoch=${epoch} lifecycleId=${lifecycleId} file=${file}`,
      );
      try {
        await processLedgerFile({
          filePath: join(options.stakingLedgersDirectory, file),
          epoch,
          expectedHash: hash,
          lifecycleId,
        });
      } catch (error) {
        logger.error(
          `[voting-ledger-scheduler] failed to process epoch=${epoch} lifecycleId=${lifecycleId}: ${String(error)}`,
        );
      }
    } catch (error) {
      logger.error(`[voting-ledger-scheduler] poll cycle failed: ${String(error)}`);
    } finally {
      inFlight = false;
    }
  };

  await pollOnce();
  const timer = setInterval(() => void pollOnce(), options.pollIntervalMs);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    logger.info("[voting-ledger-scheduler] shutting down");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {});
}

export default function votingLedgerSchedulerCommandFactory(program: Command) {
  const command = program.command("voting-ledger-scheduler");

  command
    .command("start")
    .addOption(
      new Option(
        "--staking-ledgers-directory <staking-ledgers-directory>",
        "Directory watched for <epoch>-<hash>.tar.gz staking ledger snapshots",
      )
        .env("STAKING_LEDGERS_DIRECTORY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of a lifecycle period in slots (one Mina epoch)",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser(parseIntOption)
        .default(7140),
    )
    .addOption(
      new Option(
        "--treasury-deployed-at-slot <treasury-deployed-at-slot>",
        "Slot at which the treasury lifecycle starts",
      )
        .env("TREASURY_DEPLOYED_AT_SLOT")
        .argParser(parseIntOption)
        .default(0),
    )
    .addOption(
      new Option(
        "--poll-interval-ms <poll-interval-ms>",
        "How often to scan the staking ledgers directory, in milliseconds",
      )
        .env("VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_MS")
        .argParser(parseIntOption)
        .default(30000),
    )
    .action(runVotingLedgerScheduler);
}
