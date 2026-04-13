import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TreasuryProposalDetail,
  type TreasuryProposalDetailProposal,
} from "./proposal-detail";

afterEach(() => {
  cleanup();
});

const NANO_MINA_PER_MINA = 1_000_000_000n;

function toNanomina(value: number | string): string {
  return (BigInt(value) * NANO_MINA_PER_MINA).toString();
}

const proposal: TreasuryProposalDetailProposal = {
  id: "P-130",
  title: "Zero-knowledge education grants for emerging regions",
  lifecycleId: 12,
  proposalAddress: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
  proposer: "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
  recipient: "B62qrecipientPassExample111111111111111111111111111111111",
  requestedAmount: toNanomina(120000),
  stage: "Voting",
  period: "Voting",
  createdAt: "2026-04-01T14:32:00.000Z",
  updatedAt: "2026-04-02T11:10:00.000Z",
  createdAtBlock: 450920,
  createdAtBlockTimestamp: "2026-04-01T14:32:00.000Z",
  zkAppUriHash: "jxd4rzzq0r4x8n88v4c1xv7c1c2kpyz0j9f8v0w9a2n7w6m0k1",
  stakingEpochDataLedgerHash: "jxledgerhash12pass0000000000000000000000000000000000",
  stakingEpochDataLedgerTotalCurrency: toNanomina(400000),
  requiredParticipationBp: "2000",
  requiredApprovalBp: "5100",
  requiredParticipation: toNanomina(80000),
  paidOutAmount: "0",
  contents:
    "# Zero-knowledge education grants for emerging regions\n\n## Overview\n\nThis proposal funds regional zero-knowledge education efforts.",
  latestVoteTally: {
    blockHeight: 450920,
    yayWeight: toNanomina(182450),
    nayWeight: toNanomina(38120),
    abstainWeight: toNanomina(9200),
    createdByEventType: "proposalVoteDispatched",
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5100",
    requiredParticipation: "80000",
    totalParticipatingVotes: toNanomina(229770),
    approvalBp: "8270",
    voteResult: "approved",
  },
};

