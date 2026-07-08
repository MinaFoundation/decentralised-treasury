import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ArchiveClient } from "../../indexer/src/archive/client.js";
import {
  AccountUpdate,
  Field,
  fetchAccount,
  fetchTransactionStatus,
  Mina,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
  VerificationKey,
  ZkappUri,
} from "../src/o1js.js";
import { BOND_AMOUNT_DIVISOR } from "../../sdk/src/provable/contracts/treasury-constants.js";
import { TreasuryOwnerSmartContract } from "../../sdk/src/provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { TreasuryProposalSmartContract } from "../../sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";

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

interface TransactionListResponse {
  ok: boolean;
  receipts: Array<{
    hash: string;
    status: "pending" | "included";
    slotBefore: number;
    slotAfter: number;
    label: string | null;
  }>;
}

interface SlotMutationResponse {
  ok: boolean;
  slotBefore: number;
  slotAfter: number;
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

async function waitForHealth(
  baseUrl: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/healthz`);
}

function parseMarkerJson(output: string, marker: string): unknown {
  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(marker));
  if (!line) {
    throw new Error(`Missing output marker ${marker}`);
  }
  return JSON.parse(line.slice(marker.length));
}

function spawnNodeProcess(
  loaderPath: string,
  entryPoint: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  workingDirectory: string,
): ChildProcess {
  return spawn(
    process.execPath,
    ["--loader", loaderPath, entryPoint, ...args],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...env,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as T;
}

async function postGraphql<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as T;
}

describe("local blockchain server", () => {
  const PAYMENT_AMOUNT = 1_000_000_000n;
  const PAYMENT_FEE = 1_000_000_000n;
  let serverProcess: ChildProcess | null = null;

  afterEach(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
    serverProcess = null;
  });

  it("accepts a transaction from a separate process and advances the slot", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const submitterEntryPoint = fileURLToPath(
      new URL(
        "./fixtures/submit-payment-from-separate-process.ts",
        import.meta.url,
      ),
    );
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port) },
      packageDirectory,
    );

    const serverOutput: string[] = [];
    serverProcess.stdout?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });
    serverProcess.stderr?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });

    await waitForHealth(baseUrl);

    const initialState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    assert.equal(initialState.currentSlot, 0);
    assert.equal(initialState.submittedTransactions, 0);
    assert.equal(initialState.testAccounts.length >= 2, true);
    const initialSenderBalance = BigInt(
      initialState.testAccounts[0]?.balance ?? "0",
    );
    const initialRecipientBalance = BigInt(
      initialState.testAccounts[1]?.balance ?? "0",
    );

    const submitterProcess = spawnNodeProcess(
      loaderPath,
      submitterEntryPoint,
      [baseUrl],
      {},
      packageDirectory,
    );

    let submitterOutput = "";
    submitterProcess.stdout?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });
    submitterProcess.stderr?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });

    const submitterExitCode = await new Promise<number>((resolve, reject) => {
      submitterProcess.once("error", reject);
      submitterProcess.once("exit", (code) => resolve(code ?? 1));
    });

    assert.equal(
      submitterExitCode,
      0,
      `submitter exited with ${submitterExitCode}\n${submitterOutput}\n${serverOutput.join("")}`,
    );

    const submitterPayload = parseMarkerJson(
      submitterOutput,
      "SUBMIT_TRANSACTION_RESULT:",
    ) as {
      slotBefore: number;
      sendZkapp: {
        hash: string;
        id: string;
        failureReason: null;
      };
    };

    assert.equal(submitterPayload.slotBefore, 0);
    assert.equal(submitterPayload.sendZkapp.failureReason, null);
    assert.ok(submitterPayload.sendZkapp.hash.length > 0);
    assert.equal(
      submitterPayload.sendZkapp.id,
      submitterPayload.sendZkapp.hash,
    );

    const finalState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    assert.equal(finalState.currentSlot, 1);
    assert.equal(finalState.submittedTransactions, 1);
    const finalSenderBalance = BigInt(
      finalState.testAccounts[0]?.balance ?? "0",
    );
    const finalRecipientBalance = BigInt(
      finalState.testAccounts[1]?.balance ?? "0",
    );
    assert.equal(
      finalSenderBalance,
      initialSenderBalance - PAYMENT_AMOUNT - PAYMENT_FEE,
    );
    assert.equal(
      finalRecipientBalance,
      initialRecipientBalance + PAYMENT_AMOUNT,
    );

    const transactions = await readJson<TransactionListResponse>(
      `${baseUrl}/admin/transactions`,
    );
    assert.equal(transactions.receipts.length, 1);
    assert.equal(transactions.receipts[0]?.slotAfter, 1);
  });

  it("allows manual slot control through generic set and increment endpoints", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port) },
      packageDirectory,
    );

    await waitForHealth(baseUrl);

    const incrementResult = await postJson<SlotMutationResponse>(
      `${baseUrl}/admin/slot/increment`,
      { by: 7 },
    );
    assert.equal(incrementResult.ok, true);
    assert.equal(incrementResult.slotBefore, 0);
    assert.equal(incrementResult.slotAfter, 7);

    const setResult = await postJson<SlotMutationResponse>(
      `${baseUrl}/admin/slot/set`,
      {
        slot: 20,
      },
    );
    assert.equal(setResult.ok, true);
    assert.equal(setResult.slotBefore, 7);
    assert.equal(setResult.slotAfter, 20);

    const finalState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    assert.equal(finalState.currentSlot, 20);
  });

  it("updates staking epoch ledger hash and total currency through admin network-state controls", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port) },
      packageDirectory,
    );

    await waitForHealth(baseUrl);

    const before = await readJson<AdminStateResponse>(`${baseUrl}/admin/state`);
    const nextHash = "123456789";
    const nextTotalCurrency = "500";

    const updateResult = await postJson<{
      ok: boolean;
      currentSlot: number;
      blockchainLength: number;
      totalCurrency: string;
      stakingEpochDataLedgerHash: string;
      stakingEpochDataLedgerTotalCurrency: string;
    }>(`${baseUrl}/admin/network-state`, {
      stakingEpochDataLedgerHash: nextHash,
      stakingEpochDataLedgerTotalCurrency: nextTotalCurrency,
    });
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.stakingEpochDataLedgerHash, nextHash);
    assert.equal(
      updateResult.stakingEpochDataLedgerTotalCurrency,
      nextTotalCurrency,
    );

    const after = await readJson<AdminStateResponse>(`${baseUrl}/admin/state`);
    assert.equal(after.currentSlot, before.currentSlot);
    assert.equal(after.stakingEpochDataLedgerHash, nextHash);
    assert.equal(after.stakingEpochDataLedgerTotalCurrency, nextTotalCurrency);
  });

  it("captures a real proposalCreated event and exposes it through archive-compatible queries", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const submitterEntryPoint = fileURLToPath(
      new URL(
        "./fixtures/submit-proposal-created-from-separate-process.ts",
        import.meta.url,
      ),
    );
    const port = await getAvailablePort();
    const archivePort = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const archiveUrl = `http://127.0.0.1:${archivePort}`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port), MINA_ARCHIVE_PORT: String(archivePort) },
      packageDirectory,
    );

