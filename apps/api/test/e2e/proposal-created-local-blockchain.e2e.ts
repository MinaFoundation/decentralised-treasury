import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AccountUpdate,
  Field,
  fetchAccount,
  Mina,
  PrivateKey,
  UInt32,
  UInt64,
  UInt128,
  TokenId,
} from "o1js";
import type { DataSource } from "typeorm";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  ProposalCreatedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { TreasuryProposalSmartContract } from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  ArchiveEventEntity,
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
import { ProposalExecutionEntity } from "../../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../../src/processors/proposals/proposal-entity.js";
import { VoteEntity } from "../../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "../support/create-in-memory-data-source.js";
import { LightnetProposalCreatedFixtureContract } from "../contracts/lightnet-proposal-created-fixture-contract.js";

const RUN_LOCAL_BLOCKCHAIN_E2E = process.env.RUN_LOCAL_BLOCKCHAIN_E2E === "true";
const ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;
const TX_FEE = UInt64.from(200_000_000);
const LOCAL_BLOCKCHAIN_PACKAGE_DIRECTORY = fileURLToPath(
  new URL("../../../../packages/local-blockchain", import.meta.url),
);
const LOCAL_BLOCKCHAIN_LOADER_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/node_modules/ts-node/esm.mjs", import.meta.url),
);
const LOCAL_BLOCKCHAIN_SERVER_ENTRY_POINT = fileURLToPath(
  new URL("../../../../packages/local-blockchain/src/server.ts", import.meta.url),
);
const LOCAL_BLOCKCHAIN_PROOF_ENV = {
  PROOFS_ENABLED: "false",
} as const;

interface AdminStateResponse {
  ok: boolean;
  currentSlot: number;
  blockchainLength: number;
  totalCurrency: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
  submittedTransactions: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

interface ProposalCrudRow {
  proposalPublicKey: string;
  lifecycleId: number;
  amount: string;
  recipient: string;
  zkAppUriHash: string;
  stakingEpochDataLedgerHash: string | null;
  stakingEpochDataLedgerTotalCurrency: string | null;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  createdAtBlockHeight: number | null;
  createdAtBlockTimestamp: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve ephemeral port")));
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

function spawnNodeProcess(
  loaderPath: string,
  entryPoint: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  workingDirectory: string,
): ChildProcess {
  return spawn(process.execPath, ["--loader", loaderPath, entryPoint, ...args], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ...env,
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/healthz`);
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()) as T;
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
  processorCrudApiUrl: string,
  proposalPublicKey: string,
): Promise<ProposalCrudRow | null> {
  try {
    const response = await fetch(`${processorCrudApiUrl}/proposals?limit=50`);
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

describe(
  "local blockchain e2e: ProposalCreated pipeline",
  { skip: !RUN_LOCAL_BLOCKCHAIN_E2E },
  () => {
    let localBlockchainProcess: ChildProcess | undefined;
    let localBlockchainBaseUrl = "";
    let localArchiveBaseUrl = "";
    let adminState: AdminStateResponse | null = null;

    before(async () => {
      const localBlockchainPort = await getAvailablePort();
      const localArchivePort = await getAvailablePort();
      localBlockchainBaseUrl = `http://127.0.0.1:${localBlockchainPort}`;
      localArchiveBaseUrl = `http://127.0.0.1:${localArchivePort}`;

      localBlockchainProcess = spawnNodeProcess(
        LOCAL_BLOCKCHAIN_LOADER_PATH,
        LOCAL_BLOCKCHAIN_SERVER_ENTRY_POINT,
        [],
        {
          PORT: String(localBlockchainPort),
          ARCHIVE_PORT: String(localArchivePort),
          ...LOCAL_BLOCKCHAIN_PROOF_ENV,
        },
        LOCAL_BLOCKCHAIN_PACKAGE_DIRECTORY,
      );

      let localBlockchainOutput = "";
      localBlockchainProcess.stdout?.on("data", (chunk) => {
        localBlockchainOutput += chunk.toString();
      });
      localBlockchainProcess.stderr?.on("data", (chunk) => {
        localBlockchainOutput += chunk.toString();
      });
      localBlockchainProcess.once("exit", (code) => {
        if (!adminState) {
          console.error(
            [
              "local blockchain exited before test initialization completed",
              `exitCode=${String(code)}`,
              localBlockchainOutput.trim(),
            ]
              .filter((line) => line.length > 0)
              .join("\n"),
          );
        }
      });

      await waitForHealth(localBlockchainBaseUrl);
      adminState = await readJson<AdminStateResponse>(
        `${localBlockchainBaseUrl}/admin/state`,
      );
      Mina.setActiveInstance(
        Mina.Network({
          mina: `${localBlockchainBaseUrl}/graphql`,
          archive: localArchiveBaseUrl,
        }),
      );
    });

