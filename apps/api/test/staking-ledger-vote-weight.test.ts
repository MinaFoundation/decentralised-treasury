import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "@repo/sdk/src/provable/account.js";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";
import { Field, PrivateKey, PublicKey, TokenId, UInt64 } from "o1js";
import { StakingLedgerVoteWeightResolver } from "../src/processors/proposals/staking-ledger-vote-weight.js";
import type { StakingLedgerServiceLookup } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;

function stakingAccount(input: {
  delegate: PublicKey;
  balance: bigint;
  tokenId?: Field;
}): Account {
  const account = Account.empty();
  account.pk = PrivateKey.random().toPublicKey();
  account.delegate = input.delegate;
  account.balance = UInt64.from(input.balance);
  account.tokenId = input.tokenId ?? TokenId.default;
  return account;
}

function createResolver(
  ledgers: Map<
    string,
    {
      root: string;
      accounts: Account[];
      accountWitnessRoot?: string;
      emptyWitnessRoot?: string;
    }
  >,
): {
  resolver: StakingLedgerVoteWeightResolver;
  lookups: string[];
} {
  const lookups: string[] = [];
  const services: StakingLedgerServiceLookup = {
    async getService(lifecycleId) {
      lookups.push(lifecycleId);
      const ledger = ledgers.get(lifecycleId);
      assert.ok(ledger, `missing test ledger for lifecycle ${lifecycleId}`);
      return {
        async getRootHash() {
          return Field(ledger.root);
        },
        async getAllAccounts() {
          return ledger.accounts;
        },
        async getAccount(index: bigint) {
          return ledger.accounts[Number(index)] ?? Account.empty();
        },
        async getWitness(index: bigint) {
          const root =
            index < BigInt(ledger.accounts.length)
              ? (ledger.accountWitnessRoot ?? ledger.root)
              : (ledger.emptyWitnessRoot ?? ledger.root);
          return {
            calculateIndex: () => Field(index),
            calculateRoot: () => Field(root),
          } as never;
        },
      } as unknown as StakingLedgerService;
    },
  };
  return {
    resolver: new StakingLedgerVoteWeightResolver(services),
    lookups,
  };
}

