import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchLifecycleProposalEstimateContext,
  fetchProposalExecutionsPage,
  fetchProposalItem,
  fetchProposalVotesPage,
  fetchWalletLifecycleAccountInfo,
  inferProposalPeriod,
  mapProposalItemToDetailProposal,
  mapProposalItemToEntry,
} from "./treasury-header-api";
import * as minaAccounts from "./mina-accounts";

describe("fetchProposalItem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches one proposal by its public key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "proposal-1",
          proposalPublicKey: "B62qproposal/key",
        }),
      ),
    );

    await expect(
      fetchProposalItem("http://127.0.0.1:3100/api", "B62qproposal/key"),
    ).resolves.toMatchObject({
      id: "proposal-1",
      proposalPublicKey: "B62qproposal/key",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/proposals/B62qproposal%2Fkey",
    );
  });

  it("returns null when the proposal is not indexed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Proposal not found" }), {
        status: 404,
      }),
    );

    await expect(
      fetchProposalItem("http://127.0.0.1:3100/api", "B62qmissing"),
    ).resolves.toBeNull();
  });
});

describe("proposal detail pagination", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a page of proposal votes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total: 12,
          limit: 5,
          offset: 5,
          nextOffset: 10,
          items: [
            {
              id: "vote-6",
              voterPublicKey: "B62qvoter",
              vote: "yay",
              voteWeight: "1000",
            },
          ],
        }),
      ),
    );

    await expect(
      fetchProposalVotesPage("http://127.0.0.1:3100/api", "B62qproposal/key", {
        limit: 5,
        offset: 5,
      }),
    ).resolves.toMatchObject({
      total: 12,
      limit: 5,
      offset: 5,
      nextOffset: 10,
      items: [
        {
          id: "vote-6",
          voterPublicKey: "B62qvoter",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/proposals/B62qproposal%2Fkey/votes?limit=5&offset=5",
    );
  });

  it("fetches a page of proposal executions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total: 3,
          limit: 2,
          offset: 0,
          nextOffset: 2,
          items: [
            {
              id: "execution-1",
              senderPublicKey: "B62qexecutor",
              amountToPayOut: "1250000001",
              paidOutAmount: "1250000001",
              remainingAmount: "0",
              status: "pending",
            },
          ],
        }),
      ),
    );

    await expect(
      fetchProposalExecutionsPage("http://127.0.0.1:3100/api", "B62qproposal", {
        limit: 2,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
      nextOffset: 2,
      items: [
        {
          id: "execution-1",
          senderPublicKey: "B62qexecutor",
          amountToPayOut: "1250000001",
          paidOutAmount: "1250000001",
          remainingAmount: "0",
          status: "pending",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/proposals/B62qproposal/executions?limit=2&offset=0",
    );
  });
});

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
      fetchWalletLifecycleAccountInfo(
        "http://127.0.0.1:4000",
        12,
        "B62qwallet",
      ),
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
    vi.spyOn(minaAccounts, "fetchStakingLedgerTotalCurrency").mockResolvedValue(
      "360000 MINA",
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ balance: "2400000000000000" })),
      );

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

  it("maps active tallies and observation metadata", () => {
    const runningVoteTally = {
      blockHeight: 101,
      yayWeight: "10",
      nayWeight: "2",
      abstainWeight: "1",
      createdByEventType: "proposalVoteDispatched" as const,
      voteResult: "approved" as const,
    };
    const finalVoteTally = {
      ...runningVoteTally,
      archiveEventId: "event-final-pending",
      blockEventIndex: 4,
      sourceStatus: "pending" as const,
      blockHeight: 103,
      createdByEventType: "proposalVotesTallied" as const,
    };

    expect(
      mapProposalItemToEntry({
        id: "proposal-status",
        status: "canonical",
        stage: "Passed",
        contractStatus: "approved",
        contractStatusFinality: "pending",
        contractStatusSourceEventId: "event-status",
        statusAsOfBlockHeight: 103,
        creationObservationStatus: "canonical",
        runningVoteTally,
        finalVoteTally,
        latestVoteTally: finalVoteTally,
        isPaused: true,
      }),
    ).toMatchObject({
      contractStatus: "approved",
      contractStatusFinality: "pending",
      contractStatusSourceEventId: "event-status",
      statusAsOfBlockHeight: 103,
      creationObservationStatus: "canonical",
      runningVoteTally,
      finalVoteTally,
      isPaused: true,
    });
  });

  it("preserves the active contract status and exact paused state", () => {
    expect(
      mapProposalItemToEntry({
        id: "proposal-paused",
        contractStatus: "paused",
        contractStatusFinality: "pending",
        isPaused: true,
      }),
    ).toMatchObject({
      contractStatus: "paused",
      contractStatusFinality: "pending",
      isPaused: true,
    });
  });

  it("does not use the observation status as the contract stage", () => {
    expect(
      mapProposalItemToEntry({
        id: "proposal-pending-observation",
        status: "pending",
      }).stage,
    ).toBe("Unknown");
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
        stage: "Voting",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtBlockHeight: 123,
        createdAtBlockTimestamp: "2026-01-01T00:00:00.000Z",
        zkAppUriHash: "zk-hash",
        stakingEpochDataLedgerHash: "ledger-hash",
        paidOutAmount: "0",
        totalPayoutAmount: "132000000000000",
        remainingPayoutAmount: "132000000000000",
        payoutAmountIntegrity: false,
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
      totalPayoutAmount: "132000000000000",
      remainingPayoutAmount: "132000000000000",
      payoutAmountIntegrity: false,
      contents: "# Proposal Title\n\nBody",
    });
  });
});