    after(() => {
      localBlockchainProcess?.kill("SIGTERM");
    });

    it(
      "dispatches proposalCreated and projects a proposal row",
      { timeout: 180_000 },
      async () => {
        const sender = adminState?.testAccounts[0];
        assert.ok(sender, "expected local blockchain to expose a funded test account");

        const senderPrivateKey = PrivateKey.fromBase58(sender.privateKey);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const senderAccount = await fetchAccount({ publicKey: senderPublicKey });
        if (senderAccount.error) {
          throw new Error(
            `Sender account is not available on local blockchain: ${String(senderAccount.error)}`,
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

        const deployTx = await Mina.transaction(
          {
            sender: senderPublicKey,
            fee: TX_FEE,
            memo: "api-e2e-proposal-deploy",
          },
          async () => {
            AccountUpdate.fundNewAccount(senderPublicKey, 1);
            await fixtureContract.deploy();
          },
        );
        deployTx.sign([senderPrivateKey, deployTargetPrivateKey]);
        const deployPending = await deployTx.send();
        assert.ok(deployPending, "expected deploy transaction to be accepted");
        await deployPending.wait();

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
          stakingEpochDataLedgerHash: Field(987654321),
          stakingEpochDataLedgerTotalCurrency: UInt64.from(4_000_000_000),
          proposerPublicKey: senderPublicKey,
          senderPublicKey,
        });
        const expectedProposal = {
          proposalPublicKey: proposalPayload.proposalPublicKey.toBase58(),
          lifecycleId: Number(proposalPayload.lifecycleId.toBigint()),
          amount: proposalPayload.amount.toString(),
          recipient: proposalPayload.recipient.toBase58(),
          zkAppUriHash: proposalPayload.zkAppUriHash.toString(),
          stakingEpochDataLedgerHash:
            proposalPayload.stakingEpochDataLedgerHash.toString(),
          stakingEpochDataLedgerTotalCurrency:
            proposalPayload.stakingEpochDataLedgerTotalCurrency.toString(),
        };
        const expectedTreasuryBalance = "1000000000";
        const expectedAcceptanceCriteria =
          TreasuryProposalSmartContract.calculateAcceptanceCriteria(
            UInt128.from(BigInt(expectedProposal.amount)),
            UInt128.from(BigInt(expectedTreasuryBalance)),
            UInt64.from(BigInt(expectedProposal.stakingEpochDataLedgerTotalCurrency)),
          );

        const archiveClient = new ArchiveClient(localArchiveBaseUrl, {
          treasuryOwnerContractAddress: deployTargetPublicKey.toBase58(),
          archiveRequestTimeoutMs: ARCHIVE_REQUEST_TIMEOUT_MS,
        });
        const initialHeights = await archiveClient.getMaxBlockHeights();

        const emitTx = await Mina.transaction(
          {
            sender: senderPublicKey,
            fee: TX_FEE,
            memo: "api-e2e-proposal-emit",
          },
          async () => {
            await fixtureContract.emitProposalCreated(proposalPayload);
          },
        );
        emitTx.sign([senderPrivateKey, deployTargetPrivateKey]);
        const emitPending = await emitTx.send();
        assert.ok(emitPending, "expected emit transaction to be accepted");
        await emitPending.wait();

        let dataSource: DataSource | null = null;
        let indexer: EventsIndexer | null = null;
        let eventsApiServer: EventsApiServer | null = null;
        let repository: EventsRepository | null = null;
        let processor: EventsProcessor | null = null;
        let processorCrudApiServer: ProcessorCrudApiServer | null = null;

        try {
          const indexerApiPort = await getAvailablePort();
          const processorCrudApiPort = await getAvailablePort();
          const indexerApiUrl = `http://127.0.0.1:${indexerApiPort}`;
          const processorCrudApiUrl = `http://127.0.0.1:${processorCrudApiPort}/processor`;

          dataSource = createInMemoryDataSource("public", [
            ProposalEntity,
            ProposalExecutionEntity,
            VoteEntity,
            VoteNullifierEntity,
            VoteTallyEntity,
          ]);
          repository = new EventsRepository(dataSource, "public", {
            knownEventTypes: [PROPOSAL_CREATED_EVENT_NAME],
          });
          await repository.initialize();
          await dataSource.synchronize();

          indexer = new EventsIndexer(archiveClient, repository, {
            pollPendingIntervalMs: 250,
            pollCanonicalIntervalMs: 250,
            blockBatchSize: 10,
            startHeight: 0,
            pendingOverlapBlocks: 20,
            canonicalOverlapBlocks: 100,
            orphanDepthBlocks: 30,
          });
          eventsApiServer = new EventsApiServer(repository, {
            port: indexerApiPort,
            pageLimitDefault: 50,
            pageLimitMax: 200,
          });
          processor = new EventsProcessor(
            dataSource,
            new EventProcessorRouter([
              new ProposalCreatedEventHandler({
                resolveTreasuryBalanceForLifecycle: async () => expectedTreasuryBalance,
              }),
            ]),
            {
              processorName: "proposal-processor-local-blockchain-e2e",
              pollIntervalMs: 250,
              batchSize: 200,
            },
            new IndexerEventsApiClient({
              indexerApiUrl,
            }),
          );
          processorCrudApiServer = new ProcessorCrudApiServer({
            dataSource,
            port: processorCrudApiPort,
            routePrefix: "processor",
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

          const pollDeadline = Date.now() + 30_000;
          let projectedProposal: ProposalCrudRow | null = null;

          while (Date.now() < pollDeadline) {
            projectedProposal = await fetchProjectedProposalFromCrudApi(
              processorCrudApiUrl,
              expectedProposal.proposalPublicKey,
            );
            if (projectedProposal) {
              break;
            }
            await sleep(250);
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
          assert.equal(
            projectedProposal?.stakingEpochDataLedgerHash ?? null,
            expectedProposal.stakingEpochDataLedgerHash,
          );
          assert.equal(
            projectedProposal?.stakingEpochDataLedgerTotalCurrency ?? null,
            expectedProposal.stakingEpochDataLedgerTotalCurrency,
          );
          assert.equal(
            projectedProposal?.requiredParticipationBp ?? null,
            expectedAcceptanceCriteria.requiredParticipationBp.toString(),
          );
          assert.equal(
            projectedProposal?.requiredApprovalBp ?? null,
            expectedAcceptanceCriteria.requiredApprovalBp.toString(),
          );
          assert.equal(
            projectedProposal?.requiredParticipation ?? null,
            expectedAcceptanceCriteria.requiredParticipation.toString(),
          );

          assert.ok(dataSource, "expected processor datasource to be initialized");
          const proposalRow = await dataSource.getRepository(ProposalEntity).findOneBy({
            proposalPublicKey: expectedProposal.proposalPublicKey,
          });
          assert.ok(
            proposalRow,
            "expected proposal row to be available in processor datasource",
          );

          const sourceEvent = await dataSource.getRepository(ArchiveEventEntity).findOne({
            where: { eventType: PROPOSAL_CREATED_EVENT_NAME },
            order: { updatedAt: "DESC", id: "DESC" },
          });
          assert.ok(sourceEvent, "expected indexed proposalCreated source event");
          assert.equal(
            proposalRow?.createdAtBlockHeight,
            sourceEvent?.blockHeight ?? null,
          );
          assert.equal(
            proposalRow?.createdAtBlockTimestamp?.toISOString() ?? null,
            sourceEvent?.blockTimestamp?.toISOString() ?? null,
          );
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
        }
      },
    );
  },
);
