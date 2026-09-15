import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";
import { Field, PrivateKey, PublicKey, Signature, TokenId } from "o1js";
import { expect, test } from "../../../web/e2e/utils/browser-test";
import {
  availablePort,
  startLocalTreasuryStack,
  type LocalTreasuryStack,
  type LocalAccount,
} from "../../../web/e2e/utils/local-treasury-stack";
import { installAuroTestWallet } from "../../../web/e2e/utils/auro-test-wallet";
import type { OperationPackage } from "../../features/operations";
import { preserveNextGeneratedFiles } from "./preserve-next-generated-files";
import { installHeldAuroWallet } from "./held-auro-wallet";
import { createBackofficeLauncher } from "./backoffice-launcher";

type ChainAccount = {
  nonce: string;
  balance: { total: string };
  zkappState: string[];
};

async function account(
  stack: LocalTreasuryStack,
  publicKey: string,
  token = TokenId.default,
): Promise<ChainAccount> {
  const response = await fetch(stack.minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}", token: "${TokenId.toBase58(token)}") { nonce balance { total } zkappState } }`,
    }),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.errors).toBeUndefined();
  expect(result.data.account).not.toBeNull();
  // The local endpoint returns the full account even for a selected field list.
  // Keep this oracle's declared nonce, balance, and application-state scope exact.
  return {
    nonce: result.data.account.nonce,
    balance: { total: result.data.account.balance.total },
    zkappState: result.data.account.zkappState,
  };
}

async function connect(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function download<T>(
  page: Page,
  info: TestInfo,
  button: string,
  name: string,
): Promise<T> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await pending;
  const output = info.outputPath(name);
  await result.saveAs(output);
  await info.attach(name, { path: output, contentType: "application/json" });
  return JSON.parse(await readFile(output, "utf8")) as T;
}

async function upload(page: Page, operation: OperationPackage) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "contribution.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(operation)),
  });
}