describe("TreasuryProposalDetail", () => {
  it("renders proposal content, derived status, votes, and executions", () => {
    const onVoteYayClick = vi.fn();
    const onVoteNayClick = vi.fn();
    const onVoteAbstainClick = vi.fn();
    const votes = Array.from({ length: 11 }, (_, index) => ({
      id: `vote-${index + 1}`,
      voterPublicKey: `B62qvoter${String(index + 1).padStart(2, "0")}111111111111111111111111111111111111111111`,
      vote: "yay",
      voteWeight: toNanomina(92450),
      blockHeight: 450918 + index,
      status: "Counted",
    }));

    render(
      <TreasuryProposalDetail
        proposal={proposal}
        votes={votes}
        executions={[
          {
            id: "execution-1",
            recipient: proposal.recipient!,
            amountToPayOut: toNanomina(80000),
            bondAmount: toNanomina(5000),
            senderPublicKey: "B62qsenderPassExample1111111111111111111111111111111111111",
            paidOutAmount: toNanomina(80000),
            remainingAmount: toNanomina(40000),
            blockHeight: 451010,
            status: "Partially executed",
          },
        ]}
        contentVerificationStatus="verified"
        onVoteYayClick={onVoteYayClick}
        onVoteNayClick={onVoteNayClick}
        onVoteAbstainClick={onVoteAbstainClick}
      />,
    );

    expect(screen.getByText(proposal.title)).toBeTruthy();
    expect(screen.getByText("Passing")).toBeTruthy();
    expect(document.querySelector('[data-component="proposal-markdown-box"]')).toBeTruthy();
    expect(screen.getAllByText(proposal.title).length).toBe(1);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText(/regional zero-knowledge education efforts/i)).toBeTruthy();
    expect(screen.getByText("Amount")).toBeTruthy();
    expect(screen.getAllByText("Created at").length).toBeGreaterThan(0);
    expect(screen.getByText("Proposal address")).toBeTruthy();
    expect(screen.getAllByText("Recipient").length).toBeGreaterThan(0);
    expect(screen.getByText("120,000 MINA")).toBeTruthy();
    expect(screen.getAllByText("Bond amount").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12,000 MINA").length).toBeGreaterThan(0);
    expect(screen.getByText("B62qr81JquSr...noXuzc8qcE9g")).toBeTruthy();
    expect(screen.getByText("B62qrecipien...111111111111")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Voting" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Execute / payout" })).toBeTruthy();
    expect(screen.getByText("Votes")).toBeTruthy();
    expect(screen.getByText("Execution history")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yay" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nay" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abstain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Must pass to execute" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText(votes[0]!.voterPublicKey)).toBeTruthy();
    expect(screen.getByText("Executed by")).toBeTruthy();
    expect(screen.getByText("B62qsenderPassExample1111111111111111111111111111111111111")).toBeTruthy();
    expect(screen.getAllByText("Page 1 of 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Showing 1-10 of 11").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Yay" }));
    fireEvent.click(screen.getByRole("button", { name: "Nay" }));
    fireEvent.click(screen.getByRole("button", { name: "Abstain" }));
    expect(onVoteYayClick).toHaveBeenCalledOnce();
    expect(onVoteNayClick).toHaveBeenCalledOnce();
    expect(onVoteAbstainClick).toHaveBeenCalledOnce();

    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    expect(screen.getByText(votes[10]!.voterPublicKey)).toBeTruthy();
    expect(screen.getAllByText("Page 2 of 2").length).toBeGreaterThan(0);
  });

  it("renders empty states without voting actions outside voting period", () => {
    render(
      <TreasuryProposalDetail
        proposal={{ ...proposal, latestVoteTally: null, period: "Cooldown" }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Yay" })).toBeNull();
    expect(screen.getByText("No vote records are available for this proposal yet.")).toBeTruthy();
    expect(
      screen.getByText("No execution records are available for this proposal yet."),
    ).toBeTruthy();
  });

  it("shows the normal voting layout with a frosted overlay before voting starts", () => {
    render(
      <TreasuryProposalDetail
        proposal={{ ...proposal, period: "Proposal", latestVoteTally: null }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Voting" })).toBeTruthy();
    expect(screen.getByText("Current vote status")).toBeTruthy();
    expect(screen.getByText("Voting details")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Nay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Abstain" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Waiting for voting to start")).toBeTruthy();
    expect(
      screen.getByText(/Voting actions will unlock once this proposal enters the voting period\./),
    ).toBeTruthy();
    expect(document.querySelector('[data-component="proposal-voting-pending-overlay"]')).toBeTruthy();
  });

  it("shows connect wallet instead of vote actions when disconnected", () => {
    const onConnectWalletClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={proposal}
        hasConnectedWallet={false}
        onConnectWalletClick={onConnectWalletClick}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect a wallet to vote" })).toBeTruthy();
    expect(screen.getByText("Cast a vote")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abstain" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Connect a wallet to vote" }));
    expect(onConnectWalletClick).toHaveBeenCalledOnce();
  });

  it("calls lifecycle click handler when lifecycle link is pressed", () => {
    const onLifecycleClick = vi.fn();

    render(<TreasuryProposalDetail proposal={proposal} onLifecycleClick={onLifecycleClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Lifecycle 12" }));
    expect(onLifecycleClick).toHaveBeenCalledWith(12);
  });

  it("renders github-flavored markdown tables and task lists", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          contents:
            "# Zero-knowledge education grants for emerging regions\n\n## Checklist\n\n- [x] draft published\n- [ ] final review\n\n## Budget\n\n| Item | Amount |\n| --- | ---: |\n| Workshops | 60,000 MINA |\n| Reporting | 15,000 MINA |",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Checklist" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
    expect(screen.getByRole("checkbox", { checked: false })).toBeTruthy();
    expect(screen.getByText("Workshops")).toBeTruthy();
    expect(screen.getByText("60,000 MINA")).toBeTruthy();
  });

  it("shows preview voting details and expands the rest on demand", () => {
    render(<TreasuryProposalDetail proposal={proposal} />);

    expect(screen.getByText("Participating votes")).toBeTruthy();
    expect(screen.getByText("Latest tally block")).toBeTruthy();
    expect(screen.getByText("Eligible voting weight")).toBeTruthy();
    expect(screen.queryByText("Yay weight")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" }).at(-1)!);
    expect(screen.getByText("Yay weight")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Hide details" }).length).toBeGreaterThan(0);
  });

  it("shows an empty vote summary bar when the proposal is abandoned", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          period: "Cooldown",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            yayWeight: "0",
            nayWeight: "0",
            abstainWeight: "0",
            totalParticipatingVotes: "0",
            createdByEventType: "proposalVotesTallied",
            voteResult: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Abandoned")).toBeTruthy();
    expect(document.querySelector('[data-component="proposal-empty-vote-summary"]')).toBeTruthy();
    expect(screen.getByText("Current vote status")).toBeTruthy();
  });

  it("keeps execute payout locked during cooldown even when the proposal passed", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Cooldown",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
      />,
    );

    expect(screen.getByText("Execution available post-cooldown")).toBeTruthy();
    expect(screen.getByText("This proposal has been tallied on-chain and passed, but execution is only possible after cooldown ends.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Available post-cooldown" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("keeps execute payout locked when a passed proposal still resolves to voting period", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Voting",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
      />,
    );

    expect(screen.getByText("Execution available post-cooldown")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.getByRole("button", { name: "Available post-cooldown" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("unlocks execute payout for passed proposals from earlier lifecycles", () => {
    const onExecutePayoutClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Cooldown",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
        currentLifecycleId={proposal.lifecycleId + 1}
        executions={[]}
        onExecutePayoutClick={onExecutePayoutClick}
      />,
    );

    expect(screen.queryByText("Execution available post-cooldown")).toBeNull();
    expect(screen.getByRole("button", { name: "Execute proposal" }).hasAttribute("disabled")).toBe(
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "Execute proposal" }));
    expect(onExecutePayoutClick).toHaveBeenCalledWith("132000");
  });

  it("shows an execution warning until an on-chain tally has been submitted", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Cooldown",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVoteDispatched",
          },
        }}
      />,
    );

    expect(screen.getByText("Awaiting on-chain tally submission")).toBeTruthy();
    expect(
      screen.getByText("Voting has ended, but execution stays locked until the final on-chain tally is submitted."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit tally first" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("enables execute payout after a passed proposal clears cooldown", () => {
    const onExecutePayoutClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Executed",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
        executions={[]}
        onExecutePayoutClick={onExecutePayoutClick}
      />,
    );

    const amountInput = screen.getByLabelText("Payout amount") as HTMLInputElement;
    expect(amountInput.type).toBe("number");
    expect(amountInput.value).toBe("132000");
    expect(document.querySelectorAll('[data-component="mina-amount-suffix"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Execute proposal" }));
    expect(onExecutePayoutClick).toHaveBeenCalledWith("132000");
  });

  it("validates payout amount against the remaining payout", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Executed",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
        executions={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Payout amount"), {
      target: { value: "200000" },
    });

    expect(
      screen.getByText("Payout amount cannot exceed the remaining payout of 132,000 MINA."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Execute proposal" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("requires the proposer wallet to be connected before execution", () => {
    const onConnectProposerWalletClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Passed",
          period: "Executed",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
        executions={[]}
        hasConnectedProposerWallet={false}
        onConnectProposerWalletClick={onConnectProposerWalletClick}
      />,
    );

    expect(
      screen.getByText(
        "Connect the proposer wallet before executing or paying out this proposal.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect recipient wallet to execute" }));
    expect(onConnectProposerWalletClick).toHaveBeenCalledOnce();
  });

  it("shows a paused warning and disables vote actions when a voting proposal is paused", () => {
    const onVoteYayClick = vi.fn();
    const onVoteNayClick = vi.fn();
    const onVoteAbstainClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={{ ...proposal, isPaused: true }}
        onVoteYayClick={onVoteYayClick}
        onVoteNayClick={onVoteNayClick}
        onVoteAbstainClick={onVoteAbstainClick}
      />,
    );

    expect(screen.getAllByText("VETOED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Proposal vetoed").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Voting and execution actions are disabled for this vetoed proposal.",
      ),
    ).toBeTruthy();
    expect(document.querySelector('[data-component="proposal-paused-banner"]')).toBeTruthy();
    expect(document.querySelector('[data-component="proposal-paused-overlay"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Nay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Abstain" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Yay" }));
    fireEvent.click(screen.getByRole("button", { name: "Nay" }));
    fireEvent.click(screen.getByRole("button", { name: "Abstain" }));
    expect(onVoteYayClick).not.toHaveBeenCalled();
    expect(onVoteNayClick).not.toHaveBeenCalled();
    expect(onVoteAbstainClick).not.toHaveBeenCalled();
  });

  it("treats paused stage as vetoed when isPaused is missing", () => {
    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          stage: "Paused",
          period: "Proposal",
          isPaused: undefined,
          latestVoteTally: null,
        }}
      />,
    );

    expect(screen.getAllByText("VETOED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Proposal vetoed").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-component="proposal-paused-banner"]')).toBeTruthy();
  });

  it("disables execution controls when a passed proposal is paused", () => {
    const onExecutePayoutClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={{
          ...proposal,
          isPaused: true,
          stage: "Passed",
          period: "Executed",
          latestVoteTally: {
            ...proposal.latestVoteTally!,
            createdByEventType: "proposalVotesTallied",
          },
        }}
        executions={[]}
        onExecutePayoutClick={onExecutePayoutClick}
      />,
    );

    expect(screen.getAllByText("VETOED").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "This proposal has been vetoed. Voting and execution actions are disabled.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Payout amount") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Proposal vetoed" }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Proposal vetoed" }));
    expect(onExecutePayoutClick).not.toHaveBeenCalled();
  });

  it("disables vote actions and shows an overlay when voting weight is zero", () => {
    const onVoteYayClick = vi.fn();
    const onVoteNayClick = vi.fn();
    const onVoteAbstainClick = vi.fn();

    render(
      <TreasuryProposalDetail
        proposal={proposal}
        hasConnectedWallet
        connectedWalletVotingWeight="0"
        onVoteYayClick={onVoteYayClick}
        onVoteNayClick={onVoteNayClick}
        onVoteAbstainClick={onVoteAbstainClick}
      />,
    );

    expect(document.querySelector('[data-component="proposal-zero-voting-weight-overlay"]')).toBeTruthy();
    expect(
      screen.getByText(
        "You have zero voting weight. Connect a wallet with more than zero voting weight.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Nay" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Abstain" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Yay" }));
    fireEvent.click(screen.getByRole("button", { name: "Nay" }));
    fireEvent.click(screen.getByRole("button", { name: "Abstain" }));
    expect(onVoteYayClick).not.toHaveBeenCalled();
    expect(onVoteNayClick).not.toHaveBeenCalled();
    expect(onVoteAbstainClick).not.toHaveBeenCalled();
  });

  it("shows content verification failure state", () => {
    render(<TreasuryProposalDetail proposal={proposal} contentVerificationStatus="mismatch" />);

    expect(screen.getByText("Mismatch")).toBeTruthy();
  });
});
