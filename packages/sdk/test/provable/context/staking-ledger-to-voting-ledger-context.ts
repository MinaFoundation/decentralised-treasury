import { Proof } from "o1js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  stakingLedgerToVotingLedgerContext,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account } from "../../../src/provable/account.js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { PersistentVotingLedger } from "../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
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
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );

  const ledgerPath =
    options.ledgerPath ?? "test/provable/staking-epoch-ledger.json";
  let testAccounts = await stakingLedger.readStakingLedger(ledgerPath);
  if (options.maxAccounts !== undefined) {
    testAccounts = testAccounts.slice(0, options.maxAccounts);
  }

  await stakingLedger.hydrateAccounts(testAccounts);
  await stakingLedger.hydrateMerkleTree(testAccounts);

  const votingLedgerId = createVotingLedgerId(lifecycleId);
  const votingLedgerStorage = createSqliteVotingLedgerStorage(votingLedgerId);
  const votingLedger = new PersistentVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
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
