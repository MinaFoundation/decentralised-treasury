/// <reference lib="es2022.error" />
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { PrivateKey, PublicKey, TokenId } from "o1js";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import {
  parseCliJson,
  readJson,
  waitForUrl,
  type AdminState,
  type LocalTreasuryStack,
} from "../../../../web/e2e/utils/local-treasury-stack.js";
import {
  setLifecycleSlot,
  tallyBrowserVotes as tallyVotes,
} from "../../../../web/e2e/utils/lifecycle-operator.js";

type Projection = {
  id: string;
  proposalPublicKey: string;
  contents: string;
  paidOutAmount: string;
  remainingPayoutAmount: string;
  contractStatus: string;
};
type Event = { id: string; txHash: string; eventType: string; status: string };
type Execution = {
  id: string;
  proposalPublicKey: string;
  bondAmount: string;
  status: string;
  amountToPayOut: string;
  paidOutAmount: string;
  remainingAmount: string;
  recipient: string;
  senderPublicKey: string;
};
type Status = {
  ready: boolean;
  remainingEvents: number;
  offset: { lastSeenChangeSequence: string } | null;
};

async function readinessEvidence(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const value = (await response.json()) as {
      ready?: boolean;
      remainingEvents?: number;
      remainingCanonicalBlocks?: number;
      remainingPendingBlocks?: number;
      rejections?: { unresolved?: number };
      runtime?: {
        failedOperations?: unknown[];
        missingOperations?: unknown[];
        staleOperations?: unknown[];
      };
    };
    // Retain diagnostic counts, not raw errors, credentials, or event payloads.
    return {
      httpStatus: response.status,
      ready: value.ready === true,
      remainingEvents: value.remainingEvents,
      remainingCanonicalBlocks: value.remainingCanonicalBlocks,
      remainingPendingBlocks: value.remainingPendingBlocks,
      unresolvedRejections: value.rejections?.unresolved,
      failedOperations: value.runtime?.failedOperations?.length,
      missingOperations: value.runtime?.missingOperations?.length,
      staleOperations: value.runtime?.staleOperations?.length,
    };
  } catch {
    return { unavailable: true };
  }
}

