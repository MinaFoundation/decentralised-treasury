import type { Page } from "@playwright/test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test } from "./browser-test";
import {
  readJson,
  parseCliJson,
  type AdminState,
  type LocalAccount,
  type LocalTreasuryStack,
} from "./local-treasury-stack";
import { setLifecycleSlot, tallyBrowserVotes } from "./lifecycle-operator";
import { snapshotProtectedState } from "./unchanged-state";
import { expectTransactionSuccess } from "./transaction-success";
import type { installAuroTestWallet } from "./auro-test-wallet";
import { lifecycleExpectations } from "./lifecycle-expectations";

type Snapshot = {
  outputPath: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
};

export async function prepareSecondLifecycle(
  stack: LocalTreasuryStack,
  voters: LocalAccount[],
) {
  expect(voters).toHaveLength(5);
  const snapshot = parseCliJson<Snapshot>(
    await stack.cli([
      "staking-ledger",
      "create-development-snapshot",
      "--output-path",
      join(stack.artifactDirectory, "staking-ledger-1.json"),
      "--treasury-owner-public-key",
      stack.treasuryOwnerPublicKey,
      "--voter-balance",
      "200",
      ...voters.flatMap((voter, index) => [
        `--voter-${index + 1}-public-key`,
        voter.publicKey,
      ]),
    ]),
    "stakingEpochDataLedgerHash",
  );
  await importSnapshot(stack, "1", snapshot.outputPath);
  const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  // Documented simulator epoch setup. Contract state is not changed here.
  const response = await fetch(`${stack.baseUrl}/admin/network-state`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        snapshot.stakingEpochDataLedgerTotalCurrency,
    }),
  });
  expect(response.ok).toBe(true);
  const after = await readJson<
    AdminState & {
      stakingEpochDataLedgerHash: string;
      stakingEpochDataLedgerTotalCurrency: string;
    }
  >(`${stack.baseUrl}/admin/state`);
  expect(after.currentSlot).toBe(before.currentSlot);
  expect(after.submittedTransactions).toBe(before.submittedTransactions);
  expect(after.stakingEpochDataLedgerHash).toBe(
    snapshot.stakingEpochDataLedgerHash,
  );
  expect(after.stakingEpochDataLedgerTotalCurrency).toBe(
    snapshot.stakingEpochDataLedgerTotalCurrency,
  );
  return snapshot;
}

async function importSnapshot(
  stack: LocalTreasuryStack,
  lifecycleId: string,
  path: string,
) {
  await stack.cli([
    "staking-ledger",
    "from-file",
    "--lifecycle-id",
    lifecycleId,
    "--staking-ledger-path",
    path,
  ]);
  await stack.cli([
    "staking-ledger-to-voting-ledger",
    "trace-digest",
    "--lifecycle-id",
    lifecycleId,
  ]);
}

async function proposalState(stack: LocalTreasuryStack, proposal: string) {
  return parseCliJson<Record<string, string>>(
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
}

async function readProofRoots(stack: LocalTreasuryStack, filename: string) {
  const artifact = JSON.parse(
    await readFile(join(stack.artifactDirectory, filename), "utf8"),
  ) as { publicInput: string[]; publicOutput: string[] };
  // Serialized field order from StakingLedgerToVotingLedgerProgramInput/Output
  // in packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts.
  // This reads generated artifacts; the actual CLI tally verifies their proofs.
  expect(artifact.publicInput).toHaveLength(3);
  expect(artifact.publicOutput).toHaveLength(3);
  expect(artifact.publicOutput[2]).toBe("1");
  for (const field of [...artifact.publicInput, ...artifact.publicOutput])
    expect(field).toMatch(/^[0-9]+$/);
  return {
    stakingLedgerRoot: artifact.publicInput[1]!,
    votingLedgerRoot: artifact.publicOutput[1]!,
  };
}

async function balance(stack: LocalTreasuryStack, publicKey: string) {
  const response = await fetch(stack.minaNodeUrl, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}") { nonce balance { total } } }`,
    }),
  });
  expect(response.ok).toBe(true);
  const value = await response.json();
  expect(value.errors).toBeUndefined();
  expect(value.data.account).not.toBeNull();
  return value.data.account as { nonce: string; balance: { total: string } };
}

