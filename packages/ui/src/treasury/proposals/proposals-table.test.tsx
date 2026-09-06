import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TreasuryCooldownPeriodTable,
  TreasuryExplorationPeriodTable,
  TreasuryProposalPeriodTable,
  TreasuryProposalsTable,
  type TreasuryProposalTableEntry,
  TreasuryVotingPeriodTable,
  VoteSummaryChart,
} from "./proposals-table";

afterEach(() => {
  cleanup();
});

const NANO_MINA_PER_MINA = 1_000_000_000n;

function toNanomina(value: number | string): string {
  return (BigInt(value) * NANO_MINA_PER_MINA).toString();
}

const entries: TreasuryProposalTableEntry[] = [
  {
    id: "P-3",
    title: "Gamma proposal",
    lifecycleId: 12,
    proposalAddress: "B62qgammaTreasuryProposalAddress0003",
    proposer: "B62qgamma",
    requestedAmount: toNanomina(300),
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-03-03T14:18:00.000Z",
    createdAtBlock: 450003,
    stakingEpochDataLedgerTotalCurrency: toNanomina(100),
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5100",
    latestVoteTally: {
      blockHeight: 450010,
      yayWeight: toNanomina(30),
      nayWeight: toNanomina(12),
      abstainWeight: toNanomina(4),
      createdByEventType: "proposalVoteDispatched",
      voteResult: "approved",
    },
  },
  {
    id: "P-2",
    title: "Beta proposal",
    lifecycleId: 11,
    proposalAddress: "B62qbetaTreasuryProposalAddress0002",
    proposer: "B62qbeta",
    requestedAmount: toNanomina(200),
    stage: "Approved",
    period: "Cooldown",
    createdAt: "2026-03-02T10:04:00.000Z",
    createdAtBlock: 449884,
    stakingEpochDataLedgerTotalCurrency: toNanomina(100),
    requiredParticipationBp: "3000",
    requiredApprovalBp: "8000",
    latestVoteTally: {
      blockHeight: 449900,
      yayWeight: toNanomina(45),
      nayWeight: toNanomina(10),
      abstainWeight: toNanomina(3),
      createdByEventType: "proposalVotesTallied",
      voteResult: "approved",
    },
  },
  {
    id: "P-1",
    title: "Alpha proposal",
    lifecycleId: 10,
    proposalAddress: "B62qalphaTreasuryProposalAddress0001",
    proposer: "B62qalpha",
    requestedAmount: toNanomina(100),
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-03-01T08:40:00.000Z",
    createdAtBlock: 449771,
  },
];

