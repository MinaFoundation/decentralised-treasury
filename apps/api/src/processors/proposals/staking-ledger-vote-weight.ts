import { Account, packToFields } from "@repo/sdk/src/provable/account.js";
import { hashWithPrefix } from "@repo/sdk/src/provable/hashing-helpers.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "@repo/sdk/src/ledgers/staking-ledger/staking-ledger.js";
import { ACCOUNT_BATCH_SIZE } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";
import { Field, TokenId } from "o1js";
import type { StakingLedgerServiceLookup } from "../../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { requireContractUInt64 } from "./proposal-contract-domain.js";

function addDefaultTokenDelegations(
  accounts: Account[],
): ReadonlyMap<string, bigint> {
  const weights = new Map<string, bigint>();

  for (const account of accounts) {
    if (!account.tokenId.equals(TokenId.default).toBoolean()) {
      continue;
    }

    const delegatePublicKey = account.delegate.toBase58();
    const accountBalance = requireContractUInt64(
      account.balance.toBigInt(),
      `staking balance for delegatePublicKey=${delegatePublicKey}`,
    );
    const voteWeight = requireContractUInt64(
      (weights.get(delegatePublicKey) ?? 0n) + accountBalance,
      `aggregated vote weight for delegatePublicKey=${delegatePublicKey}`,
    );
    weights.set(delegatePublicKey, voteWeight);
  }

  return weights;
}

async function assertAccountMatchesRoot(
  stakingLedger: StakingLedgerService,
  account: Account,
  index: bigint,
  lifecycleId: string,
  expectedRoot: Field,
): Promise<void> {
  const witness = await stakingLedger.getWitness(index);
  const accountLeaf = hashWithPrefix(
    accountHashPrefix,
    packToFields(Account.toHashInput(account)),
  );
  const calculatedRoot = witness.calculateRoot(
    accountLeaf,
    accountLedgerHashPrefixes,
  );
  if (
    !witness.calculateIndex().equals(Field(index)).toBoolean() ||
    !calculatedRoot.equals(expectedRoot).toBoolean()
  ) {
    throw new Error(
      `[proposal-processor] staking account witness does not match ledger root for lifecycleId=${lifecycleId} index=${index}`,
    );
  }
}

async function readProgramAccountRange(
  stakingLedger: StakingLedgerService,
  lifecycleId: string,
  expectedStakingLedgerRoot: string,
): Promise<Account[]> {
  const expectedRoot = Field(expectedStakingLedgerRoot);
  const accounts: Account[] = [];
  const batchSize = BigInt(ACCOUNT_BATCH_SIZE);

  for (let batchStart = 0n; ; batchStart += batchSize) {
    const firstAccount = await stakingLedger.getAccount(batchStart);
    await assertAccountMatchesRoot(
      stakingLedger,
      firstAccount,
      batchStart,
      lifecycleId,
      expectedRoot,
    );

    // The ZK tracer stops only when the first account of a batch is empty.
    // This witness is the same next-index exhaustion check used by the
    // program after its last fixed-size digest batch.
    if (Account.isEmpty(firstAccount).toBoolean()) {
      return accounts;
    }

    accounts.push(firstAccount);
    for (let offset = 1n; offset < batchSize; offset += 1n) {
      const index = batchStart + offset;
      const account = await stakingLedger.getAccount(index);
      await assertAccountMatchesRoot(
        stakingLedger,
        account,
        index,
        lifecycleId,
        expectedRoot,
      );
      accounts.push(account);
    }
  }
}

/**
 * Derive the voting weights that the staking-to-voting ZK program commits to.
 * The cache key includes both the lifecycle and the verified staking root.
 */
export class StakingLedgerVoteWeightResolver {
  private readonly weightsByLifecycleRoot = new Map<
    string,
    Promise<ReadonlyMap<string, bigint>>
  >();

  public constructor(
    private readonly stakingLedgerServices: StakingLedgerServiceLookup,
  ) {}

  public async getVoteWeight(
    lifecycleId: string,
    expectedStakingLedgerRoot: string,
    voterPublicKey: string,
  ): Promise<bigint> {
    const cacheKey = `${lifecycleId}:${expectedStakingLedgerRoot}`;
    let weightsPromise = this.weightsByLifecycleRoot.get(cacheKey);
    if (!weightsPromise) {
      weightsPromise = this.loadWeights(lifecycleId, expectedStakingLedgerRoot);
      this.weightsByLifecycleRoot.set(cacheKey, weightsPromise);
    }

    try {
      const weights = await weightsPromise;
      return weights.get(voterPublicKey) ?? 0n;
    } catch (error) {
      if (this.weightsByLifecycleRoot.get(cacheKey) === weightsPromise) {
        this.weightsByLifecycleRoot.delete(cacheKey);
      }
      throw error;
    }
  }

  private async loadWeights(
    lifecycleId: string,
    expectedStakingLedgerRoot: string,
  ): Promise<ReadonlyMap<string, bigint>> {
    const stakingLedger =
      await this.stakingLedgerServices.getService(lifecycleId);
    await this.assertRoot(
      stakingLedger,
      lifecycleId,
      expectedStakingLedgerRoot,
    );
    const accounts = await readProgramAccountRange(
      stakingLedger,
      lifecycleId,
      expectedStakingLedgerRoot,
    );
    const weights = addDefaultTokenDelegations(accounts);
    // Detect an unexpected mutation while the local projection is derived.
    await this.assertRoot(
      stakingLedger,
      lifecycleId,
      expectedStakingLedgerRoot,
    );
    return weights;
  }

  private async assertRoot(
    stakingLedger: StakingLedgerService,
    lifecycleId: string,
    expectedStakingLedgerRoot: string,
  ): Promise<void> {
    const actualRoot = (await stakingLedger.getRootHash()).toString();
    if (actualRoot !== expectedStakingLedgerRoot) {
      throw new Error(
        `[proposal-processor] staking ledger root mismatch for lifecycleId=${lifecycleId}: expected=${expectedStakingLedgerRoot} actual=${actualRoot}`,
      );
    }
  }
}
