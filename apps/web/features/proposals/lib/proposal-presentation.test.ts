import { describe, expect, it } from "vitest";
import {
  applyDerivedProposalPresentationToDetail,
  applyDerivedProposalPresentationToEntry,
} from "./proposal-presentation";

describe("proposal presentation", () => {
  it("maps proposals in the current exploration lifecycle to the Exploration period", () => {
    expect(
      applyDerivedProposalPresentationToEntry(
        {
          id: "P-1",
          title: "Proposal",
          lifecycleId: 12,
          proposer: "B62qsender",
          requestedAmount: "1000000000",
          stage: "canonical",
          period: "Voting",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        12,
        "exploration",
      ).period,
    ).toBe("Exploration");
  });

  it("maps historical proposals to the Cooldown period", () => {
    expect(
      applyDerivedProposalPresentationToDetail(
        {
          id: "P-1",
          title: "Proposal",
          lifecycleId: 11,
          proposer: "B62qsender",
          requestedAmount: "1000000000",
          stage: "canonical",
          period: "Voting",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        12,
        "exploration",
      ).period,
    ).toBe("Cooldown");
  });
});