describe("TreasuryProposalsTable", () => {
  it("renders total entries and default sorted rows", () => {
    render(<TreasuryProposalsTable entries={entries} />);
    const expectedLocalizedCreatedAt = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date("2026-03-03T14:18:00.000Z"));

    expect(screen.queryByText("3 total entries")).toBeNull();
    expect(
      screen.getByText("B62qgammaTreasuryProposalAddress0003"),
    ).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(expectedLocalizedCreatedAt)).toBeTruthy();
    expect(screen.getByText("#450003")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.getByText("Showing 1-3 of 3")).toBeTruthy();
    const titles = screen
      .getAllByRole("cell")
      .map((cell: HTMLElement) => cell.textContent ?? "");
    expect(titles.join(" ")).toContain("Gamma proposal");
  });

  it("filters rows by search query", () => {
    render(<TreasuryProposalsTable entries={entries} />);

    fireEvent.change(screen.getByLabelText("Filter proposals"), {
      target: { value: "beta" },
    });

    expect(screen.getByText("Beta proposal")).toBeTruthy();
    expect(screen.queryByText("Gamma proposal")).toBeNull();
    expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
  });

  it("shows all lifecycles first and reports lifecycle filter changes", () => {
    const onLifecycleChange = vi.fn();

    render(
      <TreasuryProposalsTable
        entries={entries}
        largeTitle
        lifecycleId={2}
        lifecycleOptions={[3, 2, 1, 0]}
        onLifecycleChange={onLifecycleChange}
      />,
    );

    const selector = screen.getByRole("combobox", {
      name: "Select lifecycle",
    }) as HTMLSelectElement;
    expect(selector.value).toBe("2");
    expect(
      Array.from(selector.options).map((option) => option.textContent),
    ).toEqual([
      "All lifecycles",
      "Lifecycle 3",
      "Lifecycle 2",
      "Lifecycle 1",
      "Lifecycle 0",
    ]);

    fireEvent.change(selector, { target: { value: "" } });
    expect(onLifecycleChange).toHaveBeenCalledWith(undefined);
  });

  it("sorts by requested amount when column header is clicked", () => {
    render(<TreasuryProposalsTable entries={entries} />);

    fireEvent.click(screen.getByRole("button", { name: /requested/i }));

    const amounts = screen
      .getAllByText(/MINA$/)
      .map((cell: HTMLElement) => cell.textContent);
    expect(amounts[0]).toBe("100 MINA");

    fireEvent.click(screen.getByRole("button", { name: /requested/i }));

    const reversedAmounts = screen
      .getAllByText(/MINA$/)
      .map((cell: HTMLElement) => cell.textContent);
    expect(reversedAmounts[0]).toBe("300 MINA");
  });

  it("updates page size selector", () => {
    render(<TreasuryProposalsTable entries={entries} />);

    fireEvent.change(screen.getByLabelText("Entries per page"), {
      target: { value: "20" },
    });

    expect(screen.getByDisplayValue("20")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("supports server-driven pagination and sorting callbacks", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const onSortChange = vi.fn();

    render(
      <TreasuryProposalsTable
        entries={entries.slice(0, 2)}
        page={2}
        pageSize={10}
        totalCount={25}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        sortKey="createdAt"
        sortDirection="desc"
        onSortChange={onSortChange}
        sortableColumns={["proposer", "requestedAmount", "createdAt"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /created at/i }));
    expect(onSortChange).toHaveBeenCalledWith("createdAt", "asc");
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByLabelText("Entries per page"), {
      target: { value: "20" },
    });
    expect(onPageSizeChange).toHaveBeenCalledWith(20);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("renders a configurable subset of columns", () => {
    render(
      <TreasuryProposalsTable
        entries={entries}
        columns={["title", "stage", "createdAt"]}
      />,
    );

    expect(screen.getByRole("button", { name: /title/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /status/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /created at/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /lifecycle/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /proposer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /requested/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /period/i })).toBeNull();
  });

  it("sorts using the first visible column when created date is hidden", () => {
    render(
      <TreasuryProposalsTable
        entries={entries}
        columns={["requestedAmount", "title"]}
      />,
    );

    const amounts = screen
      .getAllByText(/MINA$/)
      .map((cell: HTMLElement) => cell.textContent);
    expect(amounts[0]).toBe("300 MINA");
  });

  it("renders loading rows with stable table structure", () => {
    render(<TreasuryProposalsTable entries={[]} loading />);

    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText("No proposals match the current filter."),
    ).toBeNull();
  });

  it("derives early lifecycle statuses only in the standalone proposals table", () => {
    render(
      <TreasuryProposalsTable
        entries={[
          {
            ...entries[0]!,
            id: "P-10",
            title: "Proposal-period row",
            period: "Proposal",
            stage: "Submitted",
            latestVoteTally: undefined,
          },
          {
            ...entries[0]!,
            id: "P-11",
            title: "Exploration-period row",
            period: "Exploration",
            stage: "Active review",
            latestVoteTally: undefined,
          },
        ]}
      />,
    );

    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Exploration")).toBeTruthy();
  });

  it("shows only the vote split in voting and later wrappers", () => {
    render(<TreasuryVotingPeriodTable entries={entries} />);

    expect(screen.queryByRole("button", { name: /^vote$/i })).toBeNull();
    expect(screen.getByText("Votes")).toBeTruthy();
    expect(screen.getByText("Criteria")).toBeTruthy();
    expect(document.body.textContent).toContain("Yay 65.217%");
    expect(screen.getAllByText("Participation").length).toBeGreaterThan(0);
    expect(screen.getByText("46%")).toBeTruthy();
    expect(screen.getByText("/ 20%")).toBeTruthy();
    expect(screen.getByText("71.4%")).toBeTruthy();
    expect(screen.getByText("/ 51%")).toBeTruthy();
    expect(screen.getByText("Passing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /proposer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /created at/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /period/i })).toBeNull();

    cleanup();

    render(<TreasuryCooldownPeriodTable entries={entries} />);

    expect(document.body.textContent).toContain("Yay 77.586%");
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Criteria")).toBeTruthy();
    expect(screen.getByRole("button", { name: /proposer/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /created at/i })).toBeNull();
  });

  it("shows a tiny vote share as less than 0.001%", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-tiny",
            latestVoteTally: {
              blockHeight: 450011,
              yayWeight: toNanomina(1),
              nayWeight: toNanomina(200000),
              abstainWeight: "0",
              createdByEventType: "proposalVoteDispatched",
              voteResult: "rejected",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Yay < 0.001%")).toBeTruthy();
  });

  it("renders an empty vote bar when no votes exist", () => {
    render(<VoteSummaryChart eligibleVotingWeight={100} />);

    expect(screen.getByText("Yay 0.000%")).toBeTruthy();
    expect(screen.getByText("Nay 0.000%")).toBeTruthy();
    expect(screen.getByText("Abstain 0.000%")).toBeTruthy();
    expect(screen.queryByText("-")).toBeNull();
  });

  it("shows an awaiting result when a cooldown proposal has no contract result", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-5",
            title: "Epsilon proposal",
            contractStatus: "unknown",
            contractStatusFinality: "canonical",
            latestVoteTally: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Awaiting on-chain result")).toBeTruthy();
  });

  it("does not invent a final result when participation quorum is not met", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-9",
            title: "Iota proposal",
            stakingEpochDataLedgerTotalCurrency: toNanomina(100),
            requiredParticipationBp: "7000",
            contractStatus: "unknown",
            contractStatusFinality: "canonical",
            runningVoteTally: {
              blockHeight: 449902,
              yayWeight: toNanomina(40),
              nayWeight: toNanomina(5),
              abstainWeight: toNanomina(5),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "approved",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Awaiting on-chain result")).toBeTruthy();
  });

  it("does not invent a final result for an all-abstain cooldown tally", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-all-abstain",
            title: "All-abstain proposal",
            contractStatus: "unknown",
            contractStatusFinality: "canonical",
            runningVoteTally: {
              blockHeight: 449902,
              yayWeight: "0",
              nayWeight: "0",
              abstainWeight: toNanomina(80),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "rejected",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Awaiting on-chain result")).toBeTruthy();
  });

  it("shows failing in cooldown when dispatched tally misses participation quorum", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-9-dispatched",
            title: "Iota proposal (dispatched)",
            stakingEpochDataLedgerTotalCurrency: toNanomina(100),
            requiredParticipationBp: "7000",
            latestVoteTally: {
              blockHeight: 449903,
              yayWeight: toNanomina(40),
              nayWeight: toNanomina(5),
              abstainWeight: toNanomina(5),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "approved",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Failing")).toBeTruthy();
    expect(screen.queryByText("Waiting for votes")).toBeNull();
  });

  it("shows waiting for votes when a tally exists but weights are zero", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-4",
            title: "Delta proposal",
            latestVoteTally: {
              blockHeight: 450011,
              yayWeight: "0",
              nayWeight: "0",
              abstainWeight: "0",
              createdByEventType: "proposalVoteDispatched",
              voteResult: "rejected",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Waiting for votes")).toBeTruthy();
  });

  it("shows waiting for votes when only abstain votes exist in voting", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-6",
            title: "Zeta proposal",
            latestVoteTally: {
              blockHeight: 450012,
              yayWeight: "0",
              nayWeight: "0",
              abstainWeight: toNanomina(18),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "rejected",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Waiting for votes")).toBeTruthy();
  });

  it("shows waiting for votes when participation quorum is not met", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-7",
            title: "Eta proposal",
            stakingEpochDataLedgerTotalCurrency: toNanomina(100),
            requiredParticipationBp: "6000",
            latestVoteTally: {
              blockHeight: 450013,
              yayWeight: toNanomina(20),
              nayWeight: toNanomina(10),
              abstainWeight: toNanomina(5),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "approved",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Waiting for votes")).toBeTruthy();
  });

  it("keeps paused as dominant legacy state without an explicit flag", () => {
    render(
      <TreasuryProposalsTable
        entries={[
          {
            ...entries[0]!,
            id: "P-paused-stage",
            title: "Paused-stage proposal",
            stage: "Paused",
            period: "Proposal",
            isPaused: undefined,
            latestVoteTally: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("PAUSED")).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
  });

  it("prefers an exact false paused flag over a stale paused status", () => {
    render(
      <TreasuryProposalsTable
        statusDerivationPeriod="proposal"
        entries={[
          {
            ...entries[0]!,
            id: "P-exact-not-paused",
            contractStatus: "paused",
            isPaused: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.queryByText("PAUSED")).toBeNull();
  });

  it("uses current contract status instead of a stale latest tally", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-reset",
            title: "Reset proposal",
            contractStatus: "unknown",
            contractStatusFinality: "canonical",
            finalVoteTally: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Awaiting on-chain result")).toBeTruthy();
    expect(screen.queryByText("Passed")).toBeNull();
  });

  it("uses pending final tallies as the current result", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-pending-approved",
            title: "Pending approved proposal",
            contractStatus: "approved",
            contractStatusFinality: "pending",
            finalVoteTally: {
              ...entries[1]!.latestVoteTally!,
              sourceStatus: "pending",
            },
          },
          {
            ...entries[1]!,
            id: "P-pending-rejected",
            title: "Pending rejected proposal",
            contractStatus: "rejected",
            contractStatusFinality: "pending",
            finalVoteTally: {
              ...entries[1]!.latestVoteTally!,
              voteResult: "rejected",
              sourceStatus: "pending",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("uses a pending running tally as the current voting tally", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-pending-running-tally",
            runningVoteTally: {
              ...entries[0]!.latestVoteTally!,
              sourceStatus: "pending",
            },
            latestVoteTally: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Passing")).toBeTruthy();
  });

  it("prefers the exact paused flag over the current status", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-current-status-paused",
            contractStatus: "unknown",
            contractStatusFinality: "pending",
            isPaused: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("PAUSED")).toBeTruthy();
  });

  it("does not treat missing acceptance criteria as satisfied", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-missing-criteria",
            requiredParticipationBp: null,
            requiredApprovalBp: null,
            requiredParticipation: null,
            latestVoteTally: {
              ...entries[0]!.latestVoteTally!,
              requiredParticipationBp: null,
              requiredApprovalBp: null,
              requiredParticipation: null,
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Waiting for votes")).toBeTruthy();
    expect(screen.queryByText("Passing")).toBeNull();
  });

  it("does not infer a passed final tally without approval criteria", () => {
    render(
      <TreasuryCooldownPeriodTable
        entries={[
          {
            ...entries[1]!,
            id: "P-final-missing-approval",
            contractStatus: undefined,
            contractStatusFinality: undefined,
            requiredApprovalBp: null,
            finalVoteTally: {
              ...entries[1]!.latestVoteTally!,
              requiredApprovalBp: null,
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.queryByText("Passed")).toBeNull();
  });

  it("compares participation weights with bigint precision", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-large-weight",
            requiredParticipation: "9007199254740993",
            requiredApprovalBp: "5000",
            latestVoteTally: {
              ...entries[0]!.latestVoteTally!,
              yayWeight: "9007199254740992",
              nayWeight: "0",
              abstainWeight: "0",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Waiting for votes")).toBeTruthy();
    expect(screen.queryByText("Passing")).toBeNull();
  });

  it("shows failing when quorum is met but approval threshold is not", () => {
    render(
      <TreasuryVotingPeriodTable
        entries={[
          {
            ...entries[0]!,
            id: "P-8",
            title: "Theta proposal",
            stakingEpochDataLedgerTotalCurrency: toNanomina(100),
            requiredParticipationBp: "2000",
            requiredApprovalBp: "7000",
            latestVoteTally: {
              blockHeight: 450014,
              yayWeight: toNanomina(25),
              nayWeight: toNanomina(20),
              abstainWeight: toNanomina(5),
              createdByEventType: "proposalVoteDispatched",
              voteResult: "approved",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Failing")).toBeTruthy();
  });

  it("hides status in proposal and exploration wrappers", () => {
    render(<TreasuryProposalPeriodTable entries={entries} />);

    expect(screen.queryByRole("button", { name: /status/i })).toBeNull();

    cleanup();

    render(<TreasuryExplorationPeriodTable entries={entries} />);

    expect(screen.queryByRole("button", { name: /status/i })).toBeNull();
  });

  it("renders empty state with create proposal action", () => {
    const onCreateProposalClick = vi.fn();

    render(
      <TreasuryProposalsTable
        entries={[]}
        onCreateProposalClick={onCreateProposalClick}
      />,
    );

    expect(screen.getByText("No proposals available yet.")).toBeTruthy();
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
    expect(screen.queryByText(/Showing \d+-\d+ of \d+/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));

    expect(onCreateProposalClick).toHaveBeenCalledTimes(1);
  });

  it("uses filter-specific empty copy only when a query is applied", () => {
    render(<TreasuryProposalsTable entries={entries} />);

    fireEvent.change(screen.getByLabelText("Filter proposals"), {
      target: { value: "does-not-exist" },
    });

    expect(
      screen.getByText("No proposals match the current filter."),
    ).toBeTruthy();
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
  });

  it("supports clickable proposal rows for navigation", () => {
    const onProposalClick = vi.fn();

    render(
      <TreasuryProposalsTable
        entries={entries}
        onProposalClick={onProposalClick}
      />,
    );

    fireEvent.click(screen.getByText("Gamma proposal"));

    expect(onProposalClick).toHaveBeenCalledWith(
      expect.objectContaining({
        ...entries[0],
        stage: "Passing",
        voteSummary: { yay: 30, nay: 12, abstain: 4 },
      }),
    );
  });
});
