/// <reference lib="es2022.error" />
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { PrivateKey } from "o1js";
import {
  parseCliJson,
  readJson,
  waitForUrl,
  type AdminState,
  type LocalTreasuryStack,
} from "../../../../web/e2e/utils/local-treasury-stack.js";

type ServiceName =
  | "indexer"
  | "indexer-api"
  | "processor"
  | "processor-api"
  | "app-api";
type ServiceControls = {
  start(name: ServiceName): unknown;
  stop(name: ServiceName): Promise<void>;
};
type Projection = {
  id: string;
  proposalPublicKey: string;
  amount: string;
  contents: string | null;
  paidOutAmount: string;
};
type Event = { id: string; txHash: string; eventType: string; status: string };
type ProcessorStatus = {
  ready: boolean;
  remainingEvents: number;
  offset: { lastSeenChangeSequence: string } | null;
};

async function eventually<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (matches(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not recover: ${JSON.stringify(last)}`);
}

/** Real CLI submissions and public APIs; no database or contract mutations. */
export async function runOperatorRecoveryScenarios(
  t: TestContext,
  stack: LocalTreasuryStack,
  services: ServiceControls,
) {
  const proposals: Array<{
    publicKey: string;
    contents: string;
    txHash: string;
    amount: string;
  }> = [];
  const admin = () => readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  const events = () =>
    readJson<{ items: Event[] }>(
      `${stack.indexerApiUrl}/events?eventTypes=proposalCreated&includeUnknown=false&limit=100`,
    );
  const processor = async () => {
    const response = await fetch(`${stack.processorApiUrl}/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok([200, 503].includes(response.status));
    const value = (await response.json()) as ProcessorStatus;
    assert.equal(typeof value.remainingEvents, "number");
    return value;
  };
  const projection = (key: string) =>
    readJson<Projection>(`${stack.treasuryApiUrl}/proposals/${key}`);
  const account = async (key: string) => {
    const response = await fetch(stack.minaNodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query { account(publicKey: "${key}") { nonce balance { total } zkappState } }`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.errors, undefined);
    assert.ok(payload.data.account);
    return payload.data.account;
  };
  const protectedState = async () => ({
    transactions: (await admin()).submittedTransactions,
    owner: await account(stack.treasuryOwnerPublicKey),
    payer: await account(stack.proposer.publicKey),
  });
  const postContent = (key: string, contents: unknown) =>
    fetch(`${stack.treasuryApiUrl}/proposals/${key}/content`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents }),
      signal: AbortSignal.timeout(15_000),
    });
  const assertCanonicalEvent = async (txHash: string) => {
    const page = await eventually(
      events,
      (page) =>
        page.items.some(
          (event) => event.txHash === txHash && event.status === "canonical",
        ),
      "Canonical proposal event",
    );
    assert.equal(
      page.items.filter(
        (event) =>
          event.txHash === txHash && event.eventType === "proposalCreated",
      ).length,
      1,
    );
  };
  const assertProjection = async (proposal: (typeof proposals)[number]) => {
    const value = await eventually(
      () => projection(proposal.publicKey),
      (value) => value.contents === proposal.contents,
      "Proposal content",
    );
    assert.equal(value.proposalPublicKey, proposal.publicKey);
    assert.equal(value.amount, proposal.amount);
    assert.equal(value.paidOutAmount, "0");
    await assertCanonicalEvent(proposal.txHash);
    return value;
  };

  const initial = await admin();
  assert.equal(initial.proofsEnabled, stack.proofsEnabled);
  const clock = await fetch(`${stack.baseUrl}/admin/slot/set`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slot: 10 }),
  });
  assert.equal(clock.status, 200);
  assert.equal(
    (await admin()).submittedTransactions,
    initial.submittedTransactions,
  );
  await waitForUrl(`${stack.treasuryApiUrl}/readyz`);

  for (const [index, stopped] of (
    ["indexer", "processor", "app-api"] as const
  ).entries()) {
    await t.test(
      `recover CLI proposal creation after ${stopped} stops`,
      async () => {
        const key = PrivateKey.fromBigInt(BigInt(12_345 + index));
        const publicKey = key.toPublicKey().toBase58();
        const contents = `# Recovery proposal ${index + 1}\n\nPublic service restart case: ${stopped}.\n`;
        const amount = ["1", "1000000000", "2000000000"][index]!;
        const contentPath = join(
          stack.artifactDirectory,
          `recovery-${stopped}.md`,
        );
        await writeFile(contentPath, contents);
        const beforeCount = (await admin()).submittedTransactions;
        await services.stop(stopped);
        const pending = stack
          .cli([
            "proposal",
            "create",
            "--api-url",
            stack.treasuryApiUrl,
            "--sender-private-key",
            stack.proposer.privateKey,
            "--treasury-owner-public-key",
            stack.treasuryOwnerPublicKey,
            "--proposal-private-key",
            key.toBase58(),
            "--proposal-lifecycle-id",
            "0",
            "--recipient-public-key",
            stack.recipientPublicKey,
            "--amount",
            amount,
            "--content-file",
            contentPath,
            "--lifecycle-period-duration",
            "200",
            "--fee",
            "100000000",
            "--wait",
            "true",
          ])
          .then(
            (output) => ({ output, error: null }),
            (error: Error) => ({ output: null, error }),
          );
        let restored = false;
        try {
          // Compilation can take minutes. Observe the same bounded command.
          const deadline =
            Date.now() +
            Number(process.env.E2E_COMMAND_TIMEOUT_MS ?? 1_800_000);
          let settled: Awaited<typeof pending> | undefined;
          void pending.then((result) => {
            settled = result;
          });
          while ((await admin()).submittedTransactions === beforeCount) {
            if (settled?.error) throw settled.error;
            assert.ok(
              Date.now() < deadline,
              "CLI transaction was not included before its timeout",
            );
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          assert.equal((await admin()).submittedTransactions, beforeCount + 1);
          const includedState = await protectedState();
          if (stopped !== "app-api") {
            const unavailable = await fetch(
              `${stack.treasuryApiUrl}/proposals/${publicKey}`,
            );
            assert.equal(unavailable.status, 404);
            if (stopped === "processor") {
              await eventually(
                processor,
                (value) => value.remainingEvents > 0,
                "Processor backlog",
              );
            }
          } else {
            const result = await pending;
            assert.ok(
              result.error,
              "The stopped API must make content publication fail",
            );
            assert.match(result.error.message, /fetch failed|ECONNREFUSED/iu);
          }
          services.start(stopped);
          restored = true;
          if (stopped === "app-api")
            await waitForUrl(`${stack.treasuryApiUrl}/readyz`);
          const page = await eventually(
            events,
            (page) =>
              page.items.some(
                (event) =>
                  event.eventType === "proposalCreated" &&
                  !proposals.some((p) => p.txHash === event.txHash),
              ),
            "New proposal event",
          );
          const created = page.items.filter(
            (event) =>
              event.eventType === "proposalCreated" &&
              !proposals.some((p) => p.txHash === event.txHash),
          );
          assert.equal(created.length, 1);
          const txHash = created[0]!.txHash;
          if (stopped === "app-api") {
            await eventually(
              () => projection(publicKey),
              (value) => value.proposalPublicKey === publicKey,
              "Projection before retry",
            );
            const retry = await postContent(publicKey, contents);
            assert.equal(retry.status, 200);
          } else {
            const result = await pending;
            assert.equal(result.error, null, result.error?.message);
            const submitted = parseCliJson<{
              proposalAddress: string;
              proposalTxHash: string;
            }>(result.output!, "proposalTxHash");
            assert.equal(submitted.proposalAddress, publicKey);
            assert.equal(submitted.proposalTxHash, txHash);
          }
          const proposal = { publicKey, contents, txHash, amount };
          await assertProjection(proposal);
          assert.deepEqual(
            await protectedState(),
            includedState,
            "Service recovery must not submit a second chain transaction",
          );
          proposals.push(proposal);
        } finally {
          if (!restored) services.start(stopped);
          // Restore a stopped dependency before waiting for a bounded CLI retry.
          await pending;
        }
      },
    );
  }

  await t.test(
    "duplicate content publication is idempotent and rejects changed content",
    async () => {
      assert.equal(proposals.length, 3);
      const before = await protectedState();
      for (const proposal of proposals) {
        const original = await assertProjection(proposal);
        for (const contents of [proposal.contents, proposal.contents]) {
          assert.equal(
            (await postContent(proposal.publicKey, contents)).status,
            200,
          );
          const value = await assertProjection(proposal);
          assert.equal(value.id, original.id);
        }
        const changed = await postContent(
          proposal.publicKey,
          `${proposal.contents}\nChanged payload.`,
        );
        assert.equal(changed.status, 404);
        assert.equal(
          (await projection(proposal.publicKey)).contents,
          proposal.contents,
        );
      }
      assert.deepEqual(await protectedState(), before);
    },
  );

  for (const { name, contents } of [
    { name: "empty text", contents: "" },
    { name: "missing field", contents: undefined },
    { name: "null", contents: null },
    { name: "number", contents: 0 },
    { name: "array", contents: [] },
    { name: "object", contents: {} },
    {
      name: "one character above the limit",
      contents: "a".repeat(32 * 1024 + 1),
    },
  ]) {
    await t.test(
      `content API rejects ${name} without changing protected state`,
      async () => {
        assert.equal(proposals.length, 3);
        const before = await protectedState();
        const proposal = proposals[0]!;
        const response = await postContent(proposal.publicKey, contents);
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.equal(
          payload.error,
          typeof contents === "string" && contents.length > 32 * 1024
            ? "contents exceeds maximum allowed length"
            : "contents must be a non-empty markdown string",
        );
        assert.equal(
          (await projection(proposal.publicKey)).contents,
          proposal.contents,
        );
        assert.deepEqual(await protectedState(), before);
      },
    );
  }

  for (const { name, contents, expectedCharacters } of [
    { name: "one character", contents: "a", expectedCharacters: 1 },
    {
      name: "maximum ASCII characters",
      contents: "a".repeat(32 * 1024),
      expectedCharacters: 32 * 1024,
    },
    { name: "Unicode code points", contents: "🧭é", expectedCharacters: 2 },
  ]) {
    await t.test(
      `content preflight accepts ${name} without publishing content`,
      async () => {
        const before = await protectedState();
        const response = await fetch(
          `${stack.treasuryApiUrl}/proposals/content/verify`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.passesSubmissionChecks, true);
        assert.equal(payload.contentChars, expectedCharacters);
        for (const proposal of proposals) {
          assert.equal(
            (await projection(proposal.publicKey)).contents,
            proposal.contents,
          );
        }
        assert.deepEqual(await protectedState(), before);
      },
    );
  }

  await t.test(
    "backend restart preserves proposal IDs, event IDs, and processor checkpoint",
    async () => {
      assert.equal(proposals.length, 3);
      const before = await protectedState();
      const rows = await Promise.all(proposals.map(assertProjection));
      const beforeEvents = (await events()).items
        .map((event) => event.id)
        .sort();
      const beforeCheckpoint = (await processor()).offset;
      assert.ok(beforeCheckpoint);
      const names = [
        "app-api",
        "processor",
        "processor-api",
        "indexer",
        "indexer-api",
      ] as const;
      for (const name of names) await services.stop(name);
      for (const name of [...names].reverse()) services.start(name);
      await waitForUrl(`${stack.treasuryApiUrl}/readyz`);
      await waitForUrl(`${stack.indexerApiUrl}/readyz`);
      const current = await eventually(
        processor,
        (value) => value.ready && value.remainingEvents === 0,
        "Processor checkpoint",
      );
      assert.ok(current.offset);
      assert.ok(
        BigInt(current.offset.lastSeenChangeSequence) >=
          BigInt(beforeCheckpoint.lastSeenChangeSequence),
      );
      assert.deepEqual(
        (await events()).items.map((event) => event.id).sort(),
        beforeEvents,
      );
      for (const [index, proposal] of proposals.entries()) {
        assert.equal((await assertProjection(proposal)).id, rows[index]!.id);
      }
      const list = await readJson<{ total: number }>(
        `${stack.treasuryApiUrl}/proposals`,
      );
      assert.equal(list.total, 3);
      assert.deepEqual(await protectedState(), before);
      await writeFile(
        join(stack.artifactDirectory, "recovery-evidence.json"),
        JSON.stringify(
          {
            proofsEnabled: stack.proofsEnabled,
            proposals,
            eventIds: beforeEvents,
            beforeCheckpoint,
            afterCheckpoint: current.offset,
          },
          null,
          2,
        ),
      );
    },
  );
}
