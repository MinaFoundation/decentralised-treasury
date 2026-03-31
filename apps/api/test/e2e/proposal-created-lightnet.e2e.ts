import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AccountUpdate,
  Field,
  Lightnet,
  Mina,
  PublicKey,
  PrivateKey,
  TokenId,
  UInt32,
  UInt64,
  fetchAccount,
} from "o1js";
import type { DataSource } from "typeorm";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  ProposalCreatedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import {
  ArchiveClient,
  EventsApiServer,
  EventsIndexer,
  EventsRepository,
} from "@repo/indexer";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
  ProcessorCrudApiServer,
} from "@repo/processor";
import { ProposalCreatedEventHandler } from "../../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalEntity } from "../../src/processors/proposals/proposal-entity.js";
import { createInMemoryDataSource } from "../support/create-in-memory-data-source.js";
import { LightnetProposalCreatedFixtureContract } from "../contracts/lightnet-proposal-created-fixture-contract.js";
import {
  ensureLightnetReady,
} from "../../../cli/test/utils/cli-test-utils.js";

const RUN_LIGHTNET_E2E = process.env.RUN_LIGHTNET_E2E === "true";
const MINA_NODE_URL = process.env.MINA_NODE_URL ?? "http://127.0.0.1:8080/graphql";
const ARCHIVE_NODE_URL = process.env.ARCHIVE_NODE_URL ?? "http://127.0.0.1:8282";
const LIGHTNET_ACCOUNT_MANAGER_ENDPOINT =
  process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT ?? "http://127.0.0.1:8181";
const ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;
const TX_FEE = UInt64.from(200_000_000);
const LIGHTNET_STARTUP_TIMEOUT_MS = 600_000;
const SENDER_ACQUIRE_ATTEMPTS = 10;
const SENDER_ACQUIRE_RETRY_DELAY_MS = 1_000;
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROCESSOR_CRUD_API_PORT = 4_101;
const PROCESSOR_CRUD_API_URL = `http://127.0.0.1:${PROCESSOR_CRUD_API_PORT}/v1/processor`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommandIgnoreFailure(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: "pipe",
    });

    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      resolve("");
    });
    child.on("close", () => {
      resolve(stdout);
    });
  });
}

async function forceStopLightnetAtTestStart(): Promise<void> {
  await runCommandIgnoreFailure("pnpm", [
    "--filter",
    "@repo/sdk",
    "exec",
    "zkapp-cli",
    "lightnet",
    "stop",
  ]);

  const containerIdsOutput = await runCommandIgnoreFailure("docker", [
    "ps",
    "--filter",
    "name=lightnet",
    "--format",
    "{{.ID}}",
  ]);
  const containerIds = containerIdsOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const containerId of containerIds) {
    await runCommandIgnoreFailure("docker", ["rm", "-f", containerId]);
  }
}

async function resolveFreshSenderPrivateKey(): Promise<PrivateKey> {
  for (let attempt = 0; attempt < SENDER_ACQUIRE_ATTEMPTS; attempt += 1) {
    const acquired = await Lightnet.acquireKeyPair({
      lightnetAccountManagerEndpoint: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    });
    const senderPrivateKey =
      typeof acquired.privateKey === "string"
        ? PrivateKey.fromBase58(acquired.privateKey)
        : acquired.privateKey;
    const senderPublicKey = senderPrivateKey.toPublicKey();
    const senderAccount = await fetchAccount({ publicKey: senderPublicKey });

    if (!senderAccount.error && senderAccount.account) {
      const nonce = Number(senderAccount.account.nonce.toBigint());
      if (nonce === 0) {
        return senderPrivateKey;
      }
    }

    await sleep(SENDER_ACQUIRE_RETRY_DELAY_MS);
  }

  throw new Error(
    "Unable to acquire a fresh sender account (nonce=0) from Lightnet",
  );
}

interface SenderNonceDiagnostics {
  accountNonce: string | null;
  inferredNonce: string | null;
  senderPooledCommands: Array<{
    nonce: string | null;
    hash: string | null;
    memo: string | null;
  }>;
  graphqlErrors: string[] | null;
}

