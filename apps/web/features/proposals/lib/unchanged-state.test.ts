import { afterEach, expect, it, vi } from "vitest";
import { PrivateKey } from "o1js";
import { snapshotProtectedState } from "../../../e2e/utils/unchanged-state";
import type { LocalTreasuryStack } from "../../../e2e/utils/local-treasury-stack";

vi.mock("@playwright/test", async () => ({
  expect: (await import("vitest")).expect,
  test: {},
}));
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../e2e/utils/local-treasury-stack", () => ({ readJson: read }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

for (const scenario of [
  "complete",
  "proposals truncated",
  "votes truncated",
  "executions truncated",
  "missing account",
] as const) {
  it(`protected-state evidence: ${scenario}`, async () => {
    const publicKey = PrivateKey.random().toPublicKey().toBase58();
    const stack = {
      baseUrl: "http://node",
      minaNodeUrl: "http://mina",
      archiveUrl: "http://archive",
      indexerApiUrl: "http://indexer",
      processorApiUrl: "http://processor",
      treasuryApiUrl: "http://api",
      treasuryOwnerPublicKey: publicKey,
      recipientPublicKey: publicKey,
      proposer: { publicKey },
    } as LocalTreasuryStack;
    let readinessReads = 0;
    read.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.host === "indexer" && url.pathname === "/status") {
        readinessReads++;
        // Each gate must prevent the snapshot, even with a drained Processor.
        return {
          ready: readinessReads !== 1,
          remainingPendingBlocks: readinessReads === 2 ? 1 : 0,
          remainingCanonicalBlocks: readinessReads === 3 ? 1 : 0,
          rejections: { unresolved: readinessReads === 4 ? 1 : 0 },
        };
      }
      if (url.host === "processor")
        return {
          ready: true,
          remainingEvents: 0,
          offset: { lastSeenChangeSequence: "101" },
        };
      if (url.pathname === "/admin/state") {
        expect(readinessReads).toBeGreaterThanOrEqual(5);
        return { currentSlot: 200, submittedTransactions: 1 };
      }
      if (url.pathname === "/admin/transactions")
        return { receipts: [{ hash: "included" }] };
      if (url.pathname === "/proposals")
        return {
          items: [{ id: "proposal", proposalPublicKey: publicKey }],
          total: scenario === "proposals truncated" ? 101 : 1,
        };
      if (url.pathname.endsWith("/votes"))
        return { items: [], total: scenario === "votes truncated" ? 101 : 0 };
      if (url.pathname.endsWith("/executions"))
        return {
          items: [],
          total: scenario === "executions truncated" ? 101 : 0,
        };
      if (url.pathname === "/events") {
        const cursor = Number(url.searchParams.get("changeSequenceAfter"));
        const ids =
          cursor === 0
            ? Array.from({ length: 100 }, (_, i) => i + 1)
            : cursor === 100
              ? [101]
              : [];
        return {
          items: ids.map((id) => ({
            id: String(id),
            txHash: `tx${id}`,
            eventType: "proposalCreated",
            status: "canonical",
          })),
          nextCursor: ids.length
            ? { changeSequenceAfter: String(ids.at(-1)) }
            : null,
        };
      }
      throw new Error(`Unexpected public read: ${input}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => ({
        ok: true,
        json: async () => ({
          data:
            input === stack.minaNodeUrl
              ? {
                  account:
                    scenario === "missing account"
                      ? null
                      : {
                          nonce: "1",
                          balance: { total: "100" },
                          zkappState: [],
                        },
                }
              : { actions: [] },
        }),
      })),
    );
    if (scenario === "complete") {
      const snapshot = await snapshotProtectedState(stack);
      expect(snapshot.events).toHaveLength(101);
      expect(snapshot.checkpoint).toBe("101");
    } else {
      await expect(snapshotProtectedState(stack)).rejects.toThrow(
        scenario === "missing account" ? /null/ : /truncated/,
      );
    }
  });
}