/** All chain mutations use an application form or the documented external signer/emergency CLI. */
export async function expandedOperatorScenario(
  { page }: { page: Page },
  info: TestInfo,
) {
  const restoreNextFiles = preserveNextGeneratedFiles([
    {
      appRoot: fileURLToPath(new URL("../../", import.meta.url)),
      distDir: ".next",
    },
    {
      appRoot: fileURLToPath(new URL("../../../web/", import.meta.url)),
      distDir: ".next",
    },
  ]);
  const stack = await startLocalTreasuryStack({
    withdrawalPermission: "proofOrSignature",
  });
  const wallet = await installHeldAuroWallet(page, stack.proposer);
  const backoffice = await createBackofficeLauncher(stack, info);
  let activeSigners = stack.participants;
  let proposalAddress = "";
  const proposalToken = TokenId.derive(
    PublicKey.fromBase58(stack.treasuryOwnerPublicKey),
  );
  const controller = () => account(stack, stack.pauseControllerPublicKey);
  const proposal = () => account(stack, proposalAddress, proposalToken);
  const evidence = async (name: string, value: unknown) =>
    info.attach(name, {
      body: JSON.stringify(value),
      contentType: "application/json",
    });
  const snapshot = async () => ({
    controller: await controller(),
    proposal: await proposal(),
    owner: await account(stack, stack.treasuryOwnerPublicKey),
    payer: await account(stack, stack.proposer.publicKey),
    secondPayer: await account(stack, stack.voter1.publicKey),
    recipient: await account(stack, stack.recipientPublicKey),
    acceptedTransactions: (
      await (await fetch(`${stack.baseUrl}/admin/state`)).json()
    ).submittedTransactions as number,
    walletSignatures: wallet.signedTransactions.length,
  });

  async function build(label: string, name: string, targetPage: Page = page) {
    const page = targetPage;
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page
      .getByRole("button", { name: "Build signing bundle", exact: true })
      .click();
    return download<OperationPackage>(
      page,
      info,
      "Export signing bundle",
      `${name}-unsigned.json`,
    );
  }

  async function collect(
    operation: OperationPackage,
    name: string,
    signers: LocalAccount[] = activeSigners,
    indices = [0, 1, 2],
    targetPage: Page = page,
    foreignOperation?: OperationPackage,
  ) {
    const page = targetPage;
    const before = await snapshot();
    expect(operation.signatures).toEqual([null, null, null, null, null]);
    expect(operation.participants).toEqual(
      signers.map((participant) => participant.publicKey),
    );
    await upload(page, {
      ...operation,
      controllerNonce: String(Number(operation.controllerNonce) - 1),
    });
    await expect(
      page.getByText(
        "The signing bundle is stale or belongs to another deployment.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await snapshot()).toEqual(before);
    // A changed message hash must fail before any signature or transaction is accepted.
    await upload(page, {
      ...operation,
      messageHash: operation.messageHash === "1" ? "2" : "1",
    });
    await expect(
      page.getByText("The operation message hash is invalid.", { exact: true }),
    ).toBeVisible();
    expect(await snapshot()).toEqual(before);
    const commands = {
      pauseTreasury: "pause-treasury",
      unpauseTreasury: "unpause-treasury",
      toggleProposal: "toggle-pause-proposal",
      rotateMultisig: "rotate-multisig-keys",
    };
    const allSignatures = [...operation.signatures];
    for (
      let contributionIndex = 0;
      contributionIndex < 3;
      contributionIndex++
    ) {
      const index = indices[contributionIndex]!;
      const args = [
        "multisig-sign",
        commands[operation.kind],
        "--signer",
        "in-memory",
        "--multisig-participants-public-keys",
        operation.participants.join(","),
        "--multisig-signer-private-key",
        signers[index]!.privateKey,
        "--nonce",
        operation.controllerNonce,
      ];
      if (operation.proposalAddress)
        args.push("--proposal-public-key", operation.proposalAddress);
      if (operation.nextParticipants)
        args.push(
          "--new-multisig-participants-public-keys",
          operation.nextParticipants.join(","),
        );
      const output = await stack.cli(args);
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.dataHash).toBe(operation.messageHash);
      expect(result.multisigCommitment).toBe(operation.multisigCommitment);
      expect(result.signerParticipantIndex).toBe(index);
      allSignatures[index] = result.signature;
      const contribution = {
        ...operation,
        signatures: operation.signatures.map((_, slot) =>
          slot === index ? result.signature : null,
        ),
      };
      if (contributionIndex === 2 && foreignOperation) {
        await test.step("Reject a genuine toggle contribution mixed into the live pause bundle", async () => {
          expect(operation.kind).toBe("pauseTreasury");
          expect(foreignOperation.kind).toBe("toggleProposal");
          expect(foreignOperation.controllerNonce).toBe(
            operation.controllerNonce,
          );
          expect(foreignOperation.multisigCommitment).toBe(
            operation.multisigCommitment,
          );
          expect(foreignOperation.participants).toEqual(operation.participants);
          expect(foreignOperation.messageHash).not.toBe(operation.messageHash);
          const foreignOutput = await stack.cli([
            "multisig-sign",
            "toggle-pause-proposal",
            "--signer",
            "in-memory",
            "--multisig-participants-public-keys",
            foreignOperation.participants.join(","),
            "--multisig-signer-private-key",
            signers[index]!.privateKey,
            "--nonce",
            foreignOperation.controllerNonce,
            "--proposal-public-key",
            foreignOperation.proposalAddress!,
          ]);
          const foreign = JSON.parse(foreignOutput.trim().split("\n").at(-1)!);
          expect(foreign.dataHash).toBe(foreignOperation.messageHash);
          expect(foreign.multisigCommitment).toBe(
            foreignOperation.multisigCommitment,
          );
          expect(foreign.signerParticipantIndex).toBe(index);
          const signature = Signature.fromBase58(foreign.signature);
          const signer = PublicKey.fromBase58(signers[index]!.publicKey);
          expect(
            signature
              .verify(signer, [Field(foreignOperation.messageHash)])
              .toBoolean(),
          ).toBe(true);
          expect(
            signature
              .verify(signer, [Field(operation.messageHash)])
              .toBoolean(),
          ).toBe(false);
          const mixed = {
            ...operation,
            signatures: allSignatures.map((value, slot) =>
              slot === index ? foreign.signature : value,
            ),
          };
          expect(mixed.signatures.filter(Boolean)).toHaveLength(3);
          await upload(page, mixed);
          await expect(
            page.getByText("2 of 3 required", { exact: true }),
          ).toBeVisible();
          await expect(page.getByText("Valid", { exact: true })).toHaveCount(2);
          await expect(page.getByText("Waiting", { exact: true })).toHaveCount(
            3,
          );
          await expect(
            page.getByRole("button", { name: "Prove and submit", exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Download receipt", exact: true }),
          ).toHaveCount(0);
          expect(await snapshot()).toEqual(before);
          await evidence(`${name}-mixed-operation-rejection`, {
            foreignOperation,
            cli: foreign,
            mixed,
            state: await snapshot(),
          });
        });
      }
      await evidence(`${name}-cli-contribution-${index + 1}`, {
        cli: result,
        contribution,
      });
      if (contributionIndex === 1) {
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
        page.getByText(`${contributionIndex + 1} of 3 required`, {
          exact: true,
        }),
      ).toBeVisible();
      // Reimport of the same contribution must not count a participant twice.
      await upload(page, contribution);
      await expect(
        page.getByText(`${contributionIndex + 1} of 3 required`, {
          exact: true,
        }),
      ).toBeVisible();
      if (contributionIndex < 2)
        await expect(
          page.getByRole("button", { name: "Prove and submit", exact: true }),
        ).toHaveCount(0);
      expect(await snapshot()).toEqual(before);
    }
    return { ...operation, signatures: allSignatures };
  }

  async function submit(
    operation: OperationPackage,
    name: string,
    targetPage: Page = page,
    signingWallet = wallet,
    feePayer = stack.proposer.publicKey,
  ) {
    const page = targetPage;
    const wallet = signingWallet;
    const before = await snapshot();
    const signaturesBefore = wallet.signedTransactions.length;
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
    // Check the chain independently. This preserves evidence if the receipt UI fails after inclusion.
    await Promise.race([
      expect
        .poll(async () => Number((await controller()).nonce), {
          timeout: 60 * 60_000,
          intervals: [1000, 3000],
        })
        .toBe(Number(operation.controllerNonce) + 1),
      page
        .getByText("Signing bundle stopped", { exact: true })
        .waitFor({ timeout: 60 * 60_000 })
        .then(async () => {
          throw new Error(
            `Operator submission failed: ${await page.locator('[data-component="action-panel"]').innerText()}`,
          );
        }),
    ]);
    expect(wallet.signedTransactions).toHaveLength(signaturesBefore + 1);
    const command = wallet.signedTransactions.at(-1)!.command as {
      accountUpdates: Array<{ authorization: { proof?: string } }>;
    };
    if (stack.proofsEnabled) {
      expect(
        command.accountUpdates.some((update) =>
          Boolean(update.authorization.proof),
        ),
      ).toBe(true);
    }
    await evidence(`${name}-included-chain-state`, await snapshot());
    await evidence(`${name}-wallet-command`, wallet.signedTransactions.at(-1));
    if (operation.kind === "rotateMultisig") {
      expect((await controller()).zkappState[0]).toBe(
        operation.nextMultisigCommitment,
      );
    }
    await expect(
      page.getByText("Transaction included", { exact: true }),
    ).toBeVisible();
    const receipt = await download<{
      transactionHash: string;
      includedAtBlock: number;
      feePayer: string;
    }>(page, info, "Download receipt", `${name}-receipt.json`);
    const submissionResponse = await submitted;
    const submission = await submissionResponse.json();
    expect(submissionResponse.ok()).toBe(true);
    expect(submission.errors).toBeUndefined();
    expect(receipt.transactionHash).toBe(submission.data.sendZkapp.zkapp.hash);
    expect(receipt.includedAtBlock).toBeGreaterThan(0);
    expect(receipt.feePayer).toBe(feePayer);
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
        (command: { hash: string }) => command.hash === receipt.transactionHash,
      ).failureReason ?? [],
    ).toEqual([]);
    const after = await snapshot();
    const expectedController = structuredClone(before.controller);
    expectedController.nonce = String(Number(operation.controllerNonce) + 1);
    if (operation.kind === "rotateMultisig")
      expectedController.zkappState[0] = operation.nextMultisigCommitment!;
    if (operation.kind === "pauseTreasury")
      expectedController.zkappState[1] = "1";
    if (operation.kind === "unpauseTreasury")
      expectedController.zkappState[1] = "0";
    expect(after.controller).toEqual(expectedController);
    expect(after.acceptedTransactions).toBe(before.acceptedTransactions + 1);
    expect(after.owner).toEqual(before.owner);
    expect(after.recipient).toEqual(before.recipient);
    const expectedProposal = structuredClone(before.proposal);
    if (operation.kind === "toggleProposal")
      expectedProposal.zkappState[5] =
        operation.proposalStatusAfter === "PAUSED" ? "3" : "0";
    expect(after.proposal).toEqual(expectedProposal);
    const payingKey =
      feePayer === stack.proposer.publicKey ? "payer" : "secondPayer";
    const otherKey = payingKey === "payer" ? "secondPayer" : "payer";
    expect(after[otherKey]).toEqual(before[otherKey]);
    expect(after[payingKey]).toEqual({
      ...before[payingKey],
      nonce: String(Number(before[payingKey].nonce) + 1),
      balance: {
        total: String(BigInt(before[payingKey].balance.total) - 100_000_000n),
      },
    });
  }

  async function rejectReplay(operation: OperationPackage) {
    await page
      .getByRole("button", { name: "Start new bundle", exact: true })
      .click();
    const before = await snapshot();
    await upload(page, operation);
    await expect(
      page.getByText(
        "This file contains “Toggle proposal pause”, not “Pause treasury”.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await snapshot()).toEqual(before);
    await page
      .getByRole("tab", { name: "Toggle proposal pause", exact: true })
      .click();
    await upload(page, operation);
    await expect(
      page.getByText(
        "The signing bundle is stale or belongs to another deployment.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Prove and submit", exact: true }),
    ).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
  }

  try {
    const webUrl = await stack.startApp("web", await availablePort());
    // Keep Web setup out of the Backoffice page's source-mapped coverage.
    const setupPage = await page.context().newPage();
    const setupWallet = await installAuroTestWallet(setupPage, stack.proposer);
    await test.step("Create the target proposal through the real Web form", async () => {
      const page = setupPage;
      await page.goto(`${webUrl}/proposals/create`);
      const webMode = await page.evaluate(
        () =>
          (
            window as unknown as {
              __TREASURY_RUNTIME_CONFIG__: { proofsEnabled: string };
            }
          ).__TREASURY_RUNTIME_CONFIG__.proofsEnabled,
      );
      expect(webMode).toBe(String(stack.proofsEnabled));
      await connect(page);
      await page
        .getByLabel("Title", { exact: true })
        .fill("Operator recovery test proposal");
      await page
        .getByLabel("Amount", { exact: true })
        .fill(stack.proposalAmount);
      await page
        .getByLabel("Recipient", { exact: true })
        .fill(stack.recipientPublicKey);
      await page
        .getByLabel("Content", { exact: true })
        .fill(
          "# Operator recovery\n\nVerify proposal pause and emergency recovery.",
        );
      await page
        .getByRole("button", { name: "Create proposal", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign and send", exact: true })
        .click();
      await expect(page).toHaveURL(/\/proposals\/B62/, {
        timeout: 60 * 60_000,
      });
      proposalAddress = new URL(page.url()).pathname.split("/").at(-1)!;
      expect((await proposal()).zkappState[5]).toBe("0");
      expect((await proposal()).zkappState[6]).toBe("0");
      expect(setupWallet.signedTransactions).toHaveLength(1);
      await evidence(
        "proposal-creation-wallet-command",
        setupWallet.signedTransactions[0],
      );
      await evidence("created-proposal", {
        address: proposalAddress,
        account: await proposal(),
      });
    });
    await setupPage.close();

    const backofficeUrl = await backoffice.start(
      activeSigners.map((signer) => signer.publicKey),
    );
    await page.goto(backofficeUrl);
    const appMode = await page.evaluate(
      () =>
        (
          window as unknown as {
            __TREASURY_BACKOFFICE_CONFIG__: { proofsEnabled: boolean };
          }
        ).__TREASURY_BACKOFFICE_CONFIG__.proofsEnabled,
    );
    const serverState = await (
      await fetch(`${stack.baseUrl}/admin/state`)
    ).json();
    expect(appMode).toBe(stack.proofsEnabled);
    expect(serverState.proofsEnabled).toBe(stack.proofsEnabled);
    await evidence("effective-proof-mode", {
      requested: process.env.PROOFS_ENABLED,
      app: appMode,
      server: serverState.proofsEnabled,
    });
    await connect(page);

    await test.step("Pause and resume the proposal with three independent CLI contributions", async () => {
      for (const [name, expectedStatus] of [
        ["proposal-pause", "3"],
        ["proposal-resume", "0"],
      ] as const) {
        await page
          .getByRole("tab", { name: "Toggle proposal pause", exact: true })
          .click();
        await page
          .getByLabel("Proposal address", { exact: true })
          .fill(proposalAddress);
        const operation = await build("Toggle proposal pause", name);
        expect(operation.proposalAddress).toBe(proposalAddress);
        expect(operation.proposalStatusAfter).toBe(
          expectedStatus === "3" ? "PAUSED" : "UNKNOWN",
        );
        const before = await snapshot();
        await upload(page, {
          ...operation,
          proposalAddress: stack.recipientPublicKey,
        });
        await expect(
          page.getByText("The operation message hash is invalid.", {
            exact: true,
          }),
        ).toBeVisible();
        expect(await snapshot()).toEqual(before);
        const signed = await collect(operation, name);
        await submit(operation, name);
        const state = await proposal();
        expect(state.zkappState[5]).toBe(expectedStatus);
        expect(state.zkappState[6]).toBe("0");
        expect((await controller()).zkappState[1]).toBe("0");
        await rejectReplay(signed);
      }
    });

    await test.step("Use emergency CLI authority while the treasury is paused; reject nonce replay", async () => {
      await page
        .getByRole("tab", { name: "Toggle proposal pause", exact: true })
        .click();
      await page
        .getByLabel("Proposal address", { exact: true })
        .fill(proposalAddress);
      const foreignOperation = await build(
        "Toggle proposal pause",
        "mixed-operation-toggle",
      );
      const operation = await build("Pause treasury", "emergency-global-pause");
      await collect(
        operation,
        "emergency-global-pause",
        activeSigners,
        [0, 1, 2],
        page,
        foreignOperation,
      );
      await test.step("Submit the pause after replacing the foreign contribution with the correct signature", async () => {
        await submit(operation, "emergency-global-pause");
      });
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
      const before = await snapshot();
      const recipientBefore = await account(stack, stack.recipientPublicKey);
      const amount = 1_000_000_000n;
      const args = [
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
        String(amount),
        "--fee",
        "100000000",
        "--nonce",
        before.payer.nonce,
        "--memo",
        "E2E emergency withdrawal",
        "--wait",
        "true",
      ];
      // A future fee-payer nonce must not change any account, including the proposal.
      const invalidArgs = [...args];
      invalidArgs[invalidArgs.indexOf("--nonce") + 1] = String(
        Number(before.payer.nonce) + 10,
      );
      await expect
        .soft(stack.cli(invalidArgs))
        .rejects.toThrow(/nonce|Nonce|precondition/);
      expect(await snapshot()).toEqual(before);
      expect(await account(stack, stack.recipientPublicKey)).toEqual(
        recipientBefore,
      );
      const output = await stack.cli(args);
      await evidence("emergency-withdraw-cli-result", { output });
      const result = JSON.parse(output.trim().split("\n").at(-1)!);
      expect(result.authorization).toBe("treasury-owner-signature");
      expect(result.from).toBe(stack.treasuryOwnerPublicKey);
      expect(result.to).toBe(stack.recipientPublicKey);
      expect(result.amount).toBe(String(amount));
      expect(result.emergencyWithdrawalTxHash).toBeTruthy();
      const after = await snapshot();
      expect(
        BigInt(before.owner.balance.total) - BigInt(after.owner.balance.total),
      ).toBe(amount);
      expect(
        BigInt((await account(stack, stack.recipientPublicKey)).balance.total) -
          BigInt(recipientBefore.balance.total),
      ).toBe(amount);
      expect(Number(after.owner.nonce)).toBe(Number(before.owner.nonce) + 1);
      expect(Number(after.payer.nonce)).toBe(Number(before.payer.nonce) + 1);
      expect(
        BigInt(before.payer.balance.total) - BigInt(after.payer.balance.total),
      ).toBe(100_000_000n);
      expect(after.controller).toEqual(before.controller);
      expect(after.proposal).toEqual(before.proposal);
      expect(after.walletSignatures).toBe(before.walletSignatures);
      await expect(
        page.getByText(
          `${Number(after.owner.balance.total) / 1_000_000_000} MINA`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect
        .soft(stack.cli(args))
        .rejects.toThrow(/nonce|Nonce|precondition/);
      expect(await snapshot()).toEqual(after);
      await evidence("emergency-withdraw-chain-state", { before, after });
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
      const unpause = await build(
        "Unpause treasury",
        "emergency-global-unpause",
      );
      await collect(unpause, "emergency-global-unpause");
      await submit(unpause, "emergency-global-unpause");
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
    });

    await test.step("Reject unsafe key sets, then rotate with the current multisig authority", async () => {
      const before = await snapshot();
      await page
        .getByRole("tab", { name: "Rotate multisig keys", exact: true })
        .click();
      const buildButton = page.getByRole("button", {
        name: "Build signing bundle",
        exact: true,
      });
      await expect(buildButton).toBeDisabled();
      const fillKeys = async (keys: string[]) => {
        for (let index = 0; index < keys.length; index++)
          await page
            .getByLabel(`New participant ${index + 1} public key`, {
              exact: true,
            })
            .fill(keys[index]!);
      };
      await fillKeys(stack.participants.map((key) => key.publicKey));
      await expect(page.getByText("Unchanged", { exact: true })).toHaveCount(5);
      await expect(buildButton).toBeDisabled();
      const newSigners = Array.from({ length: 5 }, () => {
        const key = PrivateKey.random();
        return {
          privateKey: key.toBase58(),
          publicKey: key.toPublicKey().toBase58(),
        };
      });
      const newParticipants = newSigners.map((signer) => signer.publicKey);
      await fillKeys(["invalid-key", ...newParticipants.slice(1)]);
      await expect(
        page.getByText("Invalid key", { exact: true }),
      ).toBeVisible();
      await expect(buildButton).toBeDisabled();
      await fillKeys([newParticipants[1]!, ...newParticipants.slice(1)]);
      await expect(page.getByText("Duplicate", { exact: true })).toHaveCount(2);
      await expect(buildButton).toBeDisabled();
      await fillKeys([
        PublicKey.empty().toBase58(),
        ...newParticipants.slice(1),
      ]);
      await expect(
        page.getByText("PublicKey.empty", { exact: true }),
      ).toBeVisible();
      await expect(buildButton).toBeDisabled();
      expect(await snapshot()).toEqual(before);
      await fillKeys(newParticipants);
      await expect(buildButton).toBeEnabled();
      const operation = await build("Rotate multisig keys", "rotate");
      expect(operation.nextParticipants).toEqual(newParticipants);
      expect(operation.nextMultisigCommitment).not.toBe(
        operation.multisigCommitment,
      );
      await collect(operation, "rotate");
      await submit(operation, "rotate");
      expect((await controller()).zkappState[0]).toBe(
        operation.nextMultisigCommitment,
      );
      await expect(
        page.getByText("Participant commitment mismatch", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Download receipt", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Prove and submit", exact: true }),
      ).toHaveCount(0);
      const keySet = await download<{
        participants: string[];
        multisigCommitment: string;
      }>(page, info, "Download new key set", "rotated-key-set.json");
      expect(keySet.participants).toEqual(newParticipants);
      expect(keySet.multisigCommitment).toBe(operation.nextMultisigCommitment);
      // Old configured participants must not authorize another operation after rotation.
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
      await expect(
        page.getByText("Participant commitment mismatch", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Build signing bundle", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      const rotated = await snapshot();
      await page.reload();
      await expect(
        page.getByText("Participant commitment mismatch", { exact: true }),
      ).toBeVisible();
      expect(await snapshot()).toEqual(rotated);
      activeSigners = newSigners;
    });

    await test.step("Restart only Backoffice with rotated keys; reject old contributions and authorize with new keys", async () => {
      const rotated = await snapshot();
      await page.goto("about:blank");
      await backoffice.stop();
      await backoffice.start(activeSigners.map((signer) => signer.publicKey));
      await page.goto(backoffice.url);
      const config = await page.evaluate(
        () =>
          (
            window as unknown as {
              __TREASURY_BACKOFFICE_CONFIG__: {
                multisigParticipants: string;
                proofsEnabled: boolean;
                treasuryOwnerAddress: string;
              };
            }
          ).__TREASURY_BACKOFFICE_CONFIG__,
      );
      expect(config.multisigParticipants.split(",")).toEqual(
        activeSigners.map((signer) => signer.publicKey),
      );
      expect(config.proofsEnabled).toBe(stack.proofsEnabled);
      expect(config.treasuryOwnerAddress).toBe(stack.treasuryOwnerPublicKey);
      await expect(
        page.getByText("Participant commitment mismatch", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: "Pause treasury", exact: true }),
      ).toBeEnabled();
      if (
        await page
          .getByRole("button", { name: "Connect wallet", exact: true })
          .count()
      )
        await connect(page);
      expect(await snapshot()).toEqual(rotated);
      const operation = await build("Pause treasury", "new-authority-pause");
      expect(operation.multisigCommitment).toBe(
        rotated.controller.zkappState[0],
      );
      expect(operation.controllerNonce).toBe(rotated.controller.nonce);
      const before = await snapshot();
      await expect(
        stack.cli([
          "multisig-sign",
          "pause-treasury",
          "--signer",
          "in-memory",
          "--multisig-participants-public-keys",
          operation.participants.join(","),
          "--multisig-signer-private-key",
          stack.participants[0]!.privateKey,
          "--nonce",
          operation.controllerNonce,
        ]),
      ).rejects.toThrow(/is not part of --multisig-participants-public-keys/);
      expect(await snapshot()).toEqual(before);
      const invalid = { ...operation, signatures: [...operation.signatures] };
      for (let index = 0; index < 3; index++) {
        const output = await stack.cli([
          "multisig-sign",
          "pause-treasury",
          "--signer",
          "in-memory",
          "--multisig-participants-public-keys",
          stack.participants.map((signer) => signer.publicKey).join(","),
          "--multisig-signer-private-key",
          stack.participants[index]!.privateKey,
          "--nonce",
          operation.controllerNonce,
        ]);
        const contribution = JSON.parse(output.trim().split("\n").at(-1)!);
        expect(contribution.dataHash).toBe(operation.messageHash);
        expect(contribution.multisigCommitment).not.toBe(
          operation.multisigCommitment,
        );
        invalid.signatures[index] = contribution.signature;
        await evidence(`old-authority-contribution-${index}`, contribution);
      }
      await upload(page, invalid);
      await expect(
        page.getByText("0 of 3 required", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Waiting", { exact: true })).toHaveCount(5);
      await expect(
        page.getByRole("button", { name: "Prove and submit", exact: true }),
      ).toHaveCount(0);
      expect(await snapshot()).toEqual(before);
      await collect(operation, "new-authority-pause", activeSigners, [0, 2, 4]);
      await submit(operation, "new-authority-pause");
      expect((await controller()).zkappState[0]).toBe(
        rotated.controller.zkappState[0],
      );
      expect((await controller()).zkappState[1]).toBe("1");
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
      const unpause = await build("Unpause treasury", "new-authority-unpause");
      await collect(unpause, "new-authority-unpause", activeSigners, [1, 2, 4]);
      await submit(unpause, "new-authority-unpause");
      expect((await controller()).zkappState[1]).toBe("0");
      await page
        .getByRole("button", { name: "Start new bundle", exact: true })
        .click();
    });

    await test.step("Reject a bundle that becomes stale after proving, then rebuild and recover", async () => {
      const operation = await build("Pause treasury", "held-pause");
      await collect(operation, "held-pause");
      const signaturesBefore = wallet.signedTransactions.length;
      const held = await wallet.holdNextSignature();
      const otherContext = await page.context().browser()!.newContext();
      try {
        await page
          .getByRole("button", { name: "Prove and submit", exact: true })
          .click();
        const request = (await Promise.race([
          held.entered,
          page
            .getByText("Signing bundle stopped", { exact: true })
            .waitFor({ timeout: 60 * 60_000 })
            .then(async () => {
              throw new Error(
                `The held transaction failed before wallet approval: ${await page.locator('[data-component="action-panel"]').innerText()}`,
              );
            }),
        ])) as { transaction: string | object; onlySign: boolean };
        expect(request.onlySign).toBe(true);
        await expect(
          page.getByRole("button", { name: "Waiting for Auro", exact: true }),
        ).toBeVisible();
        expect(wallet.signedTransactions).toHaveLength(signaturesBefore);
        const transactionJson =
          typeof request.transaction === "string"
            ? request.transaction
            : JSON.stringify(request.transaction);
        const provedCommand = JSON.parse(transactionJson);
        if (stack.proofsEnabled)
          expect(
            provedCommand.accountUpdates.some(
              (update: { authorization: { proof?: string } }) =>
                Boolean(update.authorization.proof),
            ),
          ).toBe(true);
        const digest = createHash("sha256")
          .update(transactionJson)
          .digest("hex");
        await evidence("held-proved-request", {
          digest,
          controllerNonce: operation.controllerNonce,
          proofsEnabled: stack.proofsEnabled,
        });

        const otherPage = await otherContext.newPage();
        const otherWallet = await installHeldAuroWallet(
          otherPage,
          stack.voter1,
        );
        await otherPage.goto(backoffice.url);
        await connect(otherPage);
        await otherPage
          .getByRole("tab", { name: "Toggle proposal pause", exact: true })
          .click();
        await otherPage
          .getByLabel("Proposal address", { exact: true })
          .fill(proposalAddress);
        const competing = await build(
          "Toggle proposal pause",
          "competing-proposal-pause",
          otherPage,
        );
        expect(competing.controllerNonce).toBe(operation.controllerNonce);
        await collect(
          competing,
          "competing-proposal-pause",
          activeSigners,
          [0, 1, 2],
          otherPage,
        );
        await submit(
          competing,
          "competing-proposal-pause",
          otherPage,
          otherWallet,
          stack.voter1.publicKey,
        );
        const afterCompeting = await snapshot();
        expect(afterCompeting.controller.nonce).toBe(
          String(Number(operation.controllerNonce) + 1),
        );
        expect(afterCompeting.controller.zkappState[1]).toBe("0");
        expect(afterCompeting.proposal.zkappState[5]).toBe("3");
        const rejected = page.waitForResponse(
          (response) =>
            response
              .request()
              .postData()
              ?.includes("mutation BackofficeSend") === true,
          { timeout: 60_000 },
        );
        held.release();
        const failure = await (await rejected).json();
        expect(failure.data?.sendZkapp?.zkapp?.hash).toBeFalsy();
        expect(JSON.stringify(failure.errors)).toMatch(
          /Account_nonce_precondition_unsatisfied/,
        );
        await expect(
          page.getByText("Signing bundle stopped", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Download receipt", exact: true }),
        ).toHaveCount(0);
        expect(wallet.signedTransactions).toHaveLength(signaturesBefore + 1);
        expect(wallet.signedTransactions.at(-1)!.digest).toBe(digest);
        expect(await snapshot()).toEqual({
          ...afterCompeting,
          walletSignatures: signaturesBefore + 1,
        });
        await evidence("stale-after-proof-rejection", {
          failure,
          state: await snapshot(),
        });
        await page
          .getByRole("button", { name: "Prove and submit", exact: true })
          .click();
        await expect(
          page.getByText(
            "The signing bundle is stale or belongs to another deployment.",
            { exact: true },
          ),
        ).toBeVisible();
        expect(wallet.signedTransactions).toHaveLength(signaturesBefore + 1);
        expect(await snapshot()).toEqual({
          ...afterCompeting,
          walletSignatures: signaturesBefore + 1,
        });
        await page
          .getByRole("button", { name: "Start over", exact: true })
          .click();
        const fresh = await build("Pause treasury", "fresh-after-race");
        expect(fresh.controllerNonce).toBe(afterCompeting.controller.nonce);
        await collect(fresh, "fresh-after-race");
        await submit(fresh, "fresh-after-race");
        expect((await controller()).zkappState[1]).toBe("1");
        expect((await proposal()).zkappState[5]).toBe("3");
      } finally {
        held.cancel();
        await otherContext.close();
      }
    });
  } finally {
    try {
      if (proposalAddress)
        await evidence("final-chain-state", await snapshot());
    } finally {
      try {
        try {
          await backoffice.stop();
        } finally {
          await stack.dispose();
        }
      } finally {
        restoreNextFiles();
      }
    }
  }
}
