import { Command } from "commander";
import { RedisStakingLedgerService } from "../services/redis/redis-staking-ledger-service.js";
import { Provable } from "o1js";

export async function getRootHash({
  redisUrl,
  lifecycleId,
}: {
  redisUrl: string;
  lifecycleId: string;
}) {
  const service = new RedisStakingLedgerService(redisUrl, lifecycleId);
  const rootHash = await service.merkleTree.getRoot();
  await service.close();
  Provable.log("rootHash", rootHash);
}

export async function hydrateAccounts({
  redisUrl,
  lifecycleId,
  stakingLedgerPath,
  startIndex,
  endIndex,
}: {
  redisUrl: string;
  lifecycleId: string;
  stakingLedgerPath: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const service = new RedisStakingLedgerService(redisUrl, lifecycleId);
  let accounts = await service.readStakingLedger(stakingLedgerPath);
  await service.hydrateAccounts(accounts, startIndex, endIndex);
  await service.close();
}

export async function hydrateMerkleTree({
  redisUrl,
  lifecycleId,
  startIndex,
  endIndex,
}: {
  redisUrl: string;
  lifecycleId: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const service = new RedisStakingLedgerService(redisUrl, lifecycleId);
  const accounts = await service.accountStorage.getAllAccounts();
  await service.hydrateMerkleTree(accounts, startIndex, endIndex);
  await service.close();
}

export async function fromFile({
  redisUrl,
  lifecycleId,
  stakingLedgerPath,
  startIndex,
  endIndex,
}: {
  redisUrl: string;
  lifecycleId: string;
  stakingLedgerPath: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  await hydrateAccounts({
    redisUrl,
    lifecycleId,
    stakingLedgerPath,
    startIndex,
    endIndex,
  });
  await hydrateMerkleTree({
    redisUrl,
    lifecycleId,
    startIndex,
    endIndex,
  });
}

export default function stakingLedgerCommandFactory(program: Command) {
  const command = program.command("staking-ledger");

  command
    .command("from-file")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .requiredOption(
      "--staking-ledger-path <staking-ledger-path>",
      "Staking ledger path"
    )
    .option("--redis-url <redis-url>", "Redis URL", process.env.REDIS_URL)
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(fromFile);

  command
    .command("hydrate-account-storage")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .requiredOption(
      "--staking-ledger-path <staking-ledger-path>",
      "Staking ledger path"
    )
    .option("--redis-url <redis-url>", "Redis URL", process.env.REDIS_URL)
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(hydrateAccounts);

  command
    .command("hydrate-merkle-tree")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .option("--redis-url <redis-url>", "Redis URL", process.env.REDIS_URL)
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(hydrateMerkleTree);

  command
    .command("get-root-hash")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .option("--redis-url <redis-url>", "Redis URL", process.env.REDIS_URL)
    .action(getRootHash);
}
