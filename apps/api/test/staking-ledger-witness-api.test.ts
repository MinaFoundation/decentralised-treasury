import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EventsApiServer } from "@repo/indexer";
import type { ArchiveEventEntity, EventsPageQuery, EventsRepository } from "@repo/indexer";
import { Account, packToFields } from "@repo/sdk/src/provable/account.js";
import { hashWithPrefix } from "@repo/sdk/src/provable/hashing-helpers.js";
import { PrefixedMerkleWitness36 } from "@repo/sdk/src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "@repo/sdk/src/ledgers/staking-ledger/staking-ledger.js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  LIFECYCLE_ID_VALIDATION_ERROR,
  LifecycleStakingLedgerFileNotFoundError,
  LifecycleStakingLedgerServiceRegistry,
} from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";
import {
  createStakingLedgerWitnessRoutes,
  type StakingLedgerWitnessPayload,
} from "../src/staking-ledger/staking-ledger-witness-routes.js";

const LIGHTNET_STAKING_LEDGER_PATH = fileURLToPath(
  new URL("../../cli/test/fixtures/staking-epoch-ledger-lightnet.json", import.meta.url),
);
const TEST_LIFECYCLE_ID = "42";
const TEST_WITNESS_INDEX = 9;

function createRepositoryStub(): EventsRepository {
  return {
    async initialize(): Promise<void> {},
    async close(): Promise<void> {},
    async getEventsPage(_query: EventsPageQuery): Promise<ArchiveEventEntity[]> {
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
        server.close(() => {
          reject(new Error("Unable to resolve ephemeral port"));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function fetchWitnessPayload(
  port: number,
  lifecycleId: string,
  index: number,
): Promise<StakingLedgerWitnessPayload> {
  const response = await fetch(
    `http://127.0.0.1:${port}/staking-ledger/lifecycles/${encodeURIComponent(
      lifecycleId,
    )}/witnesses/${index}`,
  );
  assert.equal(response.status, 200);
  return (await response.json()) as StakingLedgerWitnessPayload;
}

function computeRootFromWitnessPayload(payload: StakingLedgerWitnessPayload): string {
  const account = Account.fromJSON(payload.account);
  const witness = PrefixedMerkleWitness36.fromJSON(payload.witness);
  const leaf = hashWithPrefix(
    accountHashPrefix,
    packToFields(Account.toHashInput(account)),
  );
  return witness.calculateRoot(leaf, accountLedgerHashPrefixes).toString();
}

describe("staking ledger witness endpoint", () => {
  let server: EventsApiServer | null = null;
  let stakingLedgerServices: LifecycleStakingLedgerServiceRegistry | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (stakingLedgerServices) {
      await stakingLedgerServices.close();
      stakingLedgerServices = null;
    }
  });

  it(
    "returns witness data from full lightnet staking epoch ledger in memory",
    { timeout: 120_000 },
    async () => {
      const port = await getAvailablePort();
      const services = new LifecycleStakingLedgerServiceRegistry((lifecycleId) =>
        new SqliteStakingLedgerService({
          lifecycleId,
          inMemory: true,
        }),
      );
      stakingLedgerServices = services;

      const service = await services.getService(TEST_LIFECYCLE_ID);
      await service.hydrateAccounts({
        stakingLedgerPath: LIGHTNET_STAKING_LEDGER_PATH,
      });
      await service.hydrateMerkleTree();
      const expectedRoot = (await service.getRootHash()).toString();

      server = new EventsApiServer(createRepositoryStub(), {
        port,
        pageLimitDefault: 50,
        pageLimitMax: 200,
        registerRoutes: createStakingLedgerWitnessRoutes({
          stakingLedgerServices: services,
        }),
        onStop: async () => {
          await services.close();
        },
      });
      await server.start();

      const payload = await fetchWitnessPayload(
        port,
        TEST_LIFECYCLE_ID,
        TEST_WITNESS_INDEX,
      );
      const computedRoot = computeRootFromWitnessPayload(payload);

      assert.equal(computedRoot, expectedRoot);
    },
  );

  it("returns 404 when lifecycle sqlite file is missing", async () => {
    const port = await getAvailablePort();
    const services = new LifecycleStakingLedgerServiceRegistry((lifecycleId) => {
      throw new LifecycleStakingLedgerFileNotFoundError(lifecycleId);
    });
    stakingLedgerServices = services;

    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createStakingLedgerWitnessRoutes({
        stakingLedgerServices: services,
      }),
      onStop: async () => {
        await services.close();
      },
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/staking-ledger/lifecycles/999/witnesses/0`,
    );
    assert.equal(response.status, 404);
    const payload = (await response.json()) as {
      error?: string;
      lifecycleId?: string;
    };
    assert.deepEqual(payload, {
      error: LIFECYCLE_DATA_UNAVAILABLE_ERROR,
      lifecycleId: "999",
    });
  });

  it("returns 400 when lifecycle id is not an unsigned 64-bit integer", async () => {
    const port = await getAvailablePort();
    const services = new LifecycleStakingLedgerServiceRegistry((lifecycleId) =>
      new SqliteStakingLedgerService({
        lifecycleId,
        inMemory: true,
      }),
    );
    stakingLedgerServices = services;

    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createStakingLedgerWitnessRoutes({
        stakingLedgerServices: services,
      }),
      onStop: async () => {
        await services.close();
      },
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/staking-ledger/lifecycles/not-a-number/witnesses/0`,
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as {
      error?: string;
    };
    assert.deepEqual(payload, {
      error: LIFECYCLE_ID_VALIDATION_ERROR,
    });
  });
});