async function fetchSenderNonceDiagnostics(
  senderPublicKeyBase58: string,
): Promise<SenderNonceDiagnostics> {
  try {
    const response = await fetch(MINA_NODE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query SenderNonceDiagnostics($publicKey: String!) {
            account(publicKey: $publicKey) {
              nonce
              inferredNonce
            }
            pooledUserCommands {
              from
              nonce
              hash
              memo
            }
          }
        `,
        variables: {
          publicKey: senderPublicKeyBase58,
        },
      }),
    });
    if (!response.ok) {
      return {
        accountNonce: null,
        inferredNonce: null,
        senderPooledCommands: [],
        graphqlErrors: [`HTTP ${response.status}`],
      };
    }
    const payload = (await response.json()) as {
      data?: {
        account?: {
          nonce?: string | null;
          inferredNonce?: string | null;
        } | null;
        pooledUserCommands?: Array<{
          from?: string | null;
          nonce?: string | null;
          hash?: string | null;
          memo?: string | null;
        }> | null;
      } | null;
      errors?: Array<{ message?: string }> | null;
    };
    const allPooledCommands = payload.data?.pooledUserCommands ?? [];
    const senderPooledCommands = allPooledCommands
      .filter((command) => command.from === senderPublicKeyBase58)
      .map((command) => ({
        nonce: command.nonce ?? null,
        hash: command.hash ?? null,
        memo: command.memo ?? null,
      }));

    return {
      accountNonce: payload.data?.account?.nonce ?? null,
      inferredNonce: payload.data?.account?.inferredNonce ?? null,
      senderPooledCommands,
      graphqlErrors:
        payload.errors?.map((error) => error.message ?? "unknown graphql error") ?? null,
    };
  } catch (error) {
    return {
      accountNonce: null,
      inferredNonce: null,
      senderPooledCommands: [],
      graphqlErrors: [String(error)],
    };
  }
}

async function logSenderNonceDiagnostics(
  label: string,
  senderPublicKey: PublicKey,
): Promise<void> {
  const senderPublicKeyBase58 = senderPublicKey.toBase58();
  const account = await fetchAccount({
    publicKey: senderPublicKey,
  }).catch(() => null);
  const graphqlDiagnostics = await fetchSenderNonceDiagnostics(senderPublicKeyBase58);
  console.log(
    "[lightnet-e2e] sender nonce diagnostics",
    JSON.stringify(
      {
        label,
        senderPublicKey: senderPublicKeyBase58,
        o1jsFetchAccountError: account?.error ?? null,
        o1jsAccountNonce: account?.account ? Number(account.account.nonce.toBigint()) : null,
        graphqlDiagnostics,
      },
      null,
      2,
    ),
  );
}

interface ProposalCrudRow {
  proposalPublicKey: string;
  lifecycleId: number;
  amount: string;
  recipient: string;
  zkAppUriHash: string;
}

function extractCrudItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const maybeObject = payload as { data?: unknown; items?: unknown };
  if (Array.isArray(maybeObject.data)) {
    return maybeObject.data as T[];
  }
  if (Array.isArray(maybeObject.items)) {
    return maybeObject.items as T[];
  }
  return [];
}

async function fetchProjectedProposalFromCrudApi(
  proposalPublicKey: string,
): Promise<ProposalCrudRow | null> {
  try {
    const response = await fetch(`${PROCESSOR_CRUD_API_URL}/proposals?limit=50`);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as unknown;
    const items = extractCrudItems<ProposalCrudRow>(payload);
    return (
      items.find((proposal) => proposal.proposalPublicKey === proposalPublicKey) ??
      null
    );
  } catch {
    return null;
  }
}

describe("lightnet e2e: ProposalCreated pipeline", { skip: !RUN_LIGHTNET_E2E }, () => {
  let lightnetProcess: ChildProcess | undefined;

  before(async () => {
    await forceStopLightnetAtTestStart();
    lightnetProcess = await ensureLightnetReady(LIGHTNET_STARTUP_TIMEOUT_MS);
    Mina.setActiveInstance(
      Mina.Network({
        mina: MINA_NODE_URL,
        archive: ARCHIVE_NODE_URL,
        lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
      }),
    );
  });

  after(() => {
    lightnetProcess?.kill("SIGTERM");
  });

  it(
    "dispatches proposalCreated and projects a proposal row",
    { timeout: 600_000 },
    async () => {
      const senderPrivateKey = await resolveFreshSenderPrivateKey();
      const senderPublicKey = senderPrivateKey.toPublicKey();
      const senderPublicKeyBase58 = senderPublicKey.toBase58();
      const senderAccount = await fetchAccount({ publicKey: senderPublicKey });
      if (senderAccount.error) {
        throw new Error(
          `Sender account is not available on lightnet: ${String(senderAccount.error)}`,
        );
      }
      if (!senderAccount.account) {
        throw new Error("Sender account payload is missing account data");
      }

      const deployTargetPrivateKey = PrivateKey.random();
      const deployTargetPublicKey = deployTargetPrivateKey.toPublicKey();
      const fixtureContract = new LightnetProposalCreatedFixtureContract(
        deployTargetPublicKey,
      );

      await LightnetProposalCreatedFixtureContract.compile();
      await logSenderNonceDiagnostics("before-deploy-send", senderPublicKey);

      const deployTx = await Mina.transaction(
        {
          sender: senderPublicKey,
          fee: TX_FEE,
          memo: "api-e2e-proposal-created-deploy",
        },
        async () => {
          AccountUpdate.fundNewAccount(senderPublicKey, 1);
          await fixtureContract.deploy();
        },
      );
      deployTx.sign([senderPrivateKey, deployTargetPrivateKey]);
      const deployPending = await deployTx.send();
      assert.ok(deployPending, "expected deploy transaction to be accepted");
      try {
        await deployPending.wait();
      } catch (error) {
        await logSenderNonceDiagnostics("deploy-wait-failed", senderPublicKey);
        throw error;
      }
      const contractAccountAfterDeploy = await fetchAccount({
        publicKey: deployTargetPublicKey,
      });
      if (contractAccountAfterDeploy.error || !contractAccountAfterDeploy.account) {
        throw new Error(
          `Expected deployed contract account to be fetchable before emit, got: ${String(contractAccountAfterDeploy.error)}`,
        );
      }

      const proposalPayload = new ProposalCreatedEvent({
        proposalPublicKey: PrivateKey.random().toPublicKey(),
        lifecycleId: UInt32.from(3),
        amount: UInt64.from(250_000_000),
        recipient: PrivateKey.random().toPublicKey(),
        zkAppUriHash: Field(123456789),
      });
      const expectedProposal = {
        proposalPublicKey: proposalPayload.proposalPublicKey.toBase58(),
        lifecycleId: Number(proposalPayload.lifecycleId.toBigint()),
        amount: proposalPayload.amount.toString(),
        recipient: proposalPayload.recipient.toBase58(),
        zkAppUriHash: proposalPayload.zkAppUriHash.toString(),
      };

      const archiveClient = new ArchiveClient(ARCHIVE_NODE_URL, {
        treasuryOwnerContractAddress: deployTargetPublicKey.toBase58(),
        // SmartContract (non-token-contract) events live under the default token id.
        treasuryOwnerTokenId: TokenId.toBase58(Field(1)),
        archiveRequestTimeoutMs: ARCHIVE_REQUEST_TIMEOUT_MS,
      });
      const initialHeights = await archiveClient.getMaxBlockHeights();
      await logSenderNonceDiagnostics("before-emit-send", senderPublicKey);

      const emitTx = await Mina.transaction(
        {
          sender: senderPublicKey,
          fee: TX_FEE,
          memo: "api-e2e-proposal-created-emit",
        },
        async () => {
          await fixtureContract.emitProposalCreated(proposalPayload);
        },
      );
      emitTx.sign([senderPrivateKey, deployTargetPrivateKey]);
      const emitPending = await emitTx.send();
      assert.ok(emitPending, "expected emit transaction to be accepted");
      try {
        await emitPending.wait();
      } catch (error) {
        await logSenderNonceDiagnostics("emit-wait-failed", senderPublicKey);
        throw error;
      }

      let dataSource: DataSource | null = null;
      let indexer: EventsIndexer | null = null;
      let eventsApiServer: EventsApiServer | null = null;
      let repository: EventsRepository | null = null;
      let processor: EventsProcessor | null = null;
      let processorCrudApiServer: ProcessorCrudApiServer | null = null;

      try {
        dataSource = createInMemoryDataSource("public", [ProposalEntity]);
        repository = new EventsRepository(dataSource, "public", {
          knownEventTypes: [PROPOSAL_CREATED_EVENT_NAME],
        });
        await repository.initialize();
        await dataSource.synchronize();

        indexer = new EventsIndexer(archiveClient, repository, {
          pollPendingIntervalMs: 2_000,
          pollCanonicalIntervalMs: 5_000,
          blockBatchSize: 10,
          canonicalOverlapBlocks: 100,
          orphanDepthBlocks: 30,
        });
        eventsApiServer = new EventsApiServer(repository, {
          port: 4100,
          pageLimitDefault: 50,
          pageLimitMax: 200,
        });
        processor = new EventsProcessor(
          dataSource,
          new EventProcessorRouter([new ProposalCreatedEventHandler()]),
          {
            processorName: "proposal-processor-lightnet-e2e",
            pollIntervalMs: 2_000,
            batchSize: 200,
          },
          new IndexerEventsApiClient({
            indexerApiUrl: "http://127.0.0.1:4100",
          }),
        );
        processorCrudApiServer = new ProcessorCrudApiServer({
          dataSource,
          port: PROCESSOR_CRUD_API_PORT,
          routePrefix: "v1/processor",
          pageLimitDefault: 50,
          pageLimitMax: 200,
          outputEntitySchemas: [ProposalEntity],
          readOnly: true,
        });

        await repository.setCursor(
          EventsIndexer.PENDING_CURSOR,
          Math.max(0, initialHeights.pendingMaxBlockHeight - 1),
        );
        await repository.setCursor(
          EventsIndexer.CANONICAL_CURSOR,
          Math.max(0, initialHeights.canonicalMaxBlockHeight - 1),
        );

        await indexer.start();
        await eventsApiServer.start();
        await processor.start();
        await processorCrudApiServer.start();

        const pollDeadline = Date.now() + 120_000;
        let projectedProposal: ProposalCrudRow | null = null;

        while (Date.now() < pollDeadline) {
          projectedProposal = await fetchProjectedProposalFromCrudApi(
            expectedProposal.proposalPublicKey,
          );
          if (projectedProposal) {
            break;
          }
          await sleep(2_000);
        }

        assert.ok(
          projectedProposal,
          `Expected ${PROPOSAL_CREATED_EVENT_NAME} emitted at ${deployTargetPublicKey.toBase58()} to reach processor projection`,
        );
        assert.equal(
          projectedProposal?.proposalPublicKey,
          expectedProposal.proposalPublicKey,
        );
        assert.equal(projectedProposal?.lifecycleId, expectedProposal.lifecycleId);
        assert.equal(projectedProposal?.amount, expectedProposal.amount);
        assert.equal(projectedProposal?.recipient, expectedProposal.recipient);
        assert.equal(projectedProposal?.zkAppUriHash, expectedProposal.zkAppUriHash);
      } finally {
        if (processorCrudApiServer) {
          await processorCrudApiServer.stop();
        }
        if (processor) {
          await processor.stop();
        }
        if (eventsApiServer) {
          await eventsApiServer.stop();
        }
        if (indexer) {
          await indexer.stop();
        }
        if (repository) {
          await repository.close();
        }
        await Lightnet.releaseKeyPair({
          publicKey: senderPublicKeyBase58,
          lightnetAccountManagerEndpoint: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
        }).catch(() => null);
      }
    },
  );
});
