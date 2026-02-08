import { Proof } from "o1js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  stakingLedgerToVotingLedgerContext,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { readLedger } from "../../../src/read-ledger.js";
import { Account } from "../../../src/provable/account.js";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { createRedisServer } from "./redis-test-server.js";
import { getProofsEnabled } from "./proofs-enabled.js";

const createVotingLedgerId = (lifecycleId: string) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${lifecycleId}-voting-${uniqueSuffix}`;
};

export async function createStakingLedgerToVotingLedgerTestContext(
  options: {
    lifecycleId?: string;
    ledgerPath?: string;
    maxAccounts?: number;
  } = {},
) {
  const lifecycleId =
    options.lifecycleId ?? "staking-ledger-to-voting-ledger-test";
  const redisSetup = await createRedisServer();
  const stakingLedger = new RedisStakingLedger(
    redisSetup.redisUrl,
    lifecycleId,
  );

  const ledgerPath =
    options.ledgerPath ?? "test/provable/staking-epoch-ledger.json";
  let testAccounts = await readLedger(ledgerPath);
  if (options.maxAccounts !== undefined) {
    testAccounts = testAccounts.slice(0, options.maxAccounts);
  }

  for (const [index, account] of testAccounts.entries()) {
    if (!Account.isEmpty(account).toBoolean()) {
      await stakingLedger.setLeaf(BigInt(index), account);
    }
  }
  const votingLedgerId = createVotingLedgerId(lifecycleId);
  const votingLedger = new RedisVotingLedger(
    redisSetup.redisUrl,
    votingLedgerId,
  );

  stakingLedgerToVotingLedgerContext.set({
    stakingLedger,
    votingLedger,
  });

  const padAccounts = (accounts: Account[]) => {
    if (accounts.length !== ACCOUNT_BATCH_SIZE) {
      const missingAccounts = ACCOUNT_BATCH_SIZE - accounts.length;
      for (let j = 0; j < missingAccounts; j++) {
        accounts.push(Account.empty());
      }
    }
    return accounts;
  };

  const digest = async (accounts = testAccounts) => {
    if (accounts.length > ACCOUNT_BATCH_SIZE) {
      throw new Error("Digest expects at most one account batch");
    }

    const input = {
      index: 0,
      stakingLedgerRoot: await stakingLedger.getRoot(),
      votingLedgerRoot: await votingLedger.getRoot(),
    };

    const accountBatch = padAccounts(accounts.slice(0, ACCOUNT_BATCH_SIZE));
    const { proof } = await StakingLedgerToVotingLedger.digest(
      input,
      accountBatch,
    );

    return proof;
  };

  const compile = async (proofsEnabled: boolean = getProofsEnabled()) => {
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled: proofsEnabled,
    });
  };

  const cleanup = async () => {
    await votingLedger.close();
    await stakingLedger.close();
    await redisSetup.redisServer.stop();
  };

  return {
    stakingLedger,
    votingLedger,
    testAccounts,
    digest,
    compile,
    cleanup,
  };
}

export async function cleanupStakingLedgerToVotingLedgerTestContextShared() {
  // no-op
}
