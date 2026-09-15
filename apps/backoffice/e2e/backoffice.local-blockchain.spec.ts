import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";
import { PrivateKey } from "o1js";
import { expect, test } from "../../web/e2e/utils/browser-test";
import { startLocalTreasuryStack } from "../../web/e2e/utils/local-treasury-stack";
import { installAuroTestWallet } from "../../web/e2e/utils/auro-test-wallet";
import type { OperationPackage } from "../features/operations";
import { expandedOperatorScenario } from "./utils/expanded-operator-scenario";
import { preserveNextGeneratedFiles } from "./utils/preserve-next-generated-files";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mode = process.env.PROOFS_ENABLED!;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test port allocated.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function download(
  page: Page,
  button: string,
  info: TestInfo,
  name: string,
): Promise<unknown> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await pending;
  const output = info.outputPath(name);
  await result.saveAs(output);
  await info.attach(name, { path: output, contentType: "application/json" });
  return JSON.parse(await readFile(output, "utf8"));
}

async function upload(page: Page, operation: OperationPackage): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: "contribution.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(operation)),
  });
}

test("live operator exports, merges CLI signatures, pauses and unpauses through the wallet", async ({
  page,
}, info) => {
  const restoreNextFiles = preserveNextGeneratedFiles([
    { appRoot, distDir: `.next-e2e-proofs-${mode}` },
  ]);
  const stack = await startLocalTreasuryStack({ startBackend: false });
  let next: ChildProcess | undefined;
  let serverLog = "";
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    const nodeState = await (
      await fetch(`${stack.baseUrl}/admin/state`)
    ).json();
    expect(nodeState.proofsEnabled).toBe(mode === "true");
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    next = spawn(
      process.execPath,
      [
        path.join(appRoot, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          ...stack.runtimeEnv,
          PROOFS_ENABLED: mode,
          NEXT_PUBLIC_PROOFS_ENABLED: mode,
          E2E_BROWSER_COVERAGE: "true",
          NEXT_PUBLIC_MINA_NODE_URL: stack.minaNodeUrl,
          NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS:
            stack.treasuryOwnerPublicKey,
          NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS: stack.participants
            .map((account) => account.publicKey)
            .join(","),
          BACKOFFICE_BUILD_DIR: `.next-e2e-proofs-${mode}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    next.stdout!.on("data", (chunk) => {
      serverLog += String(chunk);
    });
    next.stderr!.on("data", (chunk) => {
      serverLog += String(chunk);
    });
    await expect
      .poll(
        async () => {
          if (next!.exitCode !== null)
            throw new Error(`Backoffice server exited: ${serverLog}`);
          return fetch(url)
            .then((response) => response.status)
            .catch(() => 0);
        },
        { timeout: 180_000 },
      )
      .toBe(200);

    const wallet = await installAuroTestWallet(page, stack.proposer);
    await page.goto(url);
    const runtime = await page.evaluate(
      () =>
        (
          window as unknown as {
            __TREASURY_BACKOFFICE_CONFIG__: {
              proofsEnabled: boolean;
              minaNodeUrl: string;
            };
          }
        ).__TREASURY_BACKOFFICE_CONFIG__,
    );
    expect(runtime.proofsEnabled).toBe(nodeState.proofsEnabled);
    expect(runtime.minaNodeUrl).toBe(stack.minaNodeUrl);
    await info.attach("effective-proof-mode", {
      body: JSON.stringify({
        requested: mode,
        server: nodeState.proofsEnabled,
        app: runtime.proofsEnabled,
      }),
      contentType: "application/json",
    });
    await expect(
      page.getByRole("tab", { name: "Pause treasury", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await test.step("Reject emergency withdrawal with the correct Owner key on a proof-only deployment", async () => {
      const protectedState = async () => {
        const fields =
          "publicKey nonce balance { total } zkappState receiptChainHash permissions { access send }";
        // The local GraphQL service supports one account root per request.
        const accounts = Object.fromEntries(
          await Promise.all(
            Object.entries({
              owner: stack.treasuryOwnerPublicKey,
              controller: stack.pauseControllerPublicKey,
              payer: stack.proposer.publicKey,
              recipient: stack.recipientPublicKey,
            }).map(async ([name, publicKey]) => {
              const response = await fetch(stack.minaNodeUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  query: `query { account(publicKey: "${publicKey}") { ${fields} } }`,
                }),
              });
              expect(response.ok).toBe(true);
              const result = await response.json();
              expect(result.errors).toBeUndefined();
              expect(result.data.account).not.toBeNull();
              expect(result.data.account.publicKey).toBe(publicKey);
              const account = result.data.account;
              return [
                name,
                {
                  publicKey: account.publicKey,
                  nonce: account.nonce,
                  balance: { total: account.balance.total },
                  zkappState: account.zkappState,
                  receiptChainHash: account.receiptChainHash,
                  permissions: {
                    access: account.permissions.access,
                    send: account.permissions.send,
                  },
                },
              ];
            }),
          ),
        );
        const adminResponse = await fetch(`${stack.baseUrl}/admin/state`);
        expect(adminResponse.ok).toBe(true);
        const admin = await adminResponse.json();
        return {
          accounts,
          acceptedTransactions: admin.submittedTransactions,
          walletSignatures: wallet.signedTransactions.length,
        };
      };
      const before = await protectedState();
      expect(before.accounts.owner.permissions).toEqual({
        access: "Proof",
        send: "Proof",
      });
      expect(stack.treasuryOwner.publicKey).toBe(stack.treasuryOwnerPublicKey);
      expect(
        PrivateKey.fromBase58(stack.treasuryOwner.privateKey)
          .toPublicKey()
          .toBase58(),
      ).toBe(stack.treasuryOwnerPublicKey);
      const rejection = `Treasury Owner ${stack.treasuryOwnerPublicKey} does not permit an emergency signature withdrawal. Expected access and send to be proofOrSignature. Deploy a new Treasury Owner with the required permissions.`;
      await expect(
        stack.cli([
          "treasury-owner",
          "emergency-withdraw",
          "--signer",
          "in-memory",
          "--sender-private-key",
          stack.proposer.privateKey,
          "--treasury-owner-private-key",
          stack.treasuryOwner.privateKey,
          "--recipient-public-key",
          stack.recipientPublicKey,
          "--amount",
          "1",
          "--fee",
          "100000000",
          "--nonce",
          before.accounts.payer.nonce,
          "--wait",
          "true",
        ]),
      ).rejects.toThrow(rejection);
      const after = await protectedState();
      expect(after).toEqual(before);
      await expect(
        page.getByRole("button", { name: "Download receipt", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: "Pause treasury", exact: true }),
      ).toBeEnabled();
      await info.attach("proof-only-emergency-rejection", {
        body: JSON.stringify({ rejection, before, after }),
        contentType: "application/json",
      });
    });

    let initialBundle: OperationPackage | undefined;
    let expectedNonce: number | undefined;
    let submissionCount = 0;
    for (const [kind, command, paused] of [
      ["pauseTreasury", "pause-treasury", true],
      ["unpauseTreasury", "unpause-treasury", false],
    ] as const) {
      await page
        .getByRole("button", { name: "Build signing bundle", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Export signing bundle",
          exact: true,
        }),
      ).toBeVisible();
      const operation = (await download(
        page,
        "Export signing bundle",
        info,
        `${kind}-unsigned.json`,
      )) as OperationPackage;
      expect(operation.kind).toBe(kind);
      expect(operation.signatures).toEqual([null, null, null, null, null]);
      expect(operation.participants).toEqual(
        stack.participants.map((account) => account.publicKey),
      );
      expectedNonce ??= Number(operation.controllerNonce);
      expect(Number(operation.controllerNonce)).toBe(expectedNonce);
      initialBundle ??= operation;

      for (let participant = 0; participant < 3; participant++) {
        const signed = await stack.cli([
          "multisig-sign",
          command,
          "--signer",
          "in-memory",
          "--multisig-participants-public-keys",
          operation.participants.join(","),
          "--multisig-signer-private-key",
          stack.participants[participant]!.privateKey,
          "--nonce",
          operation.controllerNonce,
        ]);
        const result = JSON.parse(signed.trim().split("\n").at(-1)!);
        expect(result.dataHash).toBe(operation.messageHash);
        expect(result.multisigCommitment).toBe(operation.multisigCommitment);
        expect(result.signerParticipantIndex).toBe(participant);
        const contribution: OperationPackage = {
          ...operation,
          signatures: operation.signatures.map((_, index) =>
            index === participant ? result.signature : null,
          ),
        };
        await info.attach(`${kind}-participant-${participant + 1}`, {
          body: JSON.stringify({ cli: result, contribution }),
          contentType: "application/json",
        });
        if (participant === 1) {
          await upload(page, {
            ...contribution,
            createdAt: "2000-01-01T00:00:00.000Z",
          });
          await expect(
            page.getByText(
              "The imported signature package has different operation data in createdAt.",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(
            page.getByText("1 of 3 required", { exact: true }),
          ).toBeVisible();
        }
        await upload(page, contribution);
        await expect(
          page.getByText(`${participant + 1} of 3 required`, { exact: true }),
        ).toBeVisible();
        if (participant < 2) {
          await expect(
            page.getByRole("button", { name: "Prove and submit", exact: true }),
          ).toHaveCount(0);
          expect(wallet.signedTransactions).toHaveLength(submissionCount);
        }
      }
      const submitted = page.waitForResponse(
        (response) =>
          response.request().postData()?.includes("mutation BackofficeSend") ===
          true,
        { timeout: 60 * 60_000 },
      );
      void submitted.catch(() => undefined);
      await page
        .getByRole("button", { name: "Prove and submit", exact: true })
        .click();
      await Promise.race([
        page
          .getByText("Transaction included", { exact: true })
          .waitFor({ timeout: 60 * 60_000 }),
        page
          .getByText("Signing bundle stopped", { exact: true })
          .waitFor({ timeout: 60 * 60_000 })
          .then(async () => {
            throw new Error(
              `Backoffice submission failed: ${await page.locator('[data-component="action-panel"]').innerText()}`,
            );
          }),
      ]);
      const receipt = (await download(
        page,
        "Download receipt",
        info,
        `${kind}-receipt.json`,
      )) as {
        transactionHash: string;
        includedAtBlock: number;
        feePayer: string;
      };
      const submissionResponse = await submitted;
      const submission = await submissionResponse.json();
      expect(submissionResponse.ok()).toBe(true);
      expect(submission.errors).toBeUndefined();
      expect(receipt.transactionHash).toBe(
        submission.data.sendZkapp.zkapp.hash,
      );
      expect(receipt.includedAtBlock).toBeGreaterThan(0);
      expect(receipt.feePayer).toBe(stack.proposer.publicKey);
      submissionCount++;
      expect(wallet.signedTransactions).toHaveLength(submissionCount);
      await info.attach(`${kind}-wallet-command`, {
        body: JSON.stringify(wallet.signedTransactions.at(-1)),
        contentType: "application/json",
      });
      const chain = await (
        await fetch(stack.minaNodeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `query { account(publicKey: "${operation.pauseControllerAddress}") { nonce zkappState } }`,
          }),
        })
      ).json();
      expect(chain.errors).toBeUndefined();
      expectedNonce++;
      expect(Number(chain.data.account.nonce)).toBe(expectedNonce);
      expect(chain.data.account.zkappState[1]).toBe(paused ? "1" : "0");
      const inclusion = await (
        await fetch(stack.minaNodeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query:
              "query { bestChain(maxLength: 20) { protocolState { consensusState { blockHeight } } transactions { zkappCommands { hash failureReason { index failures } } } } }",
          }),
        })
      ).json();
      expect(inclusion.errors).toBeUndefined();
      const block = inclusion.data.bestChain.find(
        (entry: { transactions: { zkappCommands: Array<{ hash: string }> } }) =>
          entry.transactions.zkappCommands.some(
            (command) => command.hash === receipt.transactionHash,
          ),
      );
      expect(block).toBeTruthy();
      expect(Number(block.protocolState.consensusState.blockHeight)).toBe(
        receipt.includedAtBlock,
      );
      expect(
        block.transactions.zkappCommands.find(
          (command: { hash: string }) =>
            command.hash === receipt.transactionHash,
        ).failureReason ?? [],
      ).toEqual([]);
      await info.attach(`${kind}-chain-state`, {
        body: JSON.stringify(chain),
        contentType: "application/json",
      });
      await expect(
        page.getByText(paused ? "Paused" : "Active", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
      await expect(
        page.getByRole("tab", {
          name: paused ? "Unpause treasury" : "Pause treasury",
          exact: true,
        }),
      ).toBeEnabled();
    }

    await upload(page, initialBundle!);
    await expect(
      page.getByText(
        "The signing bundle is stale or belongs to another deployment.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Prove and submit", exact: true }),
    ).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  } finally {
    try {
      await info.attach("backoffice-server.log", {
        body: serverLog,
        contentType: "text/plain",
      });
      await info.attach("browser-errors.json", {
        body: JSON.stringify(browserErrors),
        contentType: "application/json",
      });
    } finally {
      try {
        if (next) await stop(next);
        await stack.dispose();
      } finally {
        restoreNextFiles();
      }
    }
  }
});

test(
  "live operator toggles a proposal, withdraws, rotates authority, and recovers from a proved stale bundle",
  expandedOperatorScenario,
);
