import assert from "node:assert";
import { before, describe, it } from "node:test";
import { Mina, PrivateKey } from "o1js";
import {
  ensureExistingLightnetReady,
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  logTestStep,
  MINA_NODE_URL,
  parseTransferResult,
  runCli as runCliWithEnv,
  waitForGlobalSlot,
} from "./utils/cli-test-utils.js";

import {
  loadPreparedLightnetFixture,
  type PreparedLightnetFixture,
} from "./utils/prepared-lightnet-fixture.js";

let fixture: PreparedLightnetFixture;
const runCli = (
  args: string[],
  options: NonNullable<Parameters<typeof runCliWithEnv>[1]> = {},
) =>
  runCliWithEnv(args, {
    ...options,
    envOverrides: {
      ...options.envOverrides,
      MINA_NODE_URL: fixture.minaNodeUrl,
      LIGHTNET_ACCOUNT_MANAGER_ENDPOINT: fixture.accountManagerUrl,
      NETWORK: fixture.networkId,
      PROOFS_ENABLED: String(fixture.proofsEnabled),
      LIFECYCLE_PERIOD_DURATION: String(fixture.lifecyclePeriodDurationSlots),
      SENDER_PRIVATE_KEY,
      TRANSFER_AMOUNT,
      TX_WAIT: "true",
    },
  });

const TRANSFER_TEST_NAME = "transfer.test";

async function fetchAccountBalanceNanomina(
  publicKeyBase58: string,
): Promise<bigint> {
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

let SENDER_PRIVATE_KEY: string;
const TRANSFER_AMOUNT = process.env.TRANSFER_AMOUNT ?? "1000000000";

before(async () => {
  logTestStep(
    TRANSFER_TEST_NAME,
    "setup: checking the prepared Lightnet for transfer e2e",
  );
  fixture = await loadPreparedLightnetFixture();
  assert.strictEqual(
    MINA_NODE_URL,
    fixture.minaNodeUrl,
    "MINA_NODE_URL must match the prepared fixture before importing this suite",
  );
  assert.strictEqual(
    LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    fixture.accountManagerUrl,
    "The account manager must match the prepared fixture",
  );
  await ensureExistingLightnetReady({
    minaNodeUrl: fixture.minaNodeUrl,
    expectedChainId: fixture.chainId,
    expectedSlotDurationMs: fixture.slotDurationMs,
    expectedSlotsPerEpoch: fixture.slotsPerEpoch,
  });
  SENDER_PRIVATE_KEY = fixture.voters[4]!.privateKey;
  Mina.setActiveInstance(
    Mina.Network({
      mina: MINA_NODE_URL,
      networkId: fixture.networkId,
      lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    }),
  );
});

describe("transfer CLI", { concurrency: 1 }, () => {
  it("transfers MINA to a recipient account", async () => {
    const senderPublicKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY)
      .toPublicKey()
      .toBase58();

    const recipient = {
      publicKey: PrivateKey.random().toPublicKey().toBase58(),
    };
    assert.notStrictEqual(
      recipient.publicKey,
      senderPublicKey,
      "The new recipient must differ from the sender",
    );

    const recipientBalanceBefore = await fetchAccountBalanceNanomina(
      recipient.publicKey,
    );
    assert.strictEqual(recipientBalanceBefore, 0n);
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

    const recipientBalanceAfter = await fetchAccountBalanceNanomina(
      recipient.publicKey,
    );
    assert.strictEqual(
      recipientBalanceAfter - recipientBalanceBefore,
      BigInt(TRANSFER_AMOUNT),
      "expected recipient balance delta to match transfer amount",
    );
  });
});
