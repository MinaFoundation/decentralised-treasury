import { afterEach, expect, it, vi } from "vitest";
import { waitForInclusion } from "./wallets";

afterEach(() => vi.unstubAllGlobals());

it("REVIEW DEFECT: inclusion of a failed operation must not produce a receipt", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bestChain: [
            {
              protocolState: { consensusState: { blockHeight: "42" } },
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
    waitForInclusion("https://mina.example/graphql", "failed-command"),
  ).rejects.toThrow(/failed|precondition/i);
});
