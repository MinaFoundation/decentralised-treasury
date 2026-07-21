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
const LEDGER_FILENAME_PATTERN = /^(\d+)-([^.]+)\.tar\.gz$/;

interface DirectoryOptions {
  stakingLedgersDirectory: string;
  lifecyclePeriodDuration: number;
  treasuryDeployedAtSlot: number;
}

function doneMarkerPath(lifecycleId: string): string {
  return `${getSqliteDbPath(lifecycleId)}.done`;
}

// A lifecycle's digest trace always resumes from index 0 (see traceDigest()),
// so if a previous attempt crashed after partially committing batches, retrying
// in place replays those batches against already-advanced voting-ledger state
// and fails the same way forever (the exact failure mode the TODO in
// staking-ledger-to-voting-ledger.ts's digest() warns about). Wiping the
// lifecycle's SQLite file before every attempt guarantees each attempt starts
// from a clean slate instead of getting stuck in a permanent crash loop.
async function resetLifecycleStorage(lifecycleId: string): Promise<void> {
  const dbPath = getSqliteDbPath(lifecycleId);
  for (const path of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
    await rm(path, { force: true });
  }
}

function deployedEpochFor(options: DirectoryOptions): number {
  return Math.floor(
    options.treasuryDeployedAtSlot / options.lifecyclePeriodDuration,
  );
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

function epochForLifecycleId(lifecycleId: string, deployedEpoch: number): number {
  return deployedEpoch + Number(lifecycleId) * NUMBER_OF_PERIODS_PER_LIFECYCLE;
}

interface LedgerCandidate {
  file: string;
  epoch: number;
  hash: string;
  lifecycleId: string;
}

async function findLedgerFiles(
  options: DirectoryOptions,
): Promise<LedgerCandidate[]> {
  const deployedEpoch = deployedEpochFor(options);
  const files = await readdir(options.stakingLedgersDirectory);
  const candidates: LedgerCandidate[] = [];
  for (const file of files) {
    const match = LEDGER_FILENAME_PATTERN.exec(file);
    if (!match) continue;
    const epoch = Number(match[1]);
    const hash = match[2];
    const lifecycleId = lifecycleIdForEpoch(epoch, deployedEpoch);
    if (lifecycleId === undefined) continue;
    candidates.push({ file, epoch, hash, lifecycleId });
  }
  return candidates;
}

async function findNewestUnprocessedCandidate(
  options: DirectoryOptions,
): Promise<LedgerCandidate | undefined> {
  const candidates = await findLedgerFiles(options);
  let newest: LedgerCandidate | undefined;
  for (const candidate of candidates) {
    if (existsSync(doneMarkerPath(candidate.lifecycleId))) continue;
    if (!newest || candidate.epoch > newest.epoch) {
      newest = candidate;
    }
  }
  return newest;
}

async function findCandidateForLifecycle(
  lifecycleId: string,
  options: DirectoryOptions,
): Promise<LedgerCandidate> {
  const deployedEpoch = deployedEpochFor(options);
  const expectedEpoch = epochForLifecycleId(lifecycleId, deployedEpoch);
  const candidates = await findLedgerFiles(options);
  const candidate = candidates.find((c) => c.epoch === expectedEpoch);
  if (!candidate) {
    throw new Error(
      `No staking ledger file found for lifecycleId=${lifecycleId} (expected epoch=${expectedEpoch}) in ${options.stakingLedgersDirectory}`,
    );
  }
  return candidate;
}

async function processCandidate(candidate: LedgerCandidate, options: DirectoryOptions): Promise<void> {
  const { file, epoch, hash: expectedHash, lifecycleId } = candidate;
  const filePath = join(options.stakingLedgersDirectory, file);

  logger.info(
    `[voting-ledger-scheduler] processing epoch=${epoch} lifecycleId=${lifecycleId} file=${file}`,
  );

  await resetLifecycleStorage(lifecycleId);

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
        throw new Error(
          `hash mismatch for epoch=${epoch} lifecycleId=${lifecycleId}: computed=${computedRoot.toString()} expected=${expectedRoot.toString()} (from filename hash ${expectedHash})`,
        );
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

// Processes a single, explicitly named lifecycle end-to-end. This is the only
// entry point for reprocessing a lifecycle that a previous automatic run
// skipped or crashed on — there is no automatic backward scan of the backlog.
// Run it by hand against the already-running scheduler container, e.g.:
//   docker exec voting-ledger-scheduler pnpm --dir apps/cli run mina-treasury -- voting-ledger-scheduler process-lifecycle --lifecycle-id 17
export async function processLifecycle(
  options: DirectoryOptions & { lifecycleId: string },
): Promise<void> {
  const candidate = await findCandidateForLifecycle(options.lifecycleId, options);
  await processCandidate(candidate, options);
}

// Single-shot check: process the newest arrived lifecycle if it hasn't been
// done yet, otherwise do nothing. Intended to be invoked repeatedly by the
// container's poll loop (see devops/docker/voting-ledger-scheduler-entrypoint.sh)
// so a freshly arrived epoch is picked up automatically. Deliberately does not
// scan for or retry older un-done lifecycles — that backward catch-up is what
// used to crash-loop the whole container; it is now a deliberate, manual
// `process-lifecycle` invocation instead.
export async function processNewest(options: DirectoryOptions): Promise<void> {
  const candidate = await findNewestUnprocessedCandidate(options);
  if (!candidate) {
    logger.info("[voting-ledger-scheduler] no new lifecycle to process");
    return;
  }
  await processCandidate(candidate, options);
}

function addDirectoryOptions<T extends Command>(command: T): T {
  return command
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
    ) as T;
}

export default function votingLedgerSchedulerCommandFactory(program: Command) {
  const command = program.command("voting-ledger-scheduler");

  addDirectoryOptions(
    command
      .command("process-lifecycle")
      .description(
        "Process one explicitly named lifecycle end-to-end (extract, verify, trace-digest, mark done). Always resets any prior partial state for that lifecycle first.",
      )
      .addOption(
        new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID to process")
          .env("LIFECYCLE_ID")
          .makeOptionMandatory(),
      ),
  ).action(processLifecycle);

  addDirectoryOptions(
    command
      .command("process-newest")
      .description(
        "Process the newest arrived, not-yet-done lifecycle, if any. No-op otherwise. Does not backfill older lifecycles.",
      ),
  ).action(processNewest);
}