async function eventually<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + 90_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (matches(value)) return value;
      last = value;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not converge: ${JSON.stringify(last)}`);
}

/** Backend restarts retain the same database and live chain. No state is injected. */
export async function runPayoutRecoveryScenarios(
  t: TestContext,
  stack: LocalTreasuryStack,
) {
  const admin = () => readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  const initial = await admin();
  assert.equal(initial.proofsEnabled, stack.proofsEnabled);
  const evidence: Record<string, unknown> = {
    proofsEnabled: stack.proofsEnabled,
    restartScope: "backend services only; same live local chain",
  };
  t.after(() =>
    writeFile(
      join(stack.artifactDirectory, "payout-recovery-evidence.json"),
      JSON.stringify(evidence, null, 2),
    ),
  );
  const actorArgs = [
    "--sender-private-key",
    stack.proposer.privateKey,
    "--treasury-owner-public-key",
    stack.treasuryOwnerPublicKey,
  ];
  const txArgs = [
    "--lifecycle-period-duration",
    "200",
    "--fee",
    "100000000",
    "--wait",
    "true",
  ];
  const projection = (key: string) =>
    readJson<Projection>(`${stack.treasuryApiUrl}/proposals/${key}`);
  const executions = (key: string) =>
    readJson<{ total: number; items: Execution[] }>(
      `${stack.treasuryApiUrl}/proposals/${key}/executions`,
    );
  const events = () =>
    readJson<{ items: Event[] }>(
      `${stack.indexerApiUrl}/events?eventTypes=${[
        PROPOSAL_CREATED_EVENT_NAME,
        PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        PROPOSAL_EXECUTED_EVENT_NAME,
      ].join(",")}&includeUnknown=false&limit=100`,
    );
  const processor = async () => {
    const response = await fetch(`${stack.processorApiUrl}/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok([200, 503].includes(response.status));
    return (await response.json()) as Status;
  };
  const account = async (key: string, tokenId?: string) => {
    const response = await fetch(stack.minaNodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query { account(publicKey: "${key}"${tokenId ? `, token: "${tokenId}"` : ""}) { nonce balance { total } zkappState } }`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.errors, undefined);
    assert.ok(payload.data.account);
    return payload.data.account as {
      nonce: string;
      balance: { total: string };
      zkappState: string[];
    };
  };
  const proposals: Array<{
    publicKey: string;
    contents: string;
    txHash: string;
  }> = [];
  await setLifecycleSlot(stack, 10);
  await t.test(
    "prepare independent payout and unchanged control proposals through CLI",
    async () => {
      for (const [index, name] of ["payout", "control"].entries()) {
        const key = PrivateKey.fromBigInt(BigInt(45678 + index));
        const contents = `# ${name} recovery proposal\n\nReal CLI payout recovery case.\n`;
        const path = join(stack.artifactDirectory, `${name}-contents.md`);
        await writeFile(path, contents);
        const result = parseCliJson<{
          proposalAddress: string;
          proposalTxHash: string;
        }>(
          await stack.cli([
            "proposal",
            "create",
            ...actorArgs,
            "--api-url",
            stack.treasuryApiUrl,
            "--proposal-private-key",
            key.toBase58(),
            "--proposal-lifecycle-id",
            "0",
            "--recipient-public-key",
            stack.recipientPublicKey,
            "--amount",
            "1000000000",
            "--content-file",
            path,
            ...txArgs,
          ]),
          "proposalTxHash",
        );
        assert.equal(result.proposalAddress, key.toPublicKey().toBase58());
        proposals.push({
          publicKey: result.proposalAddress,
          txHash: result.proposalTxHash,
          contents,
        });
        await eventually(
          () => projection(result.proposalAddress),
          (value) => value.contents === contents && value.paidOutAmount === "0",
          `${name} content projection`,
        );
      }
    },
  );
  assert.equal(proposals.length, 2);
  const [paid, control] = proposals;
  const proposalTokenId = TokenId.toBase58(
    TokenId.derive(PublicKey.fromBase58(stack.treasuryOwnerPublicKey)),
  );
  const chainProposal = (key: string) => account(key, proposalTokenId);
  const controlBefore = {
    account: await chainProposal(control.publicKey),
    projection: await projection(control.publicKey),
    executions: await executions(control.publicKey),
  };
  const assertControl = async () => {
    assert.deepEqual(
      await chainProposal(control.publicKey),
      controlBefore.account,
    );
    const current = await projection(control.publicKey);
    for (const key of [
      "id",
      "proposalPublicKey",
      "contents",
      "paidOutAmount",
    ] as const)
      assert.equal(current[key], controlBefore.projection[key]);
    assert.deepEqual(
      await executions(control.publicKey),
      controlBefore.executions,
    );
  };
  await t.test(
    "approve only the payout proposal with five CLI votes and real operator tally",
    async () => {
      await setLifecycleSlot(stack, 400);
      for (const voter of initial.testAccounts.slice(0, 5)) {
        await stack.cli([
          "proposal",
          "vote",
          ...actorArgs,
          "--proposal-public-key",
          paid.publicKey,
          "--voter-private-key",
          voter.privateKey,
          "--vote",
          "yay",
          ...txArgs,
        ]);
      }
      await eventually(
        () =>
          readJson<{ total: number }>(
            `${stack.treasuryApiUrl}/proposals/${paid.publicKey}/votes`,
          ),
        (value) => value.total === 5,
        "Five vote projections",
      );
      await setLifecycleSlot(stack, 600);
      const tally = await tallyVotes(stack, paid.publicKey);
      evidence.tally = {
        ...tally,
        event: await assertEvent(
          tally.tallyTxHash,
          PROPOSAL_VOTES_TALLIED_EVENT_NAME,
        ),
      };
      await eventually(
        () => projection(paid.publicKey),
        (value) => value.contractStatus === "approved",
        "Approved projection",
      );
      await assertControl();
      await setLifecycleSlot(stack, 800);
    },
  );
  const executeArgs = (amount: string) => [
    "proposal",
    "execute",
    ...actorArgs,
    "--proposal-public-key",
    paid.publicKey,
    "--recipient-public-key",
    stack.recipientPublicKey,
    "--amount-to-pay-out",
    amount,
    ...txArgs,
  ];
  const protectedState = async () => ({
    transactions: (await admin()).submittedTransactions,
    owner: await account(stack.treasuryOwnerPublicKey),
    sender: await account(stack.proposer.publicKey),
    recipient: await account(stack.recipientPublicKey),
    paid: await chainProposal(paid.publicKey),
    control: await chainProposal(control.publicKey),
  });
  const assertPayoutDelta = (
    before: Awaited<ReturnType<typeof protectedState>>,
    after: Awaited<ReturnType<typeof protectedState>>,
    amount: bigint,
  ) => {
    assert.equal(after.transactions, before.transactions + 1);
    assert.equal(
      BigInt(after.recipient.balance.total) -
        BigInt(before.recipient.balance.total),
      amount,
    );
    assert.equal(
      BigInt(before.owner.balance.total) - BigInt(after.owner.balance.total),
      amount,
    );
    assert.equal(
      BigInt(before.sender.balance.total) - BigInt(after.sender.balance.total),
      100000000n,
    );
    assert.equal(Number(after.sender.nonce), Number(before.sender.nonce) + 1);
    assert.deepEqual(after.control, before.control);
  };
  async function assertEvent(hash: string, type: string) {
    const page = await eventually(
      events,
      (value) =>
        value.items.some(
          (event) =>
            event.txHash === hash &&
            event.eventType === type &&
            event.status === "canonical",
        ),
      `${type} canonical event`,
    );
    const matches = page.items.filter(
      (event) => event.txHash === hash && event.eventType === type,
    );
    assert.equal(matches.length, 1);
    return matches[0];
  }
  const hashes: string[] = [];
  for (const scenario of [
    {
      name: "partial payout while Processor is stopped",
      amount: "400000000",
      paid: "400000000",
      remaining: "700000000",
      stopProcessor: true,
    },
    {
      name: "complete remaining payout after projection recovery",
      amount: "700000000",
      paid: "1100000000",
      remaining: "0",
      stopProcessor: false,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const before = await protectedState();
      const oldProjection = await projection(paid.publicKey);
      const oldExecutions = await executions(paid.publicKey);
      const checkpoint = await eventually(
        processor,
        (value) =>
          value.ready && value.remainingEvents === 0 && value.offset != null,
        "Drained checkpoint",
      );
      if (scenario.stopProcessor) await stack.services.stop("processor");
      let processorStopped = scenario.stopProcessor;
      try {
        const result = parseCliJson<{ executeTxHash: string }>(
          await stack.cli(executeArgs(scenario.amount)),
          "executeTxHash",
        );
        hashes.push(result.executeTxHash);
        const after = await protectedState();
        assertPayoutDelta(before, after, BigInt(scenario.amount));
        const chainState = parseCliJson<{
          proposalAddress: string;
          status: string;
          paidOutAmount: string;
        }>(
          await stack.cli([
            "proposal",
            "read-state",
            "--treasury-owner-public-key",
            stack.treasuryOwnerPublicKey,
            "--proposal-public-key",
            paid.publicKey,
          ]),
          "proposalAddress",
        );
        assert.equal(chainState.proposalAddress, paid.publicKey);
        assert.equal(chainState.status, "approved");
        assert.equal(chainState.paidOutAmount, scenario.paid);
        const event = await assertEvent(
          result.executeTxHash,
          PROPOSAL_EXECUTED_EVENT_NAME,
        );
        if (scenario.stopProcessor) {
          const backlog = await eventually(
            processor,
            (value) => value.remainingEvents > 0,
            "Stopped Processor backlog",
          );
          assert.deepEqual(backlog.offset, checkpoint.offset);
          assert.equal(
            (await projection(paid.publicKey)).paidOutAmount,
            oldProjection.paidOutAmount,
          );
          assert.deepEqual(await executions(paid.publicKey), oldExecutions);
          stack.services.start("processor");
          processorStopped = false;
        }
        const current = await eventually(
          () => projection(paid.publicKey),
          (value) =>
            value.paidOutAmount === scenario.paid &&
            value.remainingPayoutAmount === scenario.remaining,
          "Recovered payout projection",
        );
        assert.equal(current.id, oldProjection.id);
        assert.equal(current.contents, paid.contents);
        const rows = await eventually(
          () => executions(paid.publicKey),
          (value) => value.total === hashes.length,
          "Exactly one execution per payout",
        );
        assert.equal(
          new Set(rows.items.map((row) => row.id)).size,
          hashes.length,
        );
        assert.ok(
          rows.items.some(
            (row) =>
              row.amountToPayOut === scenario.amount &&
              row.proposalPublicKey === paid.publicKey &&
              row.bondAmount === "100000000" &&
              row.status === "canonical" &&
              row.paidOutAmount === scenario.paid &&
              row.remainingAmount === scenario.remaining &&
              row.recipient === stack.recipientPublicKey &&
              row.senderPublicKey === stack.proposer.publicKey,
          ),
        );
        const recovered = await eventually(
          processor,
          (value) => value.ready && value.remainingEvents === 0,
          "Recovered checkpoint",
        );
        assert.ok(
          BigInt(recovered.offset!.lastSeenChangeSequence) >
            BigInt(checkpoint.offset!.lastSeenChangeSequence),
        );
        assert.deepEqual(
          await protectedState(),
          after,
          "Projection recovery must not apply another payout",
        );
        await assertControl();
        evidence[scenario.name] = {
          before,
          after,
          chainState,
          event,
          checkpoint,
          recovered,
          projection: current,
          executions: rows,
        };
      } finally {
        if (processorStopped) stack.services.start("processor");
      }
    });
  }
  await t.test(
    "backend restart preserves both proposals, payout identities, and checkpoint without replay",
    async () => {
      const before = await protectedState();
      const rows = await executions(paid.publicKey);
      const beforeEvents = (await events()).items
        .map((event) => event.id)
        .sort();
      const checkpoint = await processor();
      const projected = await projection(paid.publicKey);
      const services = [
        "app-api",
        "processor",
        "processor-api",
        "indexer",
        "indexer-api",
      ] as const;
      for (const name of services) await stack.services.stop(name);
      for (const name of [...services].reverse()) stack.services.start(name);
      try {
        await waitForUrl(`${stack.treasuryApiUrl}/readyz`);
        await waitForUrl(`${stack.indexerApiUrl}/readyz`);
      } catch (error) {
        const [app, indexer, processor] = await Promise.all(
          [
            stack.treasuryApiUrl,
            stack.indexerApiUrl,
            stack.processorApiUrl,
          ].map((url) => readinessEvidence(`${url}/readyz`)),
        );
        evidence.backendRestartReadiness = { app, indexer, processor };
        throw error;
      }
      const recovered = await eventually(
        processor,
        (value) => value.ready && value.remainingEvents === 0,
        "Backend checkpoint recovery",
      );
      assert.deepEqual(recovered.offset, checkpoint.offset);
      assert.deepEqual(
        (await events()).items.map((event) => event.id).sort(),
        beforeEvents,
      );
      assert.deepEqual(await executions(paid.publicKey), rows);
      const current = await projection(paid.publicKey);
      for (const key of [
        "id",
        "contents",
        "paidOutAmount",
        "remainingPayoutAmount",
      ] as const)
        assert.equal(current[key], projected[key]);
      assert.equal(
        (await readJson<{ total: number }>(`${stack.treasuryApiUrl}/proposals`))
          .total,
        2,
      );
      assert.deepEqual(await protectedState(), before);
      await assertControl();
      evidence.backendRestart = {
        checkpoint,
        recovered,
        eventIds: beforeEvents,
        executions: rows,
      };
    },
  );
  await t.test(
    "explicit positive replay payout rejects without balance, proposal, event, or projection changes",
    async () => {
      const before = {
        chain: await protectedState(),
        projected: await projection(paid.publicKey),
        executions: await executions(paid.publicKey),
        events: (await events()).items,
        checkpoint: (await processor()).offset,
      };
      await assert.rejects(
        stack.cli(executeArgs("1")),
        /Amount to pay out is greater than the remaining amount to pay out/u,
      );
      assert.deepEqual(await protectedState(), before.chain);
      assert.deepEqual(await executions(paid.publicKey), before.executions);
      assert.deepEqual((await events()).items, before.events);
      assert.deepEqual((await processor()).offset, before.checkpoint);
      assert.deepEqual(await projection(paid.publicKey), before.projected);
      await assertControl();
      evidence.replayRejected = { amount: "1", ...before };
    },
  );
  for (const proposal of proposals)
    await assertEvent(proposal.txHash, PROPOSAL_CREATED_EVENT_NAME);
  assert.equal(hashes.length, 2);
  evidence.proposals = proposals;
  evidence.payoutTransactionHashes = hashes;
}
