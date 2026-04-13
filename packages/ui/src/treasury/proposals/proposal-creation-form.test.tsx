import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryProposalCreationForm } from "./proposal-creation-form";

afterEach(() => {
  cleanup();
});

describe("TreasuryProposalCreationForm", () => {
  it("shows lifecycle as read-only context and submits a valid draft", () => {
    const onSubmit = vi.fn();

    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Lifecycle")).toHaveProperty("disabled", true);
    expect(screen.getByDisplayValue("Lifecycle 12")).toBeTruthy();
    expect(screen.queryByLabelText("Proposal contract address")).toBeNull();
    const proposalAddressLabel = screen.getByText("Proposal contract address");
    const proposalAddressRow = proposalAddressLabel.parentElement?.parentElement as HTMLElement;
    const initialProposalAddress = within(proposalAddressRow).getByText(/^B62/).textContent;
    expect(initialProposalAddress).toBeTruthy();
    expect(
      within(proposalAddressRow).getByText(
        "Generated automatically during submission. The temporary private key is discarded automatically.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(proposalAddressRow).getByRole("button", {
        name: "Regenerate proposal contract address",
      }),
    );
    expect(within(proposalAddressRow).getByText(/^B62/).textContent).not.toBe(initialProposalAddress);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).type).toBe("number");
    expect(document.querySelectorAll('[data-component="mina-amount-suffix"]')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Governance office-hours expansion" },
    });
    expect(screen.getAllByText("Title").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Governance office-hours expansion").length).toBeGreaterThan(0);
    expect(screen.queryByText("Markdown heading")).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "96000" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "B62qrecipientAmbassador1111111111111111111111111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));

    expect(onSubmit).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      content:
        "# Governance office-hours expansion\n\n## Summary\n\nExpand recurring governance office hours.",
      amount: "96,000",
      recipient: "B62qrecipientAmbassador1111111111111111111111111111111111",
    });
  });

  it("routes wallet connection through the primary action when no wallet is connected", () => {
    const onConnectWalletClick = vi.fn();

    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress={null}
        onConnectWalletClick={onConnectWalletClick}
      />,
    );

    const connectButton = screen.getByRole("button", { name: "Connect proposer wallet" });
    expect(connectButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(connectButton);
    expect(onConnectWalletClick).toHaveBeenCalledOnce();
  });

  it("shows voting requirement estimates when enough context is available", () => {
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        treasuryBalance="24000000"
        eligibleVotingWeight="360000"
        initialAmount="96000"
      />,
    );

    expect(screen.getByText("Voting requirement estimate")).toBeTruthy();
    expect(screen.getByText("22.23% of eligible voting weight (80,029.74 MINA)")).toBeTruthy();
    expect(screen.getByText("51.73% yay over nay")).toBeTruthy();
  });

  it("shows voting requirement estimates from formatted web context values", () => {
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        treasuryBalance="12,400,000 MINA"
        eligibleVotingWeight="264,800 MINA"
        initialAmount="96,000"
      />,
    );

    expect(screen.getByText("24.05% of eligible voting weight (63,683.06 MINA)")).toBeTruthy();
    expect(screen.getByText("52.38% yay over nay")).toBeTruthy();
  });

  it("re-hydrates the amount field when draft-backed initial values arrive after mount", () => {
    const { rerender } = render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
      />,
    );

    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");

    rerender(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        initialAmount="96,000"
      />,
    );

    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("96000");
  });

  it("starts the content editor with a generic proposal template", () => {
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
      />,
    );

    const contentInput = screen.getByLabelText("Content") as HTMLTextAreaElement;
    expect(contentInput.value).toContain("## Summary");
    expect(contentInput.value).toContain("## Scope of work");
    expect(contentInput.value).not.toContain("# Proposal title");
  });

  it("renders markdown headings in preview mode", () => {
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        initialContent={"# Preview title\n\n## Summary\n\nPreview body"}
      />,
    );

    const previewTab = screen.getByRole("tab", { name: "Preview" });
    fireEvent.mouseDown(previewTab);
    fireEvent.click(previewTab);

    return waitFor(() => {
      expect(previewTab.getAttribute("data-state")).toBe("active");
      expect(screen.getByRole("heading", { name: "Summary" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Preview title" })).toBeNull();
    });
  });

  it("renders a cancel action when provided", () => {
    const onCancel = vi.fn();
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Create proposal" })).toBeTruthy();
  });

  it("shows a secondary save draft action during the proposal period", () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();

    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="proposal"
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        onSubmit={onSubmit}
        onSaveDraft={onSaveDraft}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Governance office-hours expansion" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "96000" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "B62qrecipientAmbassador1111111111111111111111111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    const draftButtons = screen.getAllByRole("button", { name: "Save as draft" });
    expect(draftButtons).toHaveLength(1);

    fireEvent.click(draftButtons[0] as HTMLButtonElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaveDraft).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      content:
        "# Governance office-hours expansion\n\n## Summary\n\nExpand recurring governance office hours.",
      amount: "96,000",
      recipient: "B62qrecipientAmbassador1111111111111111111111111111111111",
    });
  });

  it("saves a draft instead of creating a proposal outside the proposal period", () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();

    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        currentPeriod="cooldown"
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        onSubmit={onSubmit}
        onSaveDraft={onSaveDraft}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Governance office-hours expansion" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "96000" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "B62qrecipientAmbassador1111111111111111111111111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    expect(screen.getByRole("button", { name: "Save as draft" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Save as draft" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaveDraft).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress: "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      content:
        "# Governance office-hours expansion\n\n## Summary\n\nExpand recurring governance office hours.",
      amount: "96,000",
      recipient: "B62qrecipientAmbassador1111111111111111111111111111111111",
    });
  });
});
