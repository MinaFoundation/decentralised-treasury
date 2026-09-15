import type { Page } from "@playwright/test";
import { expect, test } from "./utils/browser-test";
import {
  availablePort,
  readJson,
  startLocalTreasuryStack,
  waitForUrl,
  type AdminState,
  type LocalTreasuryStack,
} from "./utils/local-treasury-stack";
import { installAuroTestWallet } from "./utils/auro-test-wallet";
import { expectTransactionSuccess } from "./utils/transaction-success";
import {
  snapshotProtectedState,
  unchangedBrowserState,
} from "./utils/unchanged-state";
import { PublicKey, TokenId } from "o1js";

let stack: LocalTreasuryStack;
let webUrl: string;

async function account(
  publicKey: string,
  tokenId = TokenId.toBase58(TokenId.default),
) {
  const response = await fetch(stack.minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}", token: "${tokenId}") { nonce balance { total } zkappState } }`,
    }),
  });
  expect(response.ok).toBe(true);
  const payload = (await response.json()) as {
    data: {
      account: {
        nonce: string;
        balance: { total: string };
        zkappState: string[];
      } | null;
    };
  };
  expect(payload.data.account).not.toBeNull();
  return payload.data.account!;
}

test.beforeAll(async () => {
  stack = await startLocalTreasuryStack();
  webUrl = await stack.startApp("web", await availablePort());
});
test.afterAll(async () => {
  await stack?.dispose();
});