    const serverOutput: string[] = [];
    serverProcess.stdout?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });
    serverProcess.stderr?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });

    await waitForHealth(baseUrl);

    const submitterProcess = spawnNodeProcess(
      loaderPath,
      submitterEntryPoint,
      [baseUrl],
      {},
      packageDirectory,
    );

    let submitterOutput = "";
    submitterProcess.stdout?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });
    submitterProcess.stderr?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });

    const submitterExitCode = await new Promise<number>((resolve, reject) => {
      submitterProcess.once("error", reject);
      submitterProcess.once("exit", (code) => resolve(code ?? 1));
    });

    assert.equal(
      submitterExitCode,
      0,
      `submitter exited with ${submitterExitCode}\n${submitterOutput}\n${serverOutput.join("")}`,
    );

    const payload = parseMarkerJson(
      submitterOutput,
      "PROPOSAL_CREATED_RESULT:",
    ) as {
      treasuryOwnerPublicKey: string;
      treasuryOwnerTokenId: string;
      proposalPublicKey: string;
      proposalTokenId: string;
      proposalTxHash: string;
      finalSlot: number;
    };

    const finalState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    assert.equal(finalState.currentSlot, payload.finalSlot);

    const proposalAccountResponse = await postGraphql<{
      data?: {
        account?: {
          publicKey: string;
          token: string;
          zkappState: string[] | null;
        } | null;
      };
    }>(
      `${baseUrl}/graphql`,
      `query ProposalAccount($publicKey: String!, $token: String!) {
        account(publicKey: $publicKey, token: $token) {
          publicKey
          token
          zkappState
        }
      }`,
      {
        publicKey: payload.proposalPublicKey,
        token: payload.proposalTokenId,
      },
    );
    assert.equal(
      proposalAccountResponse.data?.account?.publicKey,
      payload.proposalPublicKey,
    );
    assert.equal(
      proposalAccountResponse.data?.account?.token,
      payload.proposalTokenId,
    );
    assert.equal(
      Array.isArray(proposalAccountResponse.data?.account?.zkappState),
      true,
    );

    const archiveClient = new ArchiveClient(archiveUrl, {
      treasuryOwnerContractAddress: payload.treasuryOwnerPublicKey,
      archiveRequestTimeoutMs: 5_000,
    });
    const archiveEvents = await archiveClient.fetchEvents({
      status: "CANONICAL",
      from: 0,
      to: 100,
    });
    assert.equal(archiveEvents.length >= 1, true);
    const proposalCreated = archiveEvents
      .flatMap((event) => event.eventData ?? [])
      .find(
        (eventData) =>
          eventData?.transactionInfo?.hash === payload.proposalTxHash,
      );
    assert(proposalCreated, "expected proposalCreated archive event");
    assert.ok((proposalCreated.accountUpdateId ?? "").length > 0);
    assert.equal(Array.isArray(proposalCreated.data), true);
    assert.equal((proposalCreated.data?.length ?? 0) > 0, true);
  });

  it("runs the full treasury flow with manual slot advancement and archive actions", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const submitterEntryPoint = fileURLToPath(
      new URL(
        "./fixtures/submit-full-treasury-flow-from-separate-process.ts",
        import.meta.url,
      ),
    );
    const port = await getAvailablePort();
    const archivePort = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const archiveUrl = `http://127.0.0.1:${archivePort}`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port), MINA_ARCHIVE_PORT: String(archivePort) },
      packageDirectory,
    );

    const serverOutput: string[] = [];
    serverProcess.stdout?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });
    serverProcess.stderr?.on("data", (chunk) => {
      serverOutput.push(chunk.toString());
    });

    await waitForHealth(baseUrl, 60_000);

    const submitterProcess = spawnNodeProcess(
      loaderPath,
      submitterEntryPoint,
      [baseUrl, archiveUrl],
      {},
      packageDirectory,
    );

    let submitterOutput = "";
    submitterProcess.stdout?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });
    submitterProcess.stderr?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });

    const submitterExitCode = await new Promise<number>((resolve, reject) => {
      submitterProcess.once("error", reject);
      submitterProcess.once("exit", (code) => resolve(code ?? 1));
    });

    assert.equal(
      submitterExitCode,
      0,
      `submitter exited with ${submitterExitCode}\n${submitterOutput}\n${serverOutput.join("")}`,
    );

    const payload = parseMarkerJson(
      submitterOutput,
      "FULL_TREASURY_FLOW_RESULT:",
    ) as {
      treasuryOwnerPublicKey: string;
      proposalPublicKey: string;
      proposalTokenId: string;
      recipientPublicKey: string;
      proposalTxHash: string;
      voteTxHashes: string[];
      tallyTxHash: string;
      executeTxHash: string;
      finalSlot: number;
    };

    const finalState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    assert.equal(finalState.currentSlot, payload.finalSlot);
    assert.equal(finalState.submittedTransactions >= 7, true);

    const recipientAccountResponse = await postGraphql<{
      data?: {
        account?: {
          publicKey: string;
          balance?: { total: string } | null;
        } | null;
      };
    }>(
      `${baseUrl}/graphql`,
      `query RecipientAccount($publicKey: String!) {
        account(publicKey: $publicKey) {
          publicKey
          balance {
            total
          }
        }
      }`,
      { publicKey: payload.recipientPublicKey },
    );
    const recipientTokenAccountResponse = await postGraphql<{
      data?: {
        account?: {
          publicKey: string;
          balance?: { total: string } | null;
        } | null;
      };
    }>(
      `${baseUrl}/graphql`,
      `query RecipientTokenAccount($publicKey: String!, $token: String!) {
        account(publicKey: $publicKey, token: $token) {
          publicKey
          balance {
            total
          }
        }
      }`,
      { publicKey: payload.recipientPublicKey, token: payload.proposalTokenId },
    );
    const resolvedRecipientAccount =
      recipientAccountResponse.data?.account ??
      recipientTokenAccountResponse.data?.account;
    assert.equal(
      resolvedRecipientAccount?.publicKey,
      payload.recipientPublicKey,
    );
    assert.equal(resolvedRecipientAccount?.balance?.total, "110000000000");

    const treasuryOwnerAccountResponse = await postGraphql<{
      data?: {
        account?: {
          publicKey: string;
          balance?: { total: string } | null;
        } | null;
      };
    }>(
      `${baseUrl}/graphql`,
      `query TreasuryOwnerAccount($publicKey: String!) {
        account(publicKey: $publicKey) {
          publicKey
          balance {
            total
          }
        }
      }`,
      { publicKey: payload.treasuryOwnerPublicKey },
    );
    assert.equal(
      treasuryOwnerAccountResponse.data?.account?.balance?.total,
      "100000000000",
    );

    const archiveActionsResponse = await postGraphql<{
      data?: {
        actions?: Array<{
          actionState?: {
            actionStateOne?: string;
            actionStateTwo?: string;
          } | null;
          actionData?: Array<{
            accountUpdateId?: string;
            data?: string[];
            transactionInfo?: {
              sequenceNumber?: number;
            } | null;
          }>;
        }>;
      };
    }>(
      archiveUrl,
      `query ProposalActions($input: ArchiveActionQueryInput!) {
        actions(input: $input) {
          actionState {
            actionStateOne
            actionStateTwo
          }
          actionData {
            accountUpdateId
            data
            transactionInfo {
              sequenceNumber
            }
          }
        }
      }`,
      {
        input: {
          address: payload.proposalPublicKey,
          tokenId: payload.proposalTokenId,
        },
      },
    );
    assert.equal(archiveActionsResponse.data?.actions?.length, 1);
    assert.equal(
      archiveActionsResponse.data?.actions?.[0]?.actionData?.length,
      3,
    );
    assert.ok(
      (
        archiveActionsResponse.data?.actions?.[0]?.actionState
          ?.actionStateOne ?? ""
      ).length > 0,
    );
    assert.ok(
      (
        archiveActionsResponse.data?.actions?.[0]?.actionState
          ?.actionStateTwo ?? ""
      ).length > 0,
    );

    const archiveClient = new ArchiveClient(archiveUrl, {
      treasuryOwnerContractAddress: payload.treasuryOwnerPublicKey,
      archiveRequestTimeoutMs: 5_000,
    });
    const archiveEvents = await archiveClient.fetchEvents({
      status: "CANONICAL",
      from: 0,
      to: 1_000,
    });
    const canonicalHashes = new Set(
      archiveEvents
        .flatMap((event) => event.eventData ?? [])
        .map((eventData) => eventData.transactionInfo.hash),
    );
    assert.equal(canonicalHashes.has(payload.proposalTxHash), true);
    assert.equal(canonicalHashes.has(payload.voteTxHashes[0] ?? ""), true);
    assert.equal(canonicalHashes.has(payload.voteTxHashes[1] ?? ""), true);
    assert.equal(canonicalHashes.has(payload.voteTxHashes[2] ?? ""), true);
    assert.equal(canonicalHashes.has(payload.tallyTxHash), true);
    assert.equal(canonicalHashes.has(payload.executeTxHash), true);
  });

  it("supports o1js fetchAccount and fetchTransactionStatus over HTTP GraphQL", async () => {
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const loaderPath = fileURLToPath(
      new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
    );
    const serverEntryPoint = fileURLToPath(
      new URL("../src/server.ts", import.meta.url),
    );
    const submitterEntryPoint = fileURLToPath(
      new URL(
        "./fixtures/submit-payment-from-separate-process.ts",
        import.meta.url,
      ),
    );
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const graphqlUrl = `${baseUrl}/graphql`;

    serverProcess = spawnNodeProcess(
      loaderPath,
      serverEntryPoint,
      [],
      { MINA_NODE_PORT: String(port) },
      packageDirectory,
    );

    await waitForHealth(baseUrl);

    const initialState = await readJson<AdminStateResponse>(
      `${baseUrl}/admin/state`,
    );
    const sender = initialState.testAccounts[0];
    assert(sender, "expected a local blockchain test account");

    const fetchedAccount = await fetchAccount(
      { publicKey: sender.publicKey },
      graphqlUrl,
    );
    assert.equal(fetchedAccount.error, undefined);
    assert.equal(
      fetchedAccount.account?.publicKey.toBase58(),
      sender.publicKey,
    );
    assert.equal(
      fetchedAccount.account?.balance.toBigInt().toString(),
      sender.balance,
    );

    const submitterProcess = spawnNodeProcess(
      loaderPath,
      submitterEntryPoint,
      [baseUrl],
      {},
      packageDirectory,
    );

    let submitterOutput = "";
    submitterProcess.stdout?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });
    submitterProcess.stderr?.on("data", (chunk) => {
      submitterOutput += chunk.toString();
    });

    const submitterExitCode = await new Promise<number>((resolve, reject) => {
      submitterProcess.once("error", reject);
      submitterProcess.once("exit", (code) => resolve(code ?? 1));
    });

    assert.equal(
      submitterExitCode,
      0,
      `submitter exited with ${submitterExitCode}\n${submitterOutput}`,
    );

    const submitterPayload = parseMarkerJson(
      submitterOutput,
      "SUBMIT_TRANSACTION_RESULT:",
    ) as {
      sendZkapp: {
        hash: string;
      };
    };

    const transactionStatus = await fetchTransactionStatus(
      submitterPayload.sendZkapp.hash,
      graphqlUrl,
    );
    assert.equal(transactionStatus, "INCLUDED");
  });

  it(
    "supports UI contract reads and transaction preparation through Mina.Network",
    { timeout: 180_000 },
    async () => {
      const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
      const loaderPath = fileURLToPath(
        new URL("../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
      );
      const serverEntryPoint = fileURLToPath(
        new URL("../src/server.ts", import.meta.url),
      );
      const submitterEntryPoint = fileURLToPath(
        new URL(
          "./fixtures/submit-proposal-created-from-separate-process.ts",
          import.meta.url,
        ),
      );
      const port = await getAvailablePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const graphqlUrl = `${baseUrl}/graphql`;

      serverProcess = spawnNodeProcess(
        loaderPath,
        serverEntryPoint,
        [],
        { MINA_NODE_PORT: String(port), PROOFS_ENABLED: "false" },
        packageDirectory,
      );

      let serverOutput = "";
      serverProcess.stdout?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });
      serverProcess.stderr?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });

      await waitForHealth(baseUrl, 60_000);

      const adminState = await readJson<AdminStateResponse>(
        `${baseUrl}/admin/state`,
      );
      const submitterProcess = spawnNodeProcess(
        loaderPath,
        submitterEntryPoint,
        [baseUrl],
        { PROOFS_ENABLED: "false" },
        packageDirectory,
      );

      let submitterOutput = "";
      submitterProcess.stdout?.on("data", (chunk) => {
        submitterOutput += chunk.toString();
      });
      submitterProcess.stderr?.on("data", (chunk) => {
        submitterOutput += chunk.toString();
      });

      const submitterExitCode = await new Promise<number>((resolve, reject) => {
        submitterProcess.once("error", reject);
        submitterProcess.once("exit", (code) => resolve(code ?? 1));
      });

      assert.equal(
        submitterExitCode,
        0,
        `submitter exited with ${submitterExitCode}\n${submitterOutput}\n${serverOutput}`,
      );

      const payload = parseMarkerJson(
        submitterOutput,
        "PROPOSAL_CREATED_RESULT:",
      ) as {
        treasuryOwnerPublicKey: string;
      };

      Mina.setActiveInstance(Mina.Network(graphqlUrl));
      const treasuryOwner = new TreasuryOwnerSmartContract(
        PublicKey.fromBase58(payload.treasuryOwnerPublicKey),
      );
      const treasuryDeployedAtSlot =
        await treasuryOwner.treasuryDeployedAtSlot.fetch();
      assert.ok(
        treasuryDeployedAtSlot,
        "expected treasury deployed slot on chain",
      );
      const pauseControllerPublicKey =
        await treasuryOwner.pauseControllerPublicKey.fetch();
      assert.ok(
        pauseControllerPublicKey,
        "expected pause controller public key on chain",
      );

      TreasuryPauseControllerSmartContract.multisigParticipants = Array.from(
        { length: 5 },
        () => PrivateKey.random().toPublicKey(),
      );
      TreasuryProposalSmartContract.voteReducerVerificationKey =
        VerificationKey.dummySync();
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
        VerificationKey.dummySync();
      TreasuryProposalSmartContract.emptyNullifierRoot = Field(0);
      TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(0);
      await TreasuryProposalSmartContract.compile();
      TreasuryOwnerSmartContract.proposalContractVerificationKey =
        TreasuryProposalSmartContract._verificationKey;
      await TreasuryPauseControllerSmartContract.compile();
      await TreasuryOwnerSmartContract.compile();

      const senderPublicKey = PublicKey.fromBase58(
        adminState.testAccounts[1]!.publicKey,
      );
      const recipientPublicKey = PublicKey.fromBase58(
        adminState.testAccounts[2]!.publicKey,
      );
      const proposalPrivateKey = PrivateKey.random();
      const proposalPublicKey = proposalPrivateKey.toPublicKey();
      const proposalAmount = UInt64.from(1_000_000_000);
      const transaction = await Mina.transaction(
        {
          sender: senderPublicKey,
          fee: 200_000_000,
          memo: "local-ui-create",
        },
        async () => {
          AccountUpdate.fundNewAccount(senderPublicKey, 1);
          const bondPayerAccountUpdate =
            AccountUpdate.createSigned(senderPublicKey);
          bondPayerAccountUpdate.balance.subInPlace(
            proposalAmount.div(BOND_AMOUNT_DIVISOR),
          );
          await treasuryOwner.createProposal(
            proposalPublicKey,
            {
              amount: proposalAmount,
              recipient: recipientPublicKey,
              zkAppUri: ZkappUri.from("https://example.com/local-ui-create"),
            },
            UInt32.from(0),
          );
        },
      );
      transaction.sign([proposalPrivateKey]);
      await transaction.prove();

      assert.ok(transaction.toJSON().length > 0);
      assert.ok(proposalPublicKey.toBase58().length > 0);
    },
  );
});
