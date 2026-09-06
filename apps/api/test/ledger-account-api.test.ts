import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer } from "@repo/indexer";
import type {
  ArchiveEventEntity,
  EventsPageQuery,
  EventsRepository,
} from "@repo/indexer";
import { Account } from "@repo/sdk/src/provable/account.js";
import { PUBLIC_KEY_VALIDATION_ERROR } from "../src/public-key-validation.js";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  LIFECYCLE_ID_VALIDATION_ERROR,
  LifecycleStakingLedgerFileNotFoundError,
  LifecycleStakingLedgerServiceRegistry,
} from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";
import {
  STAKING_LEDGER_ACCOUNT_NOT_FOUND_ERROR,
  createStakingLedgerWitnessRoutes,
} from "../src/staking-ledger/staking-ledger-witness-routes.js";
import {
  LifecycleVotingLedgerFileNotFoundError,
  type VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import {
  createVotingLedgerAccountRoutes,
  type VotingLedgerAccountPayload,
} from "../src/voting-ledger/voting-ledger-account-routes.js";

const TEST_KEYS = {
  accountOne: "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB",
  accountTwo: "B62qq1miZzh8QMumJ2dhJSvPxdeShGQ2G2cH4YXwxNLpPSvKdRVTb3q",
  accountThree: "B62qq6f3enRpmGsWBaJMstwQjQiRdAnyAZ6CbKrcJFgFidRnWZyJkje",
} as const;

const accountCodec = Account as unknown as {
  toJSON(value: Account): Record<string, unknown>;
  fromJSON(value: Record<string, unknown>): Account;
  empty(): Account;
};

function createRepositoryStub(): EventsRepository {
  return {
    async initialize(): Promise<void> {},
    async close(): Promise<void> {},
    async getEventsPage(
      _query: EventsPageQuery,
    ): Promise<ArchiveEventEntity[]> {
      return [];
    },
  } as unknown as EventsRepository;
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Unable to resolve ephemeral port")),
        );
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function createAccountRow(
  publicKey: string,
  delegatePublicKey: string,
  balance = "0",
): Account {
  const baseAccount = accountCodec.toJSON(accountCodec.empty());
  return accountCodec.fromJSON({
    ...baseAccount,
    pk: publicKey,
    delegate: delegatePublicKey,
    balance,
  });
}

describe("ledger account endpoints", () => {
  let server: EventsApiServer | null = null;
  let stakingServices: LifecycleStakingLedgerServiceRegistry | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (stakingServices) {
      await stakingServices.close();
      stakingServices = null;
    }
  });

  it("returns staking account by public key", async () => {
    const lifecycleId = "42";
    const accountPublicKey = TEST_KEYS.accountOne;
    const delegatePublicKey = TEST_KEYS.accountTwo;
    const anotherPublicKey = TEST_KEYS.accountThree;

    const accounts = [
      createAccountRow(anotherPublicKey, anotherPublicKey, "1"),
      createAccountRow(accountPublicKey, delegatePublicKey, "999"),
    ];

    stakingServices = new LifecycleStakingLedgerServiceRegistry(() => ({
      async start(): Promise<void> {},
      async hydrateAccounts(): Promise<void> {},
      async hydrateMerkleTree(): Promise<void> {},
      async getAllAccounts(): Promise<Account[]> {
        return accounts;
      },
      async getAccount(): Promise<Account> {
        return accountCodec.empty();
      },
      async getAccountByPublicKey(
        publicKey: string,
      ): Promise<{ index: bigint; account: Account } | null> {
        const index = accounts.findIndex(
          (account) => accountCodec.toJSON(account).pk === publicKey,
        );
        if (index < 0) {
          return null;
        }
        return {
          index: BigInt(index),
          account: accounts[index],
        };
      },
      async getWitness(): Promise<never> {
        throw new Error("not used");
      },
      async getRootHash(): Promise<never> {
        throw new Error("not used");
      },
      async close(): Promise<void> {},
    }));

    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createStakingLedgerWitnessRoutes({
        stakingLedgerServices: stakingServices,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/staking-ledger/lifecycles/${lifecycleId}/accounts/${encodeURIComponent(
        accountPublicKey,
      )}`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      lifecycleId: string;
      publicKey: string;
      index: string;
      balance: string;
      delegatePublicKey: string;
      account: {
        pk?: string;
      };
    };
    assert.equal(payload.lifecycleId, lifecycleId);
    assert.equal(payload.publicKey, accountPublicKey);
    assert.equal(payload.index, "1");
    assert.equal(payload.balance, "999");
    assert.equal(payload.delegatePublicKey, delegatePublicKey);
    assert.equal(payload.account.pk, accountPublicKey);
  });

  it("returns 404 when staking account public key is missing", async () => {
    stakingServices = new LifecycleStakingLedgerServiceRegistry(() => ({
      async start(): Promise<void> {},
      async hydrateAccounts(): Promise<void> {},
      async hydrateMerkleTree(): Promise<void> {},
      async getAllAccounts(): Promise<Account[]> {
        return [];
      },
      async getAccount(): Promise<Account> {
        return accountCodec.empty();
      },
      async getAccountByPublicKey(): Promise<{
        index: bigint;
        account: Account;
      } | null> {
        return null;
      },
      async getWitness(): Promise<never> {
        throw new Error("not used");
      },
      async getRootHash(): Promise<never> {
        throw new Error("not used");
      },
      async close(): Promise<void> {},
    }));

    const lifecycleId = "12";
    const accountPublicKey = TEST_KEYS.accountOne;
    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createStakingLedgerWitnessRoutes({
        stakingLedgerServices: stakingServices,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/staking-ledger/lifecycles/${lifecycleId}/accounts/${encodeURIComponent(
        accountPublicKey,
      )}`,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: STAKING_LEDGER_ACCOUNT_NOT_FOUND_ERROR,
      lifecycleId,
      publicKey: accountPublicKey,
    });
  });

  it("returns voting-ledger account by public key", async () => {
    const lifecycleId = "7";
    const accountPublicKey = TEST_KEYS.accountOne;
    const voteWeight = 12345n;
    const votingLookup: VotingLedgerServiceLookup = {
      async getService(): Promise<{
        start(): Promise<void>;
        getVoteWeight(voterPublicKey: string): Promise<bigint>;
        close(): Promise<void>;
      }> {
        return {
          async start(): Promise<void> {},
          async getVoteWeight(voterPublicKey: string): Promise<bigint> {
            return voterPublicKey === accountPublicKey ? voteWeight : 0n;
          },
          async close(): Promise<void> {},
        };
      },
    };

    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createVotingLedgerAccountRoutes({
        votingLedgerServices: votingLookup,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/voting-ledger/lifecycles/${lifecycleId}/accounts/${encodeURIComponent(
        accountPublicKey,
      )}`,
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as VotingLedgerAccountPayload;
    assert.equal(payload.lifecycleId, lifecycleId);
    assert.equal(payload.publicKey, accountPublicKey);
    assert.equal(payload.voteWeight, voteWeight.toString());
    assert.equal(payload.account.balance, voteWeight.toString());
  });

  it("returns 404 when voting-ledger lifecycle sqlite file is missing", async () => {
    const lifecycleId = "99";
    const accountPublicKey = TEST_KEYS.accountTwo;
    const votingLookup: VotingLedgerServiceLookup = {
      async getService(resolvedLifecycleId: string): Promise<never> {
        throw new LifecycleVotingLedgerFileNotFoundError(resolvedLifecycleId);
      },
    };

    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createVotingLedgerAccountRoutes({
        votingLedgerServices: votingLookup,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/voting-ledger/lifecycles/${lifecycleId}/accounts/${encodeURIComponent(
        accountPublicKey,
      )}`,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: LIFECYCLE_DATA_UNAVAILABLE_ERROR,
      lifecycleId,
    });
  });

  it("returns 400 for invalid lifecycle id or public key", async () => {
    stakingServices = new LifecycleStakingLedgerServiceRegistry(() => {
      throw new LifecycleStakingLedgerFileNotFoundError("0");
    });
    const votingLookup: VotingLedgerServiceLookup = {
      async getService(): Promise<never> {
        throw new Error("not used");
      },
    };

    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: (app) => {
        createStakingLedgerWitnessRoutes({
          stakingLedgerServices: stakingServices!,
        })(app);
        createVotingLedgerAccountRoutes({
          votingLedgerServices: votingLookup,
        })(app);
      },
    });
    await server.start();

    const invalidLifecycleResponse = await fetch(
      `http://127.0.0.1:${port}/voting-ledger/lifecycles/not-a-number/accounts/abc`,
    );
    assert.equal(invalidLifecycleResponse.status, 400);
    assert.deepEqual(await invalidLifecycleResponse.json(), {
      error: LIFECYCLE_ID_VALIDATION_ERROR,
    });

    const overflowLifecycleResponse = await fetch(
      `http://127.0.0.1:${port}/voting-ledger/lifecycles/4294967296/accounts/abc`,
    );
    assert.equal(overflowLifecycleResponse.status, 400);
    assert.deepEqual(await overflowLifecycleResponse.json(), {
      error: LIFECYCLE_ID_VALIDATION_ERROR,
    });

    const validLifecycleId = "1";
    const invalidPublicKeyResponse = await fetch(
      `http://127.0.0.1:${port}/staking-ledger/lifecycles/${validLifecycleId}/accounts/not-a-public-key`,
    );
    assert.equal(invalidPublicKeyResponse.status, 400);
    assert.deepEqual(await invalidPublicKeyResponse.json(), {
      error: PUBLIC_KEY_VALIDATION_ERROR,
    });
  });
});
