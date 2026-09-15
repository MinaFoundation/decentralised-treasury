import { expect, test, type Page } from "@playwright/test";
import { PublicKey, TokenId } from "o1js";
import {
  readJson,
  type AdminState,
  type LocalTreasuryStack,
} from "./local-treasury-stack";

const eventTypes =
  "proposalCreated,proposalVoteDispatched,proposalVotesTallied,proposalExecuted,proposalPauseToggled";
const rowFields = [
  "id",
  "proposalPublicKey",
  "amount",
  "recipient",
  "contents",
  "paidOutAmount",
  "remainingPayoutAmount",
  "contractStatus",
  "voterPublicKey",
  "vote",
  "voteWeight",
  "amountToPayOut",
  "remainingAmount",
  "senderPublicKey",
  "status",
];
const selectRows = (items: Array<Record<string, unknown>>) =>
  items
    .map((row) =>
      Object.fromEntries(
        rowFields.filter((key) => key in row).map((key) => [key, row[key]]),
      ),
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

/** Read-only protected-state oracle. Heartbeat timestamps are not state changes. */
export async function snapshotProtectedState(
  stack: LocalTreasuryStack,
  extraAccounts: string[] = [],
) {
  await expect
    .poll(
      async () => {
        const indexer = await readJson<{
          ready: boolean;
          remainingPendingBlocks: number;
          remainingCanonicalBlocks: number;
          rejections: { unresolved: number };
        }>(`${stack.indexerApiUrl}/status`);
        const processor = await readJson<{
          ready: boolean;
          remainingEvents: number;
        }>(`${stack.processorApiUrl}/status`);
        return (
          indexer.ready === true &&
          indexer.remainingPendingBlocks === 0 &&
          indexer.remainingCanonicalBlocks === 0 &&
          indexer.rejections.unresolved === 0 &&
          processor.ready === true &&
          processor.remainingEvents === 0
        );
      },
      {
        message:
          "Indexer and Processor must be ready and drained before a protected-state snapshot",
        timeout: 60_000,
      },
    )
    .toBe(true);
  const admin = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  const receipts = await readJson<{ receipts: Array<{ hash: string }> }>(
    `${stack.baseUrl}/admin/transactions`,
  );
  const list = await readJson<{
    items: Array<Record<string, unknown>>;
    total: number;
  }>(`${stack.treasuryApiUrl}/proposals?limit=100`);
  expect(list.items.length, "Proposal evidence must not be truncated").toBe(
    list.total,
  );
  const proposalKeys = list.items.map((row) => String(row.proposalPublicKey));
  const ownerToken = TokenId.toBase58(
    TokenId.derive(PublicKey.fromBase58(stack.treasuryOwnerPublicKey)),
  );
  const defaultToken = TokenId.toBase58(TokenId.default);
  const targets = [
    ...new Set([
      stack.proposer.publicKey,
      stack.recipientPublicKey,
      stack.treasuryOwnerPublicKey,
      ...extraAccounts,
    ]),
  ].map((publicKey) => ({ publicKey, token: defaultToken }));
  targets.push(
    ...proposalKeys.map((publicKey) => ({ publicKey, token: ownerToken })),
  );
  const accounts = await Promise.all(
    targets.map(async ({ publicKey, token }) => {
      const response = await fetch(stack.minaNodeUrl, {
        signal: AbortSignal.timeout(15_000),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query { account(publicKey: "${publicKey}", token: "${token}") { nonce balance { total } zkappState } }`,
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.errors).toBeUndefined();
      expect(payload.data.account).not.toBeNull();
      return { publicKey, token, account: payload.data.account };
    }),
  );
  type IndexedEvent = {
    id: string;
    txHash: string;
    eventType: string;
    status: string;
  };
  const events: IndexedEvent[] = [];
  let changeSequenceAfter = "0";
  for (;;) {
    const batch = await readJson<{
      items: IndexedEvent[];
      nextCursor: { changeSequenceAfter: string } | null;
    }>(
      `${stack.indexerApiUrl}/events?eventTypes=${eventTypes}&includeUnknown=false&limit=100&changeSequenceAfter=${changeSequenceAfter}`,
    );
    events.push(...batch.items);
    if (batch.items.length === 0) {
      expect(batch.nextCursor).toBeNull();
      break;
    }
    expect(batch.nextCursor).not.toBeNull();
    const next = batch.nextCursor!.changeSequenceAfter;
    expect(
      BigInt(next) > BigInt(changeSequenceAfter),
      "Event cursor must advance",
    ).toBe(true);
    changeSequenceAfter = next;
  }
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  const proposals = await Promise.all(
    proposalKeys.map(async (publicKey) => {
      const votes = await readJson<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>(`${stack.treasuryApiUrl}/proposals/${publicKey}/votes?limit=100`);
      const executions = await readJson<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>(`${stack.treasuryApiUrl}/proposals/${publicKey}/executions?limit=100`);
      expect(votes.items.length, "Vote evidence must not be truncated").toBe(
        votes.total,
      );
      expect(
        executions.items.length,
        "Execution evidence must not be truncated",
      ).toBe(executions.total);
      const response = await fetch(stack.archiveUrl, {
        signal: AbortSignal.timeout(15_000),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query:
            "query Actions($input: ActionFilterOptionsInput!) { actions(input: $input) { actionState { actionStateOne } actionData { data } } }",
          variables: { input: { address: publicKey, tokenId: ownerToken } },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.errors).toBeUndefined();
      return {
        publicKey,
        votes: { total: votes.total, items: selectRows(votes.items) },
        executions: {
          total: executions.total,
          items: selectRows(executions.items),
        },
        actions: payload.data.actions,
      };
    }),
  );
  const checkpoint = await readJson<{
    offset: { lastSeenChangeSequence: string } | null;
  }>(`${stack.processorApiUrl}/status`);
  return {
    slot: admin.currentSlot,
    transactions: admin.submittedTransactions,
    receipts: receipts.receipts.map((receipt) => receipt.hash),
    accounts,
    proposalList: { total: list.total, items: selectRows(list.items) },
    proposals,
    events: events
      .map(({ id, txHash, eventType, status }) => ({
        id,
        txHash,
        eventType,
        status,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    checkpoint: checkpoint.offset?.lastSeenChangeSequence,
  };
}

export async function unchangedBrowserState(
  page: Page,
  stack: LocalTreasuryStack,
  label: string,
  extraAccounts: string[] = [],
) {
  const before = await snapshotProtectedState(stack, extraAccounts);
  const submitted: string[] = [];
  const pageErrors: string[] = [];
  const observeError = (error: Error) => pageErrors.push(error.message);
  const observe = (request: import("@playwright/test").Request) => {
    if (
      request.url() === stack.minaNodeUrl &&
      request.postData()?.includes("sendZkapp")
    )
      submitted.push(request.postData()!);
  };
  page.on("request", observe);
  page.on("pageerror", observeError);
  return async () => {
    try {
      const after = await snapshotProtectedState(stack, extraAccounts);
      await test.info().attach(`unchanged-state-${label}`, {
        contentType: "application/json",
        body: JSON.stringify({
          before,
          after,
          submissionRequests: submitted.length,
          pageErrors,
        }),
      });
      expect(
        submitted,
        "Rejected browser action must not submit to Mina",
      ).toEqual([]);
      expect(
        pageErrors,
        "Rejected browser action must not crash the page",
      ).toEqual([]);
      expect(
        after,
        "Protected chain and service state must remain unchanged",
      ).toEqual(before);
    } finally {
      page.off("request", observe);
      page.off("pageerror", observeError);
    }
  };
}
