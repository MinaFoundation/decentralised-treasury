import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchLifecycleProposalEstimateContext,
  fetchWalletLifecycleAccountInfo,
  inferProposalPeriod,
  mapProposalItemToDetailProposal,
  mapProposalItemToEntry,
} from "./treasury-header-api";
import * as minaAccounts from "./mina-accounts";

describe("fetchWalletLifecycleAccountInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zero voting weight when lifecycle account payloads are null", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("null"))
      .mockResolvedValueOnce(new Response("null"));

    await expect(
      fetchWalletLifecycleAccountInfo("http://127.0.0.1:4000", 12, "B62qwallet"),
    ).resolves.toEqual({
      delegatedTo: undefined,
      votingWeight: "0 MINA",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchLifecycleProposalEstimateContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted lifecycle treasury estimate inputs", async () => {
    vi.spyOn(minaAccounts, "fetchStakingLedgerTotalCurrency").mockResolvedValue("360000 MINA");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: "2400000000000000" })));

    await expect(
      fetchLifecycleProposalEstimateContext(
        "http://127.0.0.1:4000",
        "http://127.0.0.1:8080/graphql",
        12,
        "B62qtreasury",
      ),
    ).resolves.toEqual({
      treasuryBalance: "2400000 MINA",
      eligibleVotingWeight: "360000 MINA",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mapProposalItemToEntry", () => {
  it("uses the first markdown heading as the proposal title", () => {
    expect(
      mapProposalItemToEntry({
        id: "proposal-1",
        contents: "# Treasury Grants Round One\n\nBody copy here.",
        status: "pending",
      }).title,
    ).toBe("Treasury Grants Round One");
  });

  it("falls back to the proposal id when markdown has no heading", () => {
    expect(
      mapProposalItemToEntry({
        id: "proposal-2",
        contents: "Body only, no heading.",
        status: "pending",
      }).title,
    ).toBe("proposal-2");
  });

  it("defaults unknown indexer stage values to Proposal period", () => {
    expect(
      mapProposalItemToEntry({
        id: "proposal-4",
        status: "canonical",
      }).period,
    ).toBe("Proposal");
  });
});

describe("inferProposalPeriod", () => {
  it("treats unclassified status values as proposal period", () => {
    expect(inferProposalPeriod(undefined)).toBe("Proposal");
    expect(inferProposalPeriod("canonical")).toBe("Proposal");
    expect(inferProposalPeriod("pending")).toBe("Proposal");
  });

  it("maps final voting outcomes to cooldown", () => {
    expect(inferProposalPeriod("Passed")).toBe("Cooldown");
    expect(inferProposalPeriod("Rejected")).toBe("Cooldown");
    expect(inferProposalPeriod("Vetoed")).toBe("Cooldown");
  });
});

describe("mapProposalItemToDetailProposal", () => {
  it("maps proposal list payloads into detail proposals", () => {
    expect(
      mapProposalItemToDetailProposal({
        id: "proposal-3",
        lifecycleId: 12,
        proposalPublicKey: "B62qproposal",
        senderPublicKey: "B62qsender",
        recipient: "B62qrecipient",
        amount: "120000000000000",
        status: "Voting",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtBlockHeight: 123,
        createdAtBlockTimestamp: "2026-01-01T00:00:00.000Z",
        zkAppUriHash: "zk-hash",
        stakingEpochDataLedgerHash: "ledger-hash",
        paidOutAmount: "0",
        contents: "# Proposal Title\n\nBody",
      }),
    ).toMatchObject({
      id: "proposal-3",
      title: "Proposal Title",
      lifecycleId: 12,
      proposalAddress: "B62qproposal",
      proposer: "B62qsender",
      recipient: "B62qrecipient",
      requestedAmount: "120000000000000",
      createdAtBlock: 123,
      createdAtBlockTimestamp: "2026-01-01T00:00:00.000Z",
      zkAppUriHash: "zk-hash",
      stakingEpochDataLedgerHash: "ledger-hash",
      paidOutAmount: "0",
      contents: "# Proposal Title\n\nBody",
    });
  });
});
