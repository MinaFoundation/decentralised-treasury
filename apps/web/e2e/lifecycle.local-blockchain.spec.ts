import type { Page } from "@playwright/test";
import { expect, test } from "./utils/browser-test";
import { installAuroTestWallet } from "./utils/auro-test-wallet";
import { expectTransactionSuccess } from "./utils/transaction-success";
import { unchangedBrowserState } from "./utils/unchanged-state";
import {
  prepareSecondLifecycle,
  completeSecondLifecycle,
} from "./utils/second-lifecycle";
import {
  availablePort,
  parseCliJson,
  readJson,
  startLocalTreasuryStack,
  type AdminState,
  type LocalAccount,
  type LocalTreasuryStack,
} from "./utils/local-treasury-stack";
import {
  setLifecycleSlot,
  tallyBrowserVotes,
} from "./utils/lifecycle-operator";

type Vote = { voterPublicKey: string; vote: string; voteWeight: string };
type Execution = {
  recipient: string;
  amountToPayOut: string;
  senderPublicKey: string;
  paidOutAmount: string;
  remainingAmount: string;
};
type Proposal = {
  proposalPublicKey: string;
  contractStatus: string;
  paidOutAmount: string;
  remainingPayoutAmount: string;
};
type Command = { feePayer: { body: { fee: string; publicKey: string } } };

async function connect(page: Page) {
  const button = page.getByRole("button", {
    name: "Connect wallet",
    exact: true,
  });
  await button.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function account(stack: LocalTreasuryStack, publicKey: string) {
  const response = await fetch(stack.minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}") { nonce balance { total } } }`,
    }),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.errors).toBeUndefined();
  expect(result.data.account).not.toBeNull();
  return result.data.account as { nonce: string; balance: { total: string } };
}