describe("staking-ledger vote-weight derivation", () => {
  it("aggregates all default-token balances delegated to one voter", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const otherVoter = PrivateKey.random().toPublicKey();
    const root = Field(101).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "1",
          {
            root,
            accounts: [
              stakingAccount({ delegate: voter, balance: 7n }),
              stakingAccount({ delegate: otherVoter, balance: 20n }),
              stakingAccount({ delegate: voter, balance: 13n }),
            ],
          },
        ],
      ]),
    );

    assert.equal(
      await resolver.getVoteWeight("1", root, voter.toBase58()),
      20n,
    );
  });

  it("excludes custom-token balances even when they use the same delegate", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(202).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "2",
          {
            root,
            accounts: [
              stakingAccount({ delegate: voter, balance: 11n }),
              stakingAccount({
                delegate: voter,
                balance: 999n,
                tokenId: Field(88_002),
              }),
            ],
          },
        ],
      ]),
    );

    assert.equal(
      await resolver.getVoteWeight("2", root, voter.toBase58()),
      11n,
    );
  });

  it("returns zero for a zero-balance or missing voter", async () => {
    const zeroVoter = PrivateKey.random().toPublicKey();
    const missingVoter = PrivateKey.random().toPublicKey();
    const root = Field(303).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "3",
          {
            root,
            accounts: [stakingAccount({ delegate: zeroVoter, balance: 0n })],
          },
        ],
      ]),
    );

    assert.equal(
      await resolver.getVoteWeight("3", root, zeroVoter.toBase58()),
      0n,
    );
    assert.equal(
      await resolver.getVoteWeight("3", root, missingVoter.toBase58()),
      0n,
    );
  });

  it("rejects an aggregate delegate balance above UInt64", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(404).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "4",
          {
            root,
            accounts: [
              stakingAccount({ delegate: voter, balance: UINT64_MAX }),
              stakingAccount({ delegate: voter, balance: 1n }),
            ],
          },
        ],
      ]),
    );

    await assert.rejects(
      resolver.getVoteWeight("4", root, voter.toBase58()),
      /aggregated vote weight.*must be in the UInt64 range/,
    );
  });

  it("rejects a lifecycle ledger that does not match the proposal root", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const expectedRoot = Field(505).toString();
    const actualRoot = Field(506).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "5",
          {
            root: actualRoot,
            accounts: [stakingAccount({ delegate: voter, balance: 5n })],
          },
        ],
      ]),
    );

    await assert.rejects(
      resolver.getVoteWeight("5", expectedRoot, voter.toBase58()),
      new RegExp(
        `root mismatch.*expected=${expectedRoot} actual=${actualRoot}`,
      ),
    );
  });

  it("rejects account rows that are not committed by the verified root", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(507).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "5",
          {
            root,
            accountWitnessRoot: Field(508).toString(),
            accounts: [stakingAccount({ delegate: voter, balance: 5n })],
          },
        ],
      ]),
    );

    await assert.rejects(
      resolver.getVoteWeight("5", root, voter.toBase58()),
      /staking account witness does not match ledger root.*index=0/,
    );
  });

  it("rejects an invalid empty padding witness inside the final program batch", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(509).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "5",
          {
            root,
            emptyWitnessRoot: Field(510).toString(),
            accounts: [stakingAccount({ delegate: voter, balance: 5n })],
          },
        ],
      ]),
    );

    await assert.rejects(
      resolver.getVoteWeight("5", root, voter.toBase58()),
      /staking account witness does not match ledger root.*index=1/,
    );
  });

  it("includes a later account after empty padding in a processed program batch", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(511).toString();
    const { resolver } = createResolver(
      new Map([
        [
          "5",
          {
            root,
            accounts: [
              stakingAccount({ delegate: voter, balance: 3n }),
              Account.empty(),
              Account.empty(),
              stakingAccount({ delegate: voter, balance: 8n }),
            ],
          },
        ],
      ]),
    );

    assert.equal(
      await resolver.getVoteWeight("5", root, voter.toBase58()),
      11n,
    );
  });

  it("checks exhaustion at the next fixed-size program batch boundary", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const root = Field(512).toString();
    const accounts = [stakingAccount({ delegate: voter, balance: 3n })];
    const lookups: bigint[] = [];
    const services: StakingLedgerServiceLookup = {
      async getService() {
        return {
          async getRootHash() {
            return Field(root);
          },
          async getAccount(index: bigint) {
            lookups.push(index);
            return accounts[Number(index)] ?? Account.empty();
          },
          async getWitness(index: bigint) {
            return {
              calculateIndex: () => Field(index),
              calculateRoot: () => Field(root),
            } as never;
          },
        } as unknown as StakingLedgerService;
      },
    };

    const resolver = new StakingLedgerVoteWeightResolver(services);
    assert.equal(await resolver.getVoteWeight("5", root, voter.toBase58()), 3n);
    assert.deepEqual(lookups, [0n, 1n, 2n, 3n, 4n, 5n]);
  });

  it("isolates cached weights by lifecycle and staking root", async () => {
    const voter = PrivateKey.random().toPublicKey();
    const rootA = Field(601).toString();
    const rootB = Field(602).toString();
    const { resolver, lookups } = createResolver(
      new Map([
        [
          "6",
          {
            root: rootA,
            accounts: [stakingAccount({ delegate: voter, balance: 6n })],
          },
        ],
        [
          "7",
          {
            root: rootB,
            accounts: [stakingAccount({ delegate: voter, balance: 17n })],
          },
        ],
      ]),
    );

    assert.equal(
      await resolver.getVoteWeight("6", rootA, voter.toBase58()),
      6n,
    );
    assert.equal(
      await resolver.getVoteWeight("7", rootB, voter.toBase58()),
      17n,
    );
    assert.equal(
      await resolver.getVoteWeight("6", rootA, voter.toBase58()),
      6n,
    );
    assert.deepEqual(lookups, ["6", "7"]);
  });
});
