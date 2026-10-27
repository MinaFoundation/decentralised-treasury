import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryProposalCreationForm } from "./proposal-creation-form";
import {
  defaultProposalAcknowledgements,
  type ProposalAcknowledgementsConfig,
} from "./proposal-acknowledgements-config";

const validProposalProps = {
  lifecycleId: 12,
  connectedWalletAddress: "wallet",
  initialTitle: "Proposal",
  initialContent: "Work",
  initialRecipient: "recipient",
  initialAmount: "10",
};

function acceptAcknowledgements(): void {
  for (const key of ["kyc", "terms"] as const) {
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: defaultProposalAcknowledgements[key].label,
      }),
    );
  }
}

afterEach(() => {
  cleanup();
});

describe("TreasuryProposalCreationForm", () => {
  it.each(["1", "9.999999999", "9.9999999999"])(
    "rejects %s MINA below the minimum",
    (amount) => {
      const onSubmit = vi.fn();
      render(
        <TreasuryProposalCreationForm
          lifecycleId={0}
          connectedWalletAddress="wallet"
          initialTitle="Proposal"
          initialContent="Work"
          initialRecipient="recipient"
          initialAmount={amount}
          onSubmit={onSubmit}
        />,
      );
      expect(
        screen.getByText(
          "Requested amount must be at least 10 MINA. The minimum bond is 1 MINA.",
        ),
      ).toBeTruthy();
      expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe(
        "true",
      );
      acceptAcknowledgements();
      fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["10", "1 MINA"],
    ["10.000000009", "1 MINA"],
    ["10.00000001", "1.000000001 MINA"],
    ["10.1", "1.01 MINA"],
  ])("submits %s MINA and displays the exact bond", (amount, bond) => {
    const onSubmit = vi.fn();
    render(
      <TreasuryProposalCreationForm
        lifecycleId={0}
        connectedWalletAddress="wallet"
        initialTitle="Proposal"
        initialContent="Work"
        initialRecipient="recipient"
        initialAmount={amount}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(bond)).toBeTruthy();
    expect(screen.getByLabelText("Amount").getAttribute("min")).toBe("10");
    acceptAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount }));
  });

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
    const proposalAddressRow = proposalAddressLabel.parentElement
      ?.parentElement as HTMLElement;
    const initialProposalAddress =
      within(proposalAddressRow).getByText(/^B62/).textContent;
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
    expect(within(proposalAddressRow).getByText(/^B62/).textContent).not.toBe(
      initialProposalAddress,
    );
    expect((screen.getByLabelText("Amount") as HTMLInputElement).type).toBe(
      "number",
    );
    expect(
      document.querySelectorAll('[data-component="mina-amount-suffix"]'),
    ).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Governance office-hours expansion" },
    });
    expect(screen.getAllByText("Title").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Governance office-hours expansion").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Markdown heading")).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "96000" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: {
        value: "B62qrecipientAmbassador1111111111111111111111111111111111",
      },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    acceptAcknowledgements();
    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));

    expect(onSubmit).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress:
        "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      content:
        "# Governance office-hours expansion\n\n## Summary\n\nExpand recurring governance office hours.",
      amount: "96,000",
      recipient: "B62qrecipientAmbassador1111111111111111111111111111111111",
    });
  });

  it.each([
    { accepted: [] },
    { accepted: ["kyc"] },
    { accepted: ["terms"] },
  ] as const)(
    "blocks creation with $accepted accepted, including direct form submission",
    ({ accepted }) => {
      const onSubmit = vi.fn();
      const { container } = render(
        <TreasuryProposalCreationForm
          {...validProposalProps}
          onSubmit={onSubmit}
        />,
      );
      for (const key of accepted) {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: defaultProposalAcknowledgements[key].label,
          }),
        );
      }
      const submit = screen.getByRole("button", { name: "Create proposal" });
      expect(submit).toHaveProperty("disabled", true);
      fireEvent.click(submit);
      fireEvent.submit(container.querySelector("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("submits only proposal fields after both acknowledgements and resets acceptance", () => {
    const onSubmit = vi.fn();
    render(
      <TreasuryProposalCreationForm
        {...validProposalProps}
        onSubmit={onSubmit}
      />,
    );
    acceptAcknowledgements();
    const submit = screen.getByRole("button", { name: "Create proposal" });
    expect(submit).toHaveProperty("disabled", false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      lifecycleId: 12,
      proposerAddress: "wallet",
      content: "# Proposal\n\nWork",
      amount: "10",
      recipient: "recipient",
    });
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
    expect(submit).toHaveProperty("disabled", true);
  });

  it("opens and closes read-more dialogs without acceptance or submission", async () => {
    const onSubmit = vi.fn();
    render(
      <TreasuryProposalCreationForm
        {...validProposalProps}
        onSubmit={onSubmit}
      />,
    );
    for (const key of ["kyc", "terms"] as const) {
      const acknowledgement = defaultProposalAcknowledgements[key];
      fireEvent.click(
        screen.getByRole("button", {
          name: `Read more: ${acknowledgement.title}`,
        }),
      );
      const dialog = screen.getByRole("dialog", {
        name: acknowledgement.title,
      });
      expect(
        within(dialog).getByText(acknowledgement.sections[0]!.text),
      ).toBeTruthy();
      if (key === "kyc") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      } else {
        fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
        0,
      );
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it("uses configured checkbox copy, dialog copy, and links", () => {
    const config: ProposalAcknowledgementsConfig = {
      title: "Custom acknowledgements",
      description: "Custom description",
      readMoreLabel: "Details",
      closeLabel: "Dismiss",
      kyc: {
        label: "Custom KYC acceptance",
        title: "Custom KYC",
        sections: [
          {
            text: "Custom verification details",
            links: [{ label: "Verify", href: "https://example.com/verify" }],
          },
        ],
      },
      terms: {
        label: "Custom terms acceptance",
        title: "Custom terms",
        sections: [
          {
            title: "Custom privacy",
            text: "Custom privacy details",
            links: [{ label: "Policy", href: "https://example.com/policy" }],
          },
        ],
      },
    };
    render(
      <TreasuryProposalCreationForm
        {...validProposalProps}
        acknowledgementsConfig={config}
      />,
    );
    expect(screen.getByText(config.description)).toBeTruthy();
    for (const key of ["kyc", "terms"] as const) {
      expect(
        screen.getByRole("checkbox", { name: config[key].label }),
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: `Details: ${config[key].title}` }),
      );
      const dialog = screen.getByRole("dialog", { name: config[key].title });
      const section = config[key].sections[0]!;
      expect(within(dialog).getByText(section.text)).toBeTruthy();
      const link = within(dialog).getByRole("link", {
        name: section.links[0]!.label,
      });
      expect(link.getAttribute("href")).toBe(section.links[0]!.href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    }
  });

  it("resets acceptance when the wallet, lifecycle, or form instance changes", () => {
    const { rerender } = render(
      <TreasuryProposalCreationForm {...validProposalProps} />,
    );
    acceptAcknowledgements();
    rerender(
      <TreasuryProposalCreationForm
        {...validProposalProps}
        connectedWalletAddress="another-wallet"
      />,
    );
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
    acceptAcknowledgements();
    rerender(
      <TreasuryProposalCreationForm
        {...validProposalProps}
        connectedWalletAddress="another-wallet"
        lifecycleId={13}
      />,
    );
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
    acceptAcknowledgements();
    rerender(
      <TreasuryProposalCreationForm key="new-draft" {...validProposalProps} />,
    );
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
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

    const connectButton = screen.getByRole("button", {
      name: "Connect proposer wallet",
    });
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
    expect(
      screen.getByText("22.23% of eligible voting weight (80,029.74 MINA)"),
    ).toBeTruthy();
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

    expect(
      screen.getByText("24.05% of eligible voting weight (63,683.06 MINA)"),
    ).toBeTruthy();
    expect(screen.getByText("52.38% yay over nay")).toBeTruthy();
  });

  it("re-hydrates the amount field when draft-backed initial values arrive after mount", () => {
    const { rerender } = render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
      />,
    );

    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe(
      "",
    );

    rerender(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
        initialAmount="96,000"
      />,
    );

    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe(
      "96000",
    );
  });

  it("starts the content editor with a generic proposal template", () => {
    render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi"
      />,
    );

    const contentInput = screen.getByLabelText(
      "Content",
    ) as HTMLTextAreaElement;
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
      expect(
        screen.queryByRole("heading", { name: "Preview title" }),
      ).toBeNull();
    });
  });

  it("suppresses images in the Markdown preview and preserves the draft", async () => {
    const content = [
      "![Inline description](https://tracker.example/inline.png)",
      "![Reference description][image]",
      "![](https://tracker.example/pixel.png)",
      '<img src="https://tracker.example/raw.png">',
      "[image]: https://tracker.example/reference.png",
    ].join("\n\n");
    const { container } = render(
      <TreasuryProposalCreationForm
        lifecycleId={12}
        connectedWalletAddress="wallet"
        initialContent={content}
      />,
    );
    expect(
      (screen.getByLabelText("Content") as HTMLTextAreaElement).value,
    ).toBe(content);
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    fireEvent.mouseDown(previewTab);
    fireEvent.click(previewTab);

    await waitFor(() => {
      expect(screen.getByText("Inline description")).toBeTruthy();
      expect(screen.getByText("Reference description")).toBeTruthy();
    });
    expect(container.querySelector("img")).toBeNull();
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
    expect(
      screen.getByRole("button", { name: "Create proposal" }),
    ).toBeTruthy();
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
      target: {
        value: "B62qrecipientAmbassador1111111111111111111111111111111111",
      },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    const draftButtons = screen.getAllByRole("button", {
      name: "Save as draft",
    });
    expect(draftButtons).toHaveLength(1);
    expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(2);

    fireEvent.click(draftButtons[0] as HTMLButtonElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaveDraft).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress:
        "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
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

    expect(screen.getByText("Proposal submissions are not open")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByText(
        "The current lifecycle (Lifecycle 12) is currently in the cooldown period. You can save this proposal as a draft and submit it once the proposal period begins.",
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Governance office-hours expansion" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "96000" },
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: {
        value: "B62qrecipientAmbassador1111111111111111111111111111111111",
      },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: {
        value: "## Summary\n\nExpand recurring governance office hours.",
      },
    });

    expect(screen.getByRole("button", { name: "Save as draft" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Save as draft" }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaveDraft).toHaveBeenCalledWith({
      lifecycleId: 12,
      proposerAddress:
        "B62qkEdNmGbUVaUnVtwMeMo9G1QBgfp9c3K7j4FbmXn21zG8ssvaPvi",
      content:
        "# Governance office-hours expansion\n\n## Summary\n\nExpand recurring governance office hours.",
      amount: "96,000",
      recipient: "B62qrecipientAmbassador1111111111111111111111111111111111",
    });
  });
});
