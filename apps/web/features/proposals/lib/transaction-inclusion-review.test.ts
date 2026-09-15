import { afterEach, expect, it, vi } from "vitest";
import { waitForTransactionInclusion } from "./transaction-inclusion";

vi.mock("../../runtime-config/lib/get-runtime-config", () => ({
  getRuntimeConfig: () => ({ slotDurationMs: "1000" }),
}));
afterEach(() => vi.unstubAllGlobals());

it("rejects inclusion of a failed zkApp command and requests its failure reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bestChain: [
            {
              transactions: {
                zkappCommands: [
                  {
                    hash: "failed-command",
                    failureReason: [
                      {
                        index: 0,
                        failures: ["Account_nonce_precondition_unsatisfied"],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    }),
  );
  await expect(
    waitForTransactionInclusion(
      "https://mina.example/graphql",
      "failed-command",
    ),
  ).rejects.toThrow(/failed|precondition/i);
  const request = vi.mocked(fetch).mock.calls[0]?.[1];
  expect(JSON.parse(String(request?.body)).query).toContain("failureReason");
});

it.each([
  { name: "null failure reason", failureReason: null },
  { name: "empty failure reason", failureReason: [] },
])("accepts successful inclusion with $name", async ({ failureReason }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bestChain: [
            {
              transactions: {
                zkappCommands: [
                  {
                    hash: "unrelated",
                    failureReason: [
                      { index: 0, failures: ["unrelated failure"] },
                    ],
                  },
                  { hash: "included", failureReason },
                ],
              },
            },
          ],
        },
      }),
    }),
  );
  await expect(
    waitForTransactionInclusion("https://mina.example/graphql", "included"),
  ).resolves.toBeUndefined();
});

it("rejects a reported failure even when the node omits its details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bestChain: [
            {
              transactions: {
                zkappCommands: [{ hash: "failed", failureReason: [{}] }],
              },
            },
          ],
        },
      }),
    }),
  );
  await expect(
    waitForTransactionInclusion("https://mina.example/graphql", "failed"),
  ).rejects.toThrow("Transaction failed on chain");
});
