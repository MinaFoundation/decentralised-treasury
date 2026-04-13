import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { type ChildProcess } from "node:child_process";
import { Mina, PrivateKey } from "o1js";
import {
  ensureLightnetReady,
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  logTestStep,
  MINA_NODE_URL,
  parseLightnetAccount,
  parseTransferResult,
  runCli,
  waitForGlobalSlot,
} from "./utils/cli-test-utils.js";

const TRANSFER_TEST_NAME = "transfer.test";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for transfer e2e test`);
  }
  return value;
}

async function fetchAccountBalanceNanomina(publicKeyBase58: string): Promise<bigint> {
  const response = await fetch(MINA_NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query AccountBalance($publicKey: PublicKey!) {
          account(publicKey: $publicKey) {
            balance {
              total
            }
          }
        }
      `,
      variables: {
        publicKey: publicKeyBase58,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch account balance for ${publicKeyBase58}: HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    data?: {
      account?: {
        balance?: {
          total?: string;
        } | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map((error) => error.message)
        .filter((message): message is string => Boolean(message))
        .join("; ") || "Unknown GraphQL error while reading account balance",
    );
  }

  const total = payload.data?.account?.balance?.total;
  return total ? BigInt(total) : 0n;
}

const SENDER_PRIVATE_KEY = requireEnv("SENDER_PRIVATE_KEY");
const TRANSFER_AMOUNT = requireEnv("TRANSFER_AMOUNT");

let lightnetProcess: ChildProcess | undefined;

before(async () => {
  logTestStep(TRANSFER_TEST_NAME, "setup: starting Lightnet for transfer e2e");
  lightnetProcess = await ensureLightnetReady();
  Mina.setActiveInstance(
    Mina.Network({
      mina: MINA_NODE_URL,
      lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    }),
  );
});

after(() => {
  lightnetProcess?.kill("SIGTERM");
});

describe("transfer CLI", { concurrency: 1 }, () => {
  it("transfers MINA to a recipient account", async () => {
    const senderPublicKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY)
      .toPublicKey()
      .toBase58();

    logTestStep(TRANSFER_TEST_NAME, "acquiring recipient Lightnet account");
    const recipientOutput = await runCli(["lightnet", "acquire-account"], {
      timeoutMs: 120_000,
      streamOutput: true,
      streamLabel: "transfer recipient setup",
    });
    const recipient = parseLightnetAccount(recipientOutput);
    assert(recipient, "expected recipient account JSON output");

    const recipientBalanceBefore = await fetchAccountBalanceNanomina(recipient.publicKey);
    logTestStep(TRANSFER_TEST_NAME, "running transfer CLI command", {
      senderPublicKey,
      recipientPublicKey: recipient.publicKey,
      amount: TRANSFER_AMOUNT,
      recipientBalanceBefore: recipientBalanceBefore.toString(),
    });

    const transferOutput = await runCli(["transfer"], {
      timeoutMs: 120_000,
      streamOutput: true,
      streamLabel: "transfer e2e",
      envOverrides: {
        RECIPIENT_PUBLIC_KEY: recipient.publicKey,
      },
    });

    const transferResult = parseTransferResult(transferOutput);
    assert(transferResult, "expected transfer JSON output");
    assert.strictEqual(transferResult.sender, senderPublicKey);
    assert.strictEqual(transferResult.fundingAccount, senderPublicKey);
    assert.strictEqual(transferResult.from, senderPublicKey);
    assert.strictEqual(transferResult.to, recipient.publicKey);
    assert.strictEqual(transferResult.amount, TRANSFER_AMOUNT);
    assert(transferResult.transferTxHash, "expected transfer transaction hash");

    const currentSlot = await getCurrentGlobalSlot();
    await waitForGlobalSlot(currentSlot + 1, 120_000);

    const recipientBalanceAfter = await fetchAccountBalanceNanomina(recipient.publicKey);
    assert.strictEqual(
      recipientBalanceAfter - recipientBalanceBefore,
      BigInt(TRANSFER_AMOUNT),
      "expected recipient balance delta to match transfer amount",
    );
  });
});