/** A second actor lifecycle on the existing deployment and backend. */
export async function completeSecondLifecycle(input: {
  page: Page;
  stack: LocalTreasuryStack;
  webUrl: string;
  firstProposal: string;
  snapshot: Snapshot;
  voters: LocalAccount[];
  recipient: string;
  wallet: Awaited<ReturnType<typeof installAuroTestWallet>>;
  selectAccount: (
    account: LocalAccount,
    route?: string,
    title?: string,
  ) => Promise<void>;
}) {
  const {
    page,
    stack,
    webUrl,
    firstProposal,
    snapshot,
    voters,
    recipient,
    wallet,
    selectAccount,
  } = input;
  const initial = await snapshotProtectedState(stack);
  const originalState = await proposalState(stack, firstProposal);
  const originalProjection = await readJson<Record<string, unknown>>(
    `${stack.treasuryApiUrl}/proposals/${firstProposal}`,
  );
  const originalRoots = await readProofRoots(stack, "staking-exhausted.json");
  expect(originalRoots.stakingLedgerRoot).toBe(
    originalState.stakingEpochDataLedgerHash,
  );
  const firstCriteria = lifecycleExpectations(
    1_000_000_000n,
    1_000_000_000_000n,
    1_500_000_000_000n,
  );
  const { amountWithBond, ...secondCriteria } = lifecycleExpectations(
    2_000_000_000n,
    1_000_000_000_000n,
    2_000_000_000_000n,
  );
  expect(amountWithBond).toBe("2200000000");
  expect(secondCriteria).toEqual({
    requiredParticipationBp: "2115",
    requiredApprovalBp: "5137",
    requiredParticipation: "423000000000",
  });
  expect(
    await readJson<Record<string, unknown>>(
      `${stack.treasuryApiUrl}/proposals/${firstProposal}`,
    ),
  ).toMatchObject({
    requiredParticipationBp: firstCriteria.requiredParticipationBp,
    requiredApprovalBp: firstCriteria.requiredApprovalBp,
    requiredParticipation: firstCriteria.requiredParticipation,
  });
  expect(originalState).toMatchObject({
    lifecycleId: "0",
    paidOutAmount: "1100000000",
    status: "approved",
  });
  expect(snapshot.stakingEpochDataLedgerHash).not.toBe(
    originalState.stakingEpochDataLedgerHash,
  );
  expect(snapshot.stakingEpochDataLedgerTotalCurrency).toBe("2000000000000");
  expect(originalState.stakingEpochDataLedgerTotalCurrency).toBe(
    "1500000000000",
  );
  const firstEventIds = new Set(initial.events.map((event) => event.id));
  const control = (
    state: Awaited<ReturnType<typeof snapshotProtectedState>>,
  ) => ({
    account: state.accounts.find(
      (account) => account.publicKey === firstProposal,
    ),
    recipient: state.accounts.find(
      (account) => account.publicKey === stack.recipientPublicKey,
    ),
    proposal: state.proposalList.items.find(
      (row) => row.proposalPublicKey === firstProposal,
    ),
    projection: state.proposals.find(
      (proposal) => proposal.publicKey === firstProposal,
    ),
    events: state.events.filter((event) => firstEventIds.has(event.id)),
  });
  const beforeControl = control(initial);
  const controlEvidence: unknown[] = [];
  async function assertControl(stage: string) {
    const state = await snapshotProtectedState(stack);
    const current = control(state);
    expect(
      current,
      `Lifecycle 0 must stay unchanged after lifecycle 1 ${stage}`,
    ).toEqual(beforeControl);
    expect(await proposalState(stack, firstProposal)).toEqual(originalState);
    expect(
      await readJson<Record<string, unknown>>(
        `${stack.treasuryApiUrl}/proposals/${firstProposal}`,
      ),
    ).toEqual(originalProjection);
    const weight = await readJson<{ voteWeight: string }>(
      `${stack.treasuryApiUrl}/voting-ledger/lifecycles/0/accounts/${stack.proposer.publicKey}`,
    );
    expect(weight.voteWeight).toBe("100000000000");
    controlEvidence.push({ stage, control: current });
  }
  const title = "Lifecycle 1 uses a different staking snapshot";
  let proposal = "";
  const signed: Array<{ digest: string; command: unknown }> = [];
  await test.step("Lifecycle 1: create through Web with a new stored snapshot", async () => {
    wallet.signedTransactions.length = 0;
    const senderBefore = await balance(stack, stack.proposer.publicKey);
    const treasuryBefore = await balance(stack, stack.treasuryOwnerPublicKey);
    await page.goto(`${webUrl}/proposals/create`);
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Amount", { exact: true }).fill("2");
    await page.getByLabel("Recipient", { exact: true }).fill(recipient);
    await page
      .getByLabel("Content", { exact: true })
      .fill(`# ${title}\n\nKeep the completed lifecycle 0 proposal unchanged.`);
    await page
      .getByRole("button", { name: "Create proposal", exact: true })
      .click();
    await expectTransactionSuccess(page, async () => {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign and send", exact: true })
        .click();
      await expect(page).toHaveURL(/\/proposals\/B62/, { timeout: 1_800_000 });
    });
    proposal = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(proposal).not.toBe(firstProposal);
    expect(wallet.signedTransactions).toHaveLength(1);
    const command = wallet.signedTransactions[0]!.command as {
      feePayer: { body: { fee: string } };
    };
    const senderAfter = await balance(stack, stack.proposer.publicKey);
    const treasuryAfter = await balance(stack, stack.treasuryOwnerPublicKey);
    expect(Number(senderAfter.nonce)).toBe(Number(senderBefore.nonce) + 1);
    expect(
      BigInt(senderBefore.balance.total) - BigInt(senderAfter.balance.total),
    ).toBe(BigInt(command.feePayer.body.fee) + 1_000_000_000n + 200_000_000n);
    expect(
      BigInt(treasuryAfter.balance.total) -
        BigInt(treasuryBefore.balance.total),
    ).toBe(200_000_000n);
    signed.push(...wallet.signedTransactions);
    expect(await proposalState(stack, proposal)).toMatchObject({
      lifecycleId: "1",
      amount: "2000000000",
      paidOutAmount: "0",
      stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        snapshot.stakingEpochDataLedgerTotalCurrency,
    });
    expect(
      await readJson<Record<string, unknown>>(
        `${stack.treasuryApiUrl}/proposals/${proposal}`,
      ),
    ).toMatchObject({
      lifecycleId: 1,
      amount: "2000000000",
      recipient,
      contents: `# ${title}\n\nKeep the completed lifecycle 0 proposal unchanged.`,
      stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        snapshot.stakingEpochDataLedgerTotalCurrency,
    });
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await assertControl("creation");
  });
  const apiRoute = `${stack.treasuryApiUrl}/proposals/${proposal}`;
  const route = `${webUrl}/proposals/${proposal}`;
  await setLifecycleSlot(stack, 1200);
  for (const [index, voter] of voters.entries()) {
    await test.step(`Lifecycle 1: voter ${index + 1} submits Yay with weight 200 MINA`, async () => {
      await selectAccount(voter, route, title);
      const weight = await readJson<{ voteWeight: string }>(
        `${stack.treasuryApiUrl}/voting-ledger/lifecycles/1/accounts/${voter.publicKey}`,
      );
      expect(weight.voteWeight).toBe("200000000000");
      const before = await balance(stack, voter.publicKey);
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
      const after = await balance(stack, voter.publicKey);
      const command = wallet.signedTransactions[0]!.command as {
        feePayer: { body: { fee: string } };
      };
      expect(Number(after.nonce)).toBe(Number(before.nonce) + 1);
      expect(BigInt(before.balance.total) - BigInt(after.balance.total)).toBe(
        BigInt(command.feePayer.body.fee),
      );
      await expect
        .poll(
          async () =>
            (await readJson<{ total: number }>(`${apiRoute}/votes`)).total,
        )
        .toBe(index + 1);
      const votes = await readJson<{
        items: Array<{
          voterPublicKey: string;
          vote: string;
          voteWeight: string;
        }>;
      }>(`${apiRoute}/votes`);
      expect(
        votes.items.find((vote) => vote.voterPublicKey === voter.publicKey),
      ).toMatchObject({ vote: "yay", voteWeight: "200000000000" });
      await expect(
        page.getByText(voter.publicKey, { exact: true }).last(),
      ).toBeVisible();
      signed.push(...wallet.signedTransactions);
    });
  }
  await assertControl("five votes");
  let tally: { tallyTxHash: string };
  let secondRoots: Awaited<ReturnType<typeof readProofRoots>>;
  await test.step("Lifecycle 1: operator reduces and tallies its distinct Archive actions", async () => {
    await setLifecycleSlot(stack, 1400);
    tally = await tallyBrowserVotes(stack, proposal, "1");
    secondRoots = await readProofRoots(
      stack,
      "lifecycle-1-staking-exhausted.json",
    );
    expect(secondRoots.stakingLedgerRoot).toBe(
      snapshot.stakingEpochDataLedgerHash,
    );
    expect(secondRoots.votingLedgerRoot).not.toBe(
      originalRoots.votingLedgerRoot,
    );
    expect(await readProofRoots(stack, "staking-exhausted.json")).toEqual(
      originalRoots,
    );
    await expect
      .poll(
        async () =>
          (await readJson<{ contractStatus: string }>(apiRoute)).contractStatus,
      )
      .toBe("approved");
    expect(await readJson<Record<string, unknown>>(apiRoute)).toMatchObject({
      ...secondCriteria,
      finalVoteTally: {
        ...secondCriteria,
        yayWeight: "1000000000000",
        nayWeight: "0",
        abstainWeight: "0",
        totalParticipatingVotes: "1000000000000",
        approvalBp: "10000",
        voteResult: "approved",
      },
    });
    expect(await proposalState(stack, proposal)).toMatchObject({
      lifecycleId: "1",
      status: "approved",
      stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
    });
    await assertControl("tally");
  });
  // Execution begins in lifecycle 2; provide its wallet lookup data through CLI.
  // This does not create or complete a third proposal lifecycle.
  await importSnapshot(stack, "2", snapshot.outputPath);
  await setLifecycleSlot(stack, 1600);
  await test.step("Lifecycle 1: execute 2.2 MINA through Web and preserve lifecycle 0", async () => {
    await selectAccount(stack.proposer, route, title);
    const senderBefore = await balance(stack, stack.proposer.publicKey);
    const treasuryBefore = await balance(stack, stack.treasuryOwnerPublicKey);
    const recipientBefore = await balance(stack, recipient);
    await page.getByLabel("Payout amount", { exact: true }).fill("2.2");
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
    const command = wallet.signedTransactions[0]!.command as {
      feePayer: { body: { fee: string } };
    };
    const senderAfter = await balance(stack, stack.proposer.publicKey);
    expect(Number(senderAfter.nonce)).toBe(Number(senderBefore.nonce) + 1);
    expect(
      BigInt(senderBefore.balance.total) - BigInt(senderAfter.balance.total),
    ).toBe(BigInt(command.feePayer.body.fee));
    expect(
      BigInt((await balance(stack, recipient)).balance.total) -
        BigInt(recipientBefore.balance.total),
    ).toBe(2_200_000_000n);
    expect(
      BigInt(treasuryBefore.balance.total) -
        BigInt(
          (await balance(stack, stack.treasuryOwnerPublicKey)).balance.total,
        ),
    ).toBe(2_200_000_000n);
    await expect
      .poll(
        async () =>
          (await readJson<{ paidOutAmount: string }>(apiRoute)).paidOutAmount,
      )
      .toBe("2200000000");
    const execution = await readJson<{ total: number; items: unknown[] }>(
      `${apiRoute}/executions`,
    );
    expect(execution.total).toBe(1);
    expect(execution.items).toEqual([
      expect.objectContaining({
        recipient,
        amountToPayOut: "2200000000",
        bondAmount: "200000000",
        senderPublicKey: stack.proposer.publicKey,
        paidOutAmount: "2200000000",
        remainingAmount: "0",
      }),
    ]);
    expect(await proposalState(stack, proposal)).toMatchObject({
      paidOutAmount: "2200000000",
      lifecycleId: "1",
      stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Fully paid out", exact: true }),
    ).toBeDisabled();
    signed.push(...wallet.signedTransactions);
    await assertControl("payout");
    await page.goto(`${webUrl}/proposals/${firstProposal}`);
    await expect(
      page.getByRole("button", { name: "Fully paid out", exact: true }),
    ).toBeDisabled();
  });
  expect(signed).toHaveLength(7);
  const final = await snapshotProtectedState(stack);
  expect(final.transactions).toBe(initial.transactions + 8);
  expect(final.proposalList.total).toBe(initial.proposalList.total + 1);
  const newEvents = final.events.filter(
    (event) => !firstEventIds.has(event.id),
  );
  expect(newEvents).toHaveLength(8);
  expect(new Set(newEvents.map((event) => event.txHash)).size).toBe(8);
  expect(newEvents.every((event) => event.status === "canonical")).toBe(true);
  for (const [eventType, count] of [
    ["proposalCreated", 1],
    ["proposalVoteDispatched", 5],
    ["proposalVotesTallied", 1],
    ["proposalExecuted", 1],
  ] as const)
    expect(
      newEvents.filter((event) => event.eventType === eventType),
    ).toHaveLength(count);
  expect(
    newEvents.find((event) => event.eventType === "proposalVotesTallied")
      ?.txHash,
  ).toBe(tally!.tallyTxHash);
  return {
    proposal,
    snapshot,
    originalState,
    originalProjection,
    beforeControl,
    controlEvidence,
    signed,
    tally: tally!,
    secondCriteria,
    originalRoots,
    secondRoots: secondRoots!,
    newEvents,
    final,
  };
}
