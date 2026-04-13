import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAccount } from "o1js";
import { fetchMinaAccountBalance, fetchStakingLedgerTotalCurrency } from "./mina-accounts";

vi.mock("o1js", () => ({
  Mina: {
    Network: (config: unknown) => config,
    setActiveInstance: vi.fn(),
  },
  PublicKey: {
    fromBase58: (value: string) => value,
  },
  fetchAccount: vi.fn(),
}));

describe("fetchMinaAccountBalance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zero when the Mina account is missing", async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      account: undefined,
      error: undefined,
    } as never);

    await expect(
      fetchMinaAccountBalance("http://127.0.0.1:8080/graphql", "B62qwallet"),
    ).resolves.toBe("0 MINA");
  });

  it("returns zero when the request succeeds but no Mina account data is returned", async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      account: undefined,
      error: new Error("Account not found"),
    } as never);

    await expect(
      fetchMinaAccountBalance("http://127.0.0.1:8080/graphql", "B62qwallet"),
    ).resolves.toBe("0 MINA");
  });
});

describe("fetchStakingLedgerTotalCurrency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted staking epoch total currency from bestChain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bestChain: [
              {
                protocolState: {
                  consensusState: {
                    stakingEpochData: {
                      ledger: {
                        totalCurrency: "360000000000000",
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      ),
    );

    await expect(fetchStakingLedgerTotalCurrency("http://127.0.0.1:8080/graphql")).resolves.toBe(
      "360000 MINA",
    );
  });
});