async function connectWallet(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function fillProposal(page: Page, title: string) {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Amount", { exact: true }).fill(stack.proposalAmount);
  await page
    .getByLabel("Recipient", { exact: true })
    .fill(stack.recipientPublicKey);
  await page
    .getByLabel("Content", { exact: true })
    .fill(`# ${title}\n\nFund a public treasury test deliverable.`);
}

for (const scenario of [
  {
    id: "S40-001",
    name: "desktop dashboard and list",
    viewport: { width: 1440, height: 1000 },
  },
  {
    id: "S40-014",
    name: "mobile dashboard and list",
    viewport: { width: 390, height: 844 },
  },
]) {
  test(`${scenario.id}: ${scenario.name} uses the selected runtime mode`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize(scenario.viewport);
    await page.goto(webUrl);
    if (scenario.viewport.width < 1280) {
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    const runtime = await page.evaluate(
      () =>
        (
          window as unknown as {
            __TREASURY_RUNTIME_CONFIG__: {
              proofsEnabled: string;
              treasuryOwnerContractAddress: string;
              minaNodeUrl: string;
            };
          }
        ).__TREASURY_RUNTIME_CONFIG__,
    );
    expect(runtime.proofsEnabled).toBe(String(stack.proofsEnabled));
    expect(runtime.treasuryOwnerContractAddress).toBe(
      stack.treasuryOwnerPublicKey,
    );
    expect(runtime.minaNodeUrl).toBe(stack.minaNodeUrl);
    await page.goto(`${webUrl}/proposals`);
    await expect(
      page.getByRole("button", { name: "Create proposal", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const scenario of [
  {
    name: "missing title",
    field: "Title",
    value: "",
    message: "Enter a proposal title.",
  },
  {
    name: "zero amount",
    field: "Amount",
    value: "0",
    message: "Requested amount must be greater than zero.",
  },
  {
    name: "missing content",
    field: "Content",
    value: "",
    message: "Enter proposal content in markdown.",
  },
]) {
  test(`S40-008: ${scenario.name} stops before wallet signing`, async ({
    page,
  }) => {
    const wallet = await installAuroTestWallet(page, stack.proposer);
    await page.goto(`${webUrl}/proposals/create`);
    await connectWallet(page);
    await fillProposal(page, "Invalid proposal example");
    await page.getByLabel(scenario.field, { exact: true }).fill(scenario.value);
    const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
    const assertUnchanged = await unchangedBrowserState(
      page,
      stack,
      scenario.name,
    );
    await expect(
      page.getByRole("button", { name: "Create proposal", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(scenario.message, { exact: true }),
    ).toBeVisible();
    expect(wallet.signedTransactions).toHaveLength(0);
    const after = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
    expect(after.submittedTransactions).toBe(before.submittedTransactions);
    await assertUnchanged();
  });
}

test("S40-002/003/004: a funded wallet creates a proposal through the real form and services", async ({
  page,
}, testInfo) => {
  const wallet = await installAuroTestWallet(page, stack.proposer);
  const errors: string[] = [];
  const consoleErrors: Array<{ text: string; url: string }> = [];
  const retryableContentUrls = new Set<string>();
  const completedContentUrls = new Set<string>();
  const effectiveModes: boolean[] = [];
  const transactionHashes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", async (message) => {
    try {
      if (message.type() === "error")
        consoleErrors.push({
          text: message.text(),
          url: message.location().url,
        });
      if (message.text().includes("effective transaction proof mode")) {
        const value = (await message.args()[1]?.jsonValue()) as
          | { proofsEnabled?: boolean }
          | undefined;
        if (typeof value?.proofsEnabled === "boolean")
          effectiveModes.push(value.proofsEnabled);
      }
    } catch (error) {
      errors.push(`Console evidence read failed: ${String(error)}`);
    }
  });
  page.on("response", async (response) => {
    try {
      if (
        response.request().method() === "POST" &&
        response.url().startsWith(`${stack.treasuryApiUrl}/proposals/`) &&
        response.url().endsWith("/content")
      ) {
        const payload = await response.json();
        if (
          response.status() === 404 &&
          payload.error === "proposal for submitted contents was not found"
        ) {
          retryableContentUrls.add(response.url());
        }
        if (response.ok() && payload.ok === true)
          completedContentUrls.add(response.url());
      }
      if (
        response.url() === stack.minaNodeUrl &&
        response.request().postData()?.includes("SendSignedZkapp")
      ) {
        const payload = await response.json();
        const hash = payload.data?.sendZkapp?.zkapp?.hash;
        if (hash) transactionHashes.push(hash);
      }
    } catch (error) {
      errors.push(`Response evidence read failed: ${String(error)}`);
    }
  });
  await page.goto(`${webUrl}/proposals/create`);
  await connectWallet(page);
  const title = `Browser proposal ${stack.proofsEnabled ? "proofs" : "local"}`;
  await fillProposal(page, title);
  const senderBefore = await account(stack.proposer.publicKey);
  const ownerBefore = await account(stack.treasuryOwnerPublicKey);
  const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  await page
    .getByRole("button", { name: "Create proposal", exact: true })
    .click();
  await expectTransactionSuccess(page, async () => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign and send", exact: true })
      .click();
    await expect(page).toHaveURL(/\/proposals\/B62/, {
      timeout: Number(process.env.E2E_CASE_TIMEOUT_MS ?? 1_800_000),
    });
  });
  const proposalPublicKey = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  expect(wallet.signedTransactions).toHaveLength(1);
  expect(transactionHashes).toHaveLength(1);
  expect(effectiveModes).toContain(stack.proofsEnabled);
  expect(effectiveModes.every((mode) => mode === stack.proofsEnabled)).toBe(
    true,
  );
  const after = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  expect(after.submittedTransactions).toBe(before.submittedTransactions + 1);
  const proposal = await readJson<Record<string, unknown>>(
    `${stack.treasuryApiUrl}/proposals/${proposalPublicKey}`,
  );
  expect(proposal.proposalPublicKey).toBe(proposalPublicKey);
  expect(proposal.amount).toBe("1000000000");
  expect(proposal.recipient).toBe(stack.recipientPublicKey);
  expect(proposal.contents).toContain(title);
  const senderAfter = await account(stack.proposer.publicKey);
  const ownerAfter = await account(stack.treasuryOwnerPublicKey);
  const signedCommand = wallet.signedTransactions[0]!.command as {
    feePayer: { body: { fee: string } };
  };
  expect(Number(senderAfter.nonce)).toBe(Number(senderBefore.nonce) + 1);
  expect(
    BigInt(senderBefore.balance.total) - BigInt(senderAfter.balance.total),
  ).toBe(
    BigInt(signedCommand.feePayer.body.fee) + 1_000_000_000n + 100_000_000n,
  );
  expect(
    BigInt(ownerAfter.balance.total) - BigInt(ownerBefore.balance.total),
  ).toBe(100_000_000n);
  const proposalAccount = await account(
    proposalPublicKey,
    TokenId.toBase58(
      TokenId.derive(PublicKey.fromBase58(stack.treasuryOwnerPublicKey)),
    ),
  );
  expect(proposalAccount.zkappState[1]).toBe("1000000000");
  expect(proposalAccount.zkappState[2]).toBe("0");
  const events = await readJson<{
    items: Array<{ eventType: string; txHash: string }>;
  }>(`${stack.indexerApiUrl}/events?eventTypes=proposalCreated&limit=50`);
  expect(
    events.items.filter((event) => event.txHash === transactionHashes[0]),
  ).toHaveLength(1);
  await page.reload();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  // The application retries this documented indexing race. Permit its browser
  // resource message only after the exact endpoint accepts the content.
  errors.push(
    ...consoleErrors
      .filter(
        ({ text, url }) =>
          !(
            text ===
              "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
            retryableContentUrls.has(url) &&
            completedContentUrls.has(url)
          ),
      )
      .map(({ text }) => text),
  );
  expect(errors).toEqual([]);
  await testInfo.attach("transaction-evidence", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        proofsEnabled: stack.proofsEnabled,
        effectiveModes,
        retryableContentUrls: [...retryableContentUrls],
        completedContentUrls: [...completedContentUrls],
        proposalPublicKey,
        transactionHashes,
        beforeSubmitted: before.submittedTransactions,
        afterSubmitted: after.submittedTransactions,
        unsignedDigest: wallet.signedTransactions[0]!.digest,
        proposal,
        senderBefore,
        senderAfter,
        ownerBefore,
        ownerAfter,
        proposalAccount,
        events,
      },
      null,
      2,
    ),
  });
});

test("S40-009: a wallet rejection leaves the local chain unchanged", async ({
  page,
}) => {
  const wallet = await installAuroTestWallet(page, stack.proposer);
  wallet.rejectSigning("The user rejected the transaction.");
  await page.goto(`${webUrl}/proposals/create`);
  await connectWallet(page);
  await fillProposal(page, "Rejected browser proposal");
  const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  const assertUnchanged = await unchangedBrowserState(
    page,
    stack,
    "wallet-rejection",
  );
  await page
    .getByRole("button", { name: "Create proposal", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign and send", exact: true })
    .click();
  await expect(
    page
      .getByText("The user rejected the transaction.", { exact: true })
      .first(),
  ).toBeVisible({ timeout: 1_800_000 });
  expect(wallet.signedTransactions).toHaveLength(0);
  const after = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  expect(after.submittedTransactions).toBe(before.submittedTransactions);
  await assertUnchanged();
});

test("S40-011: missing treasury address stops before signing", async ({
  page,
}) => {
  const wallet = await installAuroTestWallet(page, stack.proposer);
  await page.addInitScript(() => {
    let config: Record<string, unknown>;
    Object.defineProperty(window, "__TREASURY_RUNTIME_CONFIG__", {
      configurable: true,
      get: () => config,
      set: (value: Record<string, unknown>) => {
        config = { ...value, treasuryOwnerContractAddress: "" };
      },
    });
  });
  await page.goto(`${webUrl}/proposals/create`);
  await expect(
    page.getByText("Proposal creation is not configured", { exact: true }),
  ).toBeVisible();
  await connectWallet(page);
  await fillProposal(page, "Missing deployment configuration");
  const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  const assertUnchanged = await unchangedBrowserState(
    page,
    stack,
    "missing-config",
  );
  await page
    .getByRole("button", { name: "Create proposal", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign and send", exact: true })
    .click();
  await expect(
    page
      .getByText("Proposal creation is not configured.", { exact: true })
      .first(),
  ).toBeVisible();
  expect(wallet.signedTransactions).toHaveLength(0);
  const after = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  expect(after.submittedTransactions).toBe(before.submittedTransactions);
  await assertUnchanged();
});

for (const scenario of [
  { name: "extension account notification", notified: true },
  { name: "changed extension account without notification", notified: false },
]) {
  test(`S40-009: ${scenario.name} during confirmation prevents signing`, async ({
    page,
  }) => {
    const wallet = await installAuroTestWallet(page, stack.proposer);
    await page.goto(`${webUrl}/proposals/create`);
    await connectWallet(page);
    await fillProposal(page, "Account changed at confirmation");
    await page
      .getByRole("button", { name: "Create proposal", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign and send", exact: true }),
    ).toBeVisible();
    const assertUnchanged = await unchangedBrowserState(
      page,
      stack,
      scenario.name,
      [stack.voter1.publicKey],
    );
    if (scenario.notified) {
      await wallet.notifyAccountChange(stack.voter1.publicKey);
    } else wallet.changeAccount(stack.voter1.publicKey);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign and send", exact: true })
      .click();
    const message = scenario.notified
      ? "The connected wallet does not match the transaction sender."
      : `Auro is using ${stack.voter1.publicKey}, not ${stack.proposer.publicKey}.`;
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible({
      timeout: 1_800_000,
    });
    expect(wallet.signedTransactions).toHaveLength(0);
    await assertUnchanged();
  });
}

type RetryRecord = {
  proposalPublicKey: string;
  transactionHash: string;
  contents: string;
  zkAppUriHash: string;
  lastError: string;
};
const retryRecords = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("treasury-proposal-content-retries") ?? "[]",
      ) as RetryRecord[],
  );

for (const scenario of [
  { name: "detail Retry content upload", detail: true },
  { name: "dialog Try again after inclusion", detail: false },
]) {
  test(`S40-005: ${scenario.name} recovers a real API outage without another transaction`, async ({
    page,
  }, testInfo) => {
    const wallet = await installAuroTestWallet(page, stack.proposer);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const transactionHashes: string[] = [];
    const failedStages: string[] = [];
    page.on("console", async (message) => {
      if (!message.text().startsWith("[transaction-flow] step failed")) return;
      try {
        const detail = (await message.args()[1]?.jsonValue()) as
          | { failedStageId?: string }
          | undefined;
        failedStages.push(detail?.failedStageId ?? "unknown");
      } catch (error) {
        pageErrors.push(`Failure-stage evidence read failed: ${String(error)}`);
      }
    });
    page.on("response", async (response) => {
      try {
        if (
          response.url() === stack.minaNodeUrl &&
          response.request().postData()?.includes("SendSignedZkapp")
        ) {
          const payload = await response.json();
          const hash = payload.data?.sendZkapp?.zkapp?.hash;
          if (hash) transactionHashes.push(hash);
        }
      } catch (error) {
        pageErrors.push(`Response evidence read failed: ${String(error)}`);
      }
    });
    await page.goto(`${webUrl}/proposals/create`);
    await connectWallet(page);
    const title = `Content outage recovery through ${scenario.name}`;
    await fillProposal(page, title);
    const originalContents = await page
      .getByLabel("Content", { exact: true })
      .inputValue();
    await page
      .getByRole("button", { name: "Create proposal", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign and send", exact: true }),
    ).toBeVisible();
    const before = await snapshotProtectedState(stack);
    let stopped = false;
    try {
      await stack.services.stop("app-api");
      stopped = true;
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign and send", exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Try again", exact: true }),
      ).toBeVisible({ timeout: 1_800_000 });
      await expect.poll(() => failedStages).toEqual(["postingContent"]);
      expect(wallet.signedTransactions).toHaveLength(1);
      expect(transactionHashes).toHaveLength(1);
      const records = await retryRecords(page);
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.transactionHash).toBe(transactionHashes[0]);
      expect(record.contents).toBe(originalContents);
      expect(record.lastError).toBeTruthy();
      const included = await readJson<AdminState>(
        `${stack.baseUrl}/admin/state`,
      );
      expect(included.submittedTransactions).toBe(before.transactions + 1);
      stack.services.start("app-api");
      stopped = false;
      await waitForUrl(`${stack.treasuryApiUrl}/readyz`);
      const apiRoute = `${stack.treasuryApiUrl}/proposals/${record.proposalPublicKey}`;
      const projected = await readJson<{
        id: string;
        contents: string | null;
        zkAppUriHash: string;
      }>(apiRoute);
      expect(projected.contents).toBeNull();
      expect(projected.zkAppUriHash).toBe(record.zkAppUriHash);
      const recoveryBefore = await snapshotProtectedState(stack);
      const acceptedContent = page
        .waitForResponse(
          (response) =>
            response.url() === `${apiRoute}/content` &&
            response.request().method() === "POST" &&
            response.ok(),
          { timeout: 120_000 },
        )
        .then(
          (response) => ({ response, error: undefined }),
          (error: unknown) => ({ response: undefined, error }),
        );
      if (scenario.detail) {
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await page.goto(`${webUrl}/proposals/${record.proposalPublicKey}`);
        await expect(
          page.getByText("Proposal content needs upload", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Retry content upload", exact: true })
          .click();
      } else {
        await expectTransactionSuccess(page, async () => {
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Try again", exact: true })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`/proposals/${record.proposalPublicKey}$`),
            { timeout: 120_000 },
          );
        });
      }
      // Observe rejection immediately above, even if a UI assertion fails first.
      const contentResult = await acceptedContent;
      if (contentResult.error) throw contentResult.error;
      const contentResponse = contentResult.response!;
      expect(await contentResponse.json()).toMatchObject({
        ok: true,
        proposalPublicKey: record.proposalPublicKey,
      });
      const recovered = await readJson<{ id: string; contents: string }>(
        apiRoute,
      );
      expect(recovered.id).toBe(projected.id);
      expect(recovered.contents).toBe(originalContents);
      expect(await retryRecords(page)).toEqual([]);
      expect(wallet.signedTransactions).toHaveLength(1);
      expect(transactionHashes).toEqual([record.transactionHash]);
      const recoveryAfter = await snapshotProtectedState(stack);
      expect({ ...recoveryAfter, proposalList: undefined }).toEqual({
        ...recoveryBefore,
        proposalList: undefined,
      });
      expect(recoveryAfter.proposalList.total).toBe(
        recoveryBefore.proposalList.total,
      );
      expect(
        recoveryAfter.proposalList.items.map((row) => ({
          ...row,
          contents: undefined,
        })),
      ).toEqual(
        recoveryBefore.proposalList.items.map((row) => ({
          ...row,
          contents: undefined,
        })),
      );
      await page.reload();
      await expect(
        page.getByText(title, { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Retry content upload", exact: true }),
      ).toHaveCount(0);
      expect(pageErrors).toEqual([]);
      expect(failedStages).toEqual(["postingContent"]);
      await testInfo.attach("content-recovery-evidence", {
        contentType: "application/json",
        body: JSON.stringify({
          mode: stack.proofsEnabled,
          scenario: scenario.name,
          record,
          projected,
          recovered,
          recoveryBefore,
          recoveryAfter,
          transactionHashes,
          failedStages,
        }),
      });
    } finally {
      if (stopped) stack.services.start("app-api");
    }
  });
}