// All lifecycle mutations under test use the UI. Only the documented clock and
// operator reduction/tally commands prepare the later lifecycle stages.
test("S40-006/007: browser completes two lifecycles with distinct snapshots on one deployment", async ({
  page,
}, testInfo) => {
  test.setTimeout(90 * 60_000);
  const stack = await startLocalTreasuryStack();
  const evidence: Record<string, unknown> = {
    proofsEnabled: stack.proofsEnabled,
  };
  const modes: boolean[] = [];
  const pageErrors: string[] = [];
  const errors: Array<{ text: string; url: string }> = [];
  const contentRetries = new Set<string>();
  const completedContent = new Set<string>();
  const absentStakingAccounts = new Map<string, string>();
  const votingWeights = new Map<string, string>();
  const transactionHashes: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", async (message) => {
    try {
      if (message.type() === "error")
        errors.push({ text: message.text(), url: message.location().url });
      if (message.text().includes("effective transaction proof mode")) {
        const value = await message.args()[1]?.jsonValue();
        if (typeof value?.proofsEnabled === "boolean")
          modes.push(value.proofsEnabled);
      }
    } catch (error) {
      pageErrors.push(`Console evidence read failed: ${String(error)}`);
    }
  });
  page.on("response", async (response) => {
    try {
      if (
        response.request().method() === "GET" &&
        response
          .url()
          .startsWith(
            `${stack.treasuryApiUrl}/staking-ledger/lifecycles/0/accounts/`,
          ) &&
        response.status() === 404
      ) {
        const result = await response.json();
        if (
          result.error === "staking account for publicKey is not available" &&
          result.lifecycleId === "0" &&
          response.url().endsWith(`/${result.publicKey}`)
        )
          absentStakingAccounts.set(response.url(), result.publicKey);
      }
      if (
        response.request().method() === "GET" &&
        response
          .url()
          .startsWith(
            `${stack.treasuryApiUrl}/voting-ledger/lifecycles/0/accounts/`,
          ) &&
        response.ok()
      ) {
        const result = await response.json();
        if (
          result.lifecycleId === "0" &&
          typeof result.voteWeight === "string" &&
          response.url().endsWith(`/${result.publicKey}`)
        )
          votingWeights.set(result.publicKey, result.voteWeight);
      }
      if (
        response.url() === stack.minaNodeUrl &&
        response.request().postData()?.includes("SendSignedZkapp")
      ) {
        const result = await response.json();
        const hash = result.data?.sendZkapp?.zkapp?.hash;
        if (hash) transactionHashes.push(hash);
      }
      if (
        response.request().method() === "POST" &&
        response.url().startsWith(`${stack.treasuryApiUrl}/proposals/`) &&
        response.url().endsWith("/content")
      ) {
        const result = await response.json();
        if (
          response.status() === 404 &&
          result.error === "proposal for submitted contents was not found"
        )
          contentRetries.add(response.url());
        if (response.ok() && result.ok === true)
          completedContent.add(response.url());
      }
    } catch (error) {
      pageErrors.push(`Response evidence read failed: ${String(error)}`);
    }
  });
  const activeAccount = { ...stack.proposer };
  const wallet = await installAuroTestWallet(page, activeAccount);
  const signed: Array<{ digest: string; command: unknown }> = [];
  try {
    const webUrl = await stack.startApp("web", await availablePort());
    const initial = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
    let proposal = "";
    const title = "Browser lifecycle payout";
    await test.step("Create the proposal through the real form", async () => {
      await page.goto(`${webUrl}/proposals/create`);
      await connect(page);
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page.getByLabel("Amount", { exact: true }).fill("1");
      await page
        .getByLabel("Recipient", { exact: true })
        .fill(stack.recipientPublicKey);
      await page
        .getByLabel("Content", { exact: true })
        .fill(`# ${title}\n\nApprove and execute a real browser payout.`);
      await page
        .getByRole("button", { name: "Create proposal", exact: true })
        .click();
      await expectTransactionSuccess(page, async () => {
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Sign and send", exact: true })
          .click();
        await expect(page).toHaveURL(/\/proposals\/B62/, {
          timeout: 1_800_000,
        });
      });
      proposal = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect(
        page.getByText(title, { exact: true }).first(),
      ).toBeVisible();
      expect(wallet.signedTransactions).toHaveLength(1);
      signed.push(...wallet.signedTransactions);
    });
    const route = `${webUrl}/proposals/${proposal}`;
    const apiRoute = `${stack.treasuryApiUrl}/proposals/${proposal}`;
    async function selectAccount(
      selected: LocalAccount,
      targetRoute = route,
      targetTitle = title,
    ) {
      await page.locator('button[data-wallet-status="connected"]').click();
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
      // Switch the local extension's account and key, then reconnect normally.
      // The private key remains in this Node process, never in the browser.
      Object.assign(activeAccount, selected);
      wallet.changeAccount(selected.publicKey);
      wallet.signedTransactions.length = 0;
      await page.goto(targetRoute);
      await expect(
        page.getByText(targetTitle, { exact: true }).first(),
      ).toBeVisible();
      await connect(page);
    }
    await test.step("Reject pre-voting actions without a signature or transaction", async () => {
      const assertUnchanged = await unchangedBrowserState(
        page,
        stack,
        "pre-voting",
      );
      const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
      await expect(
        page.getByText("Waiting for voting to start", { exact: true }),
      ).toBeVisible();
      for (const choice of ["Yay", "Nay", "Abstain"])
        await expect(
          page.getByRole("button", { name: choice, exact: true }),
        ).toBeDisabled();
      expect(wallet.signedTransactions).toHaveLength(1);
      expect(
        (await readJson<AdminState>(`${stack.baseUrl}/admin/state`))
          .submittedTransactions,
      ).toBe(before.submittedTransactions);
      await assertUnchanged();
    });
    await setLifecycleSlot(stack, 400);
    await test.step("Reject a funded wallet absent from the voting snapshot", async () => {
      const outsider = initial.testAccounts[5];
      expect(outsider).toBeDefined();
      await selectAccount(outsider!);
      const assertUnchanged = await unchangedBrowserState(
        page,
        stack,
        "zero-weight",
        [outsider!.publicKey],
      );
      const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
      await expect(
        page.getByText("Zero voting weight", { exact: true }),
      ).toBeVisible();
      for (const choice of ["Yay", "Nay", "Abstain"])
        await expect(
          page.getByRole("button", { name: choice, exact: true }),
        ).toBeDisabled();
      expect(wallet.signedTransactions).toHaveLength(0);
      expect(
        (await readJson<AdminState>(`${stack.baseUrl}/admin/state`))
          .submittedTransactions,
      ).toBe(before.submittedTransactions);
      await assertUnchanged();
    });
    const voteEvidence: unknown[] = [];
    for (const [index, voter] of initial.testAccounts.slice(0, 5).entries()) {
      await test.step(`Eligible voter ${index + 1}: submit Yay through the wallet dialog`, async () => {
        await selectAccount(voter);
        const before = await account(stack, voter.publicKey);
        const chainBefore = await readJson<AdminState>(
          `${stack.baseUrl}/admin/state`,
        );
        await page.getByRole("button", { name: "Yay", exact: true }).click();
        await expectTransactionSuccess(page, async () => {
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Sign and send", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0, {
            timeout: 1_800_000,
          });
        });
        expect(wallet.signedTransactions).toHaveLength(1);
        const command = wallet.signedTransactions[0]!.command as Command;
        const after = await account(stack, voter.publicKey);
        expect(Number(after.nonce)).toBe(Number(before.nonce) + 1);
        expect(BigInt(before.balance.total) - BigInt(after.balance.total)).toBe(
          BigInt(command.feePayer.body.fee),
        );
        expect(
          (await readJson<AdminState>(`${stack.baseUrl}/admin/state`))
            .submittedTransactions,
        ).toBe(chainBefore.submittedTransactions + 1);
        await expect
          .poll(
            async () =>
              (await readJson<{ total: number }>(`${apiRoute}/votes`)).total,
          )
          .toBe(index + 1);
        const votes = await readJson<{ items: Vote[] }>(`${apiRoute}/votes`);
        expect(
          votes.items.find((vote) => vote.voterPublicKey === voter.publicKey),
        ).toMatchObject({ vote: "yay", voteWeight: "100000000000" });
        await expect(
          page.getByText(voter.publicKey, { exact: true }).last(),
        ).toBeVisible();
        signed.push(...wallet.signedTransactions);
        voteEvidence.push({
          voter: voter.publicKey,
          before,
          after,
          command: wallet.signedTransactions[0],
        });
      });
    }
    evidence.votes = voteEvidence;
    await test.step("Operator reduces actual Archive actions and submits a tally", async () => {
      await setLifecycleSlot(stack, 600);
      evidence.tally = await tallyBrowserVotes(stack, proposal);
      await expect
        .poll(async () => (await readJson<Proposal>(apiRoute)).contractStatus)
        .toBe("approved");
      const state = parseCliJson<{ status: string }>(
        await stack.cli([
          "proposal",
          "read-state",
          "--treasury-owner-public-key",
          stack.treasuryOwnerPublicKey,
          "--proposal-public-key",
          proposal,
        ]),
        "proposalAddress",
      );
      expect(state.status).toBe("approved");
      evidence.approvedState = state;
      await page.reload();
      await expect(
        page.getByRole("button", {
          name: "Available post-cooldown",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Yay", exact: true }),
      ).toHaveCount(0);
    });
    // Exclude lifecycle 0's recipient (index 3), so its payout balance stays
    // unchanged throughout the second lifecycle. Index 5 was previously ineligible.
    const secondVoters = [0, 1, 2, 4, 5].map(
      (index) => initial.testAccounts[index]!,
    );
    const secondSnapshot =
      await test.step("Operator prepares lifecycle 1 with distinct staking weights and membership", () =>
        prepareSecondLifecycle(stack, secondVoters));
    await setLifecycleSlot(stack, 800);
    await selectAccount(stack.proposer);
    for (const scenario of [
      {
        name: "zero payout",
        value: "0",
        error: "Payout amount must be greater than zero.",
      },
      {
        name: "payout exceeds remaining",
        value: "2",
        error: "Payout amount cannot exceed the remaining payout of 1.1 MINA.",
      },
    ]) {
      await test.step(`Reject ${scenario.name} before signing`, async () => {
        const assertUnchanged = await unchangedBrowserState(
          page,
          stack,
          scenario.name,
        );
        const before = await readJson<AdminState>(
          `${stack.baseUrl}/admin/state`,
        );
        await page
          .getByLabel("Payout amount", { exact: true })
          .fill(scenario.value);
        await expect(
          page.getByText(scenario.error, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Execute proposal", exact: true }),
        ).toBeDisabled();
        expect(wallet.signedTransactions).toHaveLength(0);
        expect(
          (await readJson<AdminState>(`${stack.baseUrl}/admin/state`))
            .submittedTransactions,
        ).toBe(before.submittedTransactions);
        await assertUnchanged();
      });
    }
    await test.step("Execute the complete approved payout and reconcile chain, API and browser", async () => {
      const senderBefore = await account(stack, stack.proposer.publicKey);
      const recipientBefore = await account(stack, stack.recipientPublicKey);
      const treasuryBefore = await account(stack, stack.treasuryOwnerPublicKey);
      await page.getByLabel("Payout amount", { exact: true }).fill("1.1");
      await page
        .getByRole("button", { name: "Execute proposal", exact: true })
        .click();
      await expectTransactionSuccess(page, async () => {
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Sign and send", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0, {
          timeout: 1_800_000,
        });
      });
      expect(wallet.signedTransactions).toHaveLength(1);
      const command = wallet.signedTransactions[0]!.command as Command;
      const senderAfter = await account(stack, stack.proposer.publicKey);
      const recipientAfter = await account(stack, stack.recipientPublicKey);
      const treasuryAfter = await account(stack, stack.treasuryOwnerPublicKey);
      expect(Number(senderAfter.nonce)).toBe(Number(senderBefore.nonce) + 1);
      expect(
        BigInt(senderBefore.balance.total) - BigInt(senderAfter.balance.total),
      ).toBe(BigInt(command.feePayer.body.fee));
      expect(
        BigInt(recipientAfter.balance.total) -
          BigInt(recipientBefore.balance.total),
      ).toBe(1_100_000_000n);
      expect(
        BigInt(treasuryBefore.balance.total) -
          BigInt(treasuryAfter.balance.total),
      ).toBe(1_100_000_000n);
      await expect
        .poll(async () => (await readJson<Proposal>(apiRoute)).paidOutAmount)
        .toBe("1100000000");
      await expect
        .poll(
          async () =>
            (await readJson<{ total: number }>(`${apiRoute}/executions`)).total,
        )
        .toBe(1);
      const executions = await readJson<{ items: Execution[] }>(
        `${apiRoute}/executions`,
      );
      expect(executions.items).toHaveLength(1);
      expect(executions.items[0]).toMatchObject({
        recipient: stack.recipientPublicKey,
        amountToPayOut: "1100000000",
        senderPublicKey: stack.proposer.publicKey,
        paidOutAmount: "1100000000",
        remainingAmount: "0",
      });
      const final = await readJson<Proposal>(apiRoute);
      expect(final.remainingPayoutAmount).toBe("0");
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Fully paid out", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Payout amount", { exact: true }),
      ).toBeDisabled();
      const chainState = parseCliJson<{ paidOutAmount: string }>(
        await stack.cli([
          "proposal",
          "read-state",
          "--treasury-owner-public-key",
          stack.treasuryOwnerPublicKey,
          "--proposal-public-key",
          proposal,
        ]),
        "proposalAddress",
      );
      expect(chainState.paidOutAmount).toBe("1100000000");
      signed.push(...wallet.signedTransactions);
      evidence.execution = {
        senderBefore,
        senderAfter,
        recipientBefore,
        recipientAfter,
        treasuryBefore,
        treasuryAfter,
        executions,
        final,
        chainState,
      };
    });
    expect(signed).toHaveLength(7);
    expect(transactionHashes).toHaveLength(7);
    const indexed = await readJson<{
      items: Array<{ eventType: string; txHash: string }>;
    }>(
      `${stack.indexerApiUrl}/events?eventTypes=proposalCreated,proposalVoteDispatched,proposalExecuted&limit=50`,
    );
    for (const [index, txHash] of transactionHashes.entries()) {
      const eventType =
        index === 0
          ? "proposalCreated"
          : index === 6
            ? "proposalExecuted"
            : "proposalVoteDispatched";
      expect(
        indexed.items.filter(
          (event) => event.txHash === txHash && event.eventType === eventType,
        ),
      ).toHaveLength(1);
    }
    expect(modes).toHaveLength(7);
    expect(modes.every((mode) => mode === stack.proofsEnabled)).toBe(true);
    expect(
      (await readJson<AdminState>(`${stack.baseUrl}/admin/state`))
        .submittedTransactions,
    ).toBe(initial.submittedTransactions + 8);
    expect(pageErrors).toEqual([]);
    expect(
      errors.filter(
        ({ text, url }) =>
          !(
            text ===
              "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
            ((contentRetries.has(url) && completedContent.has(url)) ||
              (absentStakingAccounts.has(url) &&
                votingWeights.get(absentStakingAccounts.get(url)!) === "0"))
          ),
      ),
    ).toEqual([]);
    evidence.proposal = proposal;
    evidence.signed = signed;
    evidence.effectiveModes = modes;
    evidence.transactionHashes = transactionHashes;
    evidence.indexed = indexed;
    evidence.absentStakingAccounts = [...absentStakingAccounts];
    evidence.secondLifecycle = await completeSecondLifecycle({
      page,
      stack,
      webUrl,
      firstProposal: proposal,
      snapshot: secondSnapshot,
      voters: secondVoters,
      recipient: initial.testAccounts[6]!.publicKey,
      wallet,
      selectAccount,
    });
    expect(modes).toHaveLength(14);
    expect(modes.every((mode) => mode === stack.proofsEnabled)).toBe(true);
    expect(transactionHashes).toHaveLength(14);
    expect(pageErrors).toEqual([]);
    expect(
      errors.filter(
        ({ text, url }) =>
          !(
            text ===
              "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
            ((contentRetries.has(url) && completedContent.has(url)) ||
              (absentStakingAccounts.has(url) &&
                votingWeights.get(absentStakingAccounts.get(url)!) === "0"))
          ),
      ),
    ).toEqual([]);
  } finally {
    await testInfo.attach("lifecycle-evidence", {
      contentType: "application/json",
      body: JSON.stringify(evidence, null, 2),
    });
    await stack.dispose();
  }
});
