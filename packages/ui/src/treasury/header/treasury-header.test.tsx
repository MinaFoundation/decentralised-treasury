import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type JSX, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryIntlProvider } from "../../i18n";
import type { TreasuryProposalTableEntry } from "../proposals/proposals-table";
import { TreasuryHeader, TreasuryWalletHeader } from "./treasury-header";

const sampleProposals: TreasuryProposalTableEntry[] = [
  {
    id: "p1",
    title: "Alpha fund",
    proposalAddress: "B62qalpha111111111111111111111111111111111111111111111",
    proposer: "B62abc",
    requestedAmount: "100 MINA",
    stage: "Voting",
    period: "Voting",
    createdAt: "2026-04-01",
  },
  {
    id: "p2",
    title: "Beta upgrade",
    proposalAddress: "B62qbeta2222222222222222222222222222222222222222222222",
    proposer: "B62def",
    requestedAmount: "50 MINA",
    stage: "Exploration",
    period: "Exploration",
    createdAt: "2026-04-02",
  },
];

function HeaderWithProposalSearch(
  props: {
    loading?: boolean;
    initialQuery?: string;
  } = {},
): JSX.Element {
  const { loading = false, initialQuery = "" } = props;
  const [query, setQuery] = useState(initialQuery);
  const q = query.trim().toLowerCase();
  const results = sampleProposals.filter(
    (p) =>
      q.length === 0 ||
      p.title.toLowerCase().includes(q) ||
      p.proposer.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q),
  );

  return (
    <TreasuryHeader
      proposalSearch={{
        query,
        onQueryChange: setQuery,
        results,
        loading,
      }}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("TreasuryHeader", () => {
  it("renders english default title", () => {
    render(<TreasuryHeader />);

    const heading = screen.getByRole("heading", {
      name: "Mina Decentralized Treasury",
    });
    expect(heading).toBeTruthy();
    expect(screen.getByRole("img", { name: "Mina Treasury" })).toBeTruthy();
  });

  it("renders default navigation items", () => {
    render(<TreasuryHeader />);

    expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Proposals" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "My Wallet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("supports disabling logo", () => {
    render(<TreasuryHeader showLogo={false} />);
    expect(screen.queryByRole("img", { name: "Mina Treasury" })).toBeNull();
  });

  it("supports changing the active navigation item", () => {
    render(<TreasuryHeader activeNavigationItemId="proposals" />);

    expect(screen.getByRole("button", { name: "Proposals" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders a subtitle below the title when provided", () => {
    render(<TreasuryHeader subtitle="Treasury balance 12.4M MINA" />);

    expect(screen.getByText("Treasury balance 12.4M MINA")).toBeTruthy();
  });

  it("activates the floating sticky card only after scrolling past the threshold", () => {
    Object.defineProperty(window, "scrollY", {
      value: 0,
      writable: true,
      configurable: true,
    });

    const { container } = render(<TreasuryHeader stickyCardScrollOffset={24} />);
    const header = container.querySelector('[data-component="treasury-header"]');

    expect(header?.getAttribute("data-sticky-card-active")).toBe("false");

    window.scrollY = 48;
    fireEvent.scroll(window);

    expect(header?.getAttribute("data-sticky-card-active")).toBe("true");
  });

  it("shows proposal search by default", () => {
    render(<TreasuryHeader />);
    expect(screen.getByRole("button", { name: /Find proposals/i })).toBeTruthy();
  });

  it("renders a paused treasury banner when the contract is paused", () => {
    const { container } = render(<TreasuryHeader treasuryPaused />);
    const header = container.querySelector('[data-component="treasury-header"]');
    const banner = container.querySelector('[data-component="treasury-paused-banner"]');

    expect(
      screen.getByText("Treasury paused. Governance actions are temporarily unavailable."),
    ).toBeTruthy();
    expect(header?.firstElementChild).toBe(banner);
  });

  it("opens proposal search from navbar and lists results", async () => {
    render(<HeaderWithProposalSearch />);

    const trigger = screen.getByRole("button", { name: /Find proposals/i });
    expect(trigger.className.includes("border-border/70")).toBe(true);
    expect(trigger.className.includes("bg-muted/55")).toBe(true);
    expect(trigger.className.includes("sm:hover:w-[12.5rem]")).toBe(true);
    expect(trigger.textContent).toContain("Find proposals");

    fireEvent.click(trigger);
    expect(screen.getByRole("heading", { name: "Find proposals" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Alpha" },
    });
    expect(screen.getByText("Alpha fund")).toBeTruthy();
    expect(
      screen.getByText("B62qalpha111111111111111111111111111111111111111111111"),
    ).toBeTruthy();
    expect(screen.queryByText("B62abc")).toBeNull();
  });

  it("shows skeleton loading state in proposal search", () => {
    render(<HeaderWithProposalSearch loading />);
    fireEvent.click(screen.getByRole("button", { name: /Find proposals/i }));
    expect(
      document.querySelector('[data-component="proposal-search-loading"]'),
    ).toBeTruthy();
  });

  it("opens proposal search with Ctrl+K", () => {
    render(<HeaderWithProposalSearch />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "Find proposals" })).toBeTruthy();
  });

  it("renders primary navigation with a title divider", () => {
    const { container } = render(<TreasuryHeader />);
    expect(
      container.querySelector('[data-component="header-title-divider"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeTruthy();
  });

  it("renders children in action area", () => {
    render(
      <TreasuryHeader>
        <button type="button">Action</button>
      </TreasuryHeader>,
    );

    expect(screen.getByRole("button", { name: "Action" })).toBeTruthy();
  });

  it("opens the compact menu and triggers navigation actions", () => {
    const onProposalsClick = vi.fn();
    const { container } = render(
      <TreasuryHeader onProposalsClick={onProposalsClick}>
        <button type="button">Action</button>
      </TreasuryHeader>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const compactMenu = container.querySelector('[data-component="header-compact-menu"]');
    expect(compactMenu).toBeTruthy();

    fireEvent.click(within(compactMenu as HTMLElement).getByRole("button", { name: "Proposals" }));
    expect(onProposalsClick).toHaveBeenCalledTimes(1);
  });

  it("does not render network badge in header", () => {
    const { container } = render(<TreasuryHeader />);
    expect(
      container.querySelector('[data-component="network-badge"]'),
    ).toBeNull();
  });

  it("supports i18n messages object", () => {
    render(
      <TreasuryHeader messages={{ title: "Tesoreria Descentralizada Mina" }} />,
    );

    const heading = screen.getByRole("heading", {
      name: "Tesoreria Descentralizada Mina",
    });
    expect(heading).toBeTruthy();
  });

  it("uses react-intl provider messages for title", () => {
    render(
      <TreasuryIntlProvider
        messages={{ "ui.treasury.header.title": "Tesoreria Mina Intl" }}
      >
        <TreasuryHeader />
      </TreasuryIntlProvider>,
    );

    const heading = screen.getByRole("heading", {
      name: "Tesoreria Mina Intl",
    });
    expect(heading).toBeTruthy();
  });
});

describe("TreasuryWalletHeader", () => {
  it("renders primary create proposal action and handles click", () => {
    const onCreateProposalClick = vi.fn();

    render(<TreasuryWalletHeader onCreateProposalClick={onCreateProposalClick} />);

    const createProposalButton = screen.getByRole("button", {
      name: "New proposal",
    });
    expect(createProposalButton).toBeTruthy();

    fireEvent.click(createProposalButton);
    expect(onCreateProposalClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the create proposal button enabled by default", () => {
    render(<TreasuryWalletHeader />);
    const createProposalButton = screen.getByRole("button", {
      name: "New proposal",
    });
    expect(createProposalButton.hasAttribute("disabled")).toBe(false);
  });

  it("shows an empty state when no draft proposals exist", () => {
    render(<TreasuryWalletHeader draftProposals={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show draft proposals" }));

    expect(screen.getByText("Your draft proposals")).toBeTruthy();
    expect(screen.getByText("Start your first draft proposal")).toBeTruthy();
    expect(
      screen.getByText(
        "Saved drafts will appear here so you can reopen and continue them from the header at any time.",
      ),
    ).toBeTruthy();
  });

  it("lists draft proposals and opens the selected draft", () => {
    const onDraftProposalSelect = vi.fn();

    render(
      <TreasuryWalletHeader
        draftProposals={[
          {
            id: "D-134",
            title: "Governance office-hours expansion",
            lifecycleId: 12,
            updatedAt: "Updated 2h ago",
          },
        ]}
        onDraftProposalSelect={onDraftProposalSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show draft proposals" }));
    fireEvent.click(screen.getByRole("button", { name: /Governance office-hours expansion/i }));

    expect(onDraftProposalSelect).toHaveBeenCalledTimes(1);
    expect(onDraftProposalSelect).toHaveBeenCalledWith("D-134");
  });

  it("shows a hover trash action and confirms before deleting a draft", () => {
    const onDraftProposalDelete = vi.fn();
    const onDraftProposalSelect = vi.fn();

    render(
      <TreasuryWalletHeader
        draftProposals={[
          {
            id: "D-134",
            title: "Governance office-hours expansion",
            lifecycleId: 12,
            updatedAt: "Updated 2h ago",
          },
        ]}
        onDraftProposalSelect={onDraftProposalSelect}
        onDraftProposalDelete={onDraftProposalDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show draft proposals" }));

    const deleteButton = screen.getByRole("button", {
      name: "Delete draft Governance office-hours expansion",
    });
    expect(deleteButton.className.includes("opacity-0")).toBe(true);
    expect(deleteButton.className.includes("group-hover:opacity-100")).toBe(true);

    fireEvent.click(deleteButton);
    expect(screen.getByRole("heading", { name: "Delete draft proposal?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Delete draft$/i }));

    expect(onDraftProposalDelete).toHaveBeenCalledTimes(1);
    expect(onDraftProposalDelete).toHaveBeenCalledWith("D-134");
    expect(onDraftProposalSelect).not.toHaveBeenCalled();
  });

  it("renders connect wallet button in wallet header", () => {
    render(<TreasuryWalletHeader />);

    expect(screen.getByRole("button", { name: "Connect Auro" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install Auro" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders connecting wallet state in wallet header", () => {
    render(<TreasuryWalletHeader walletConnectStatus="connecting" />);
    const button = screen.getByRole("button", { name: "Connecting..." });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders initial loading wallet state in wallet header", () => {
    render(<TreasuryWalletHeader walletLoading />);
    const button = screen.getByRole("button", { name: "Checking Auro..." });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("data-auro-installed")).toBe("yes");
  });

  it("falls back to connect label for wallet error state in the header", () => {
    render(<TreasuryWalletHeader walletConnectStatus="error" />);
    expect(screen.getByRole("button", { name: "Connect Auro" })).toBeTruthy();
  });

  it("renders loading wallet account details in wallet header", () => {
    render(
      <TreasuryWalletHeader
        walletConnectStatus="connected"
        walletAddress="B62qwalletconnected1234567890abcdefghijklmnopqrstuvwxyz"
        walletAccountInfoLoading
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open wallet account details" }));
    expect(
      document.querySelector('[data-component="wallet-account-loading"]'),
    ).toBeTruthy();
  });

  it("renders loading treasury balance state in wallet header", () => {
    render(<TreasuryWalletHeader treasuryBalanceLoading />);

    expect(
      document.querySelector('[data-component="treasury-balance-loading"]'),
    ).toBeTruthy();
    expect(screen.getByLabelText("Loading treasury balance")).toBeTruthy();
  });

  it("renders failed treasury balance state in wallet header", () => {
    render(<TreasuryWalletHeader treasuryBalanceFailed />);

    expect(screen.getByLabelText("Treasury balance unavailable")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("supports a custom wallet button renderer", () => {
    render(
      <TreasuryWalletHeader
        renderWalletButton={({ isCompact }) => (
          <button type="button">{isCompact ? "Compact wallet" : "Custom wallet"}</button>
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "Custom wallet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Auro" })).toBeNull();
  });

  it("opens settings modal with api and mina node inputs", () => {
    render(
      <TreasuryWalletHeader
        defaultSettings={{
          networkId: "MAINNET",
          apiUrl: "https://api.treasury.local",
          minaNodeUrl: "https://berkeley.minascan.io/graphql",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("heading", { name: "Dashboard settings" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("API URL")).toBeTruthy();
    expect(screen.getByLabelText("Mina node URL")).toBeTruthy();
  });

  it("saves updated endpoint settings", () => {
    const onSettingsSave = vi.fn();
    render(
      <TreasuryWalletHeader
        defaultSettings={{
          networkId: "MAINNET",
          apiUrl: "https://api.old.local",
          minaNodeUrl: "https://node.old.local/graphql",
        }}
        onSettingsSave={onSettingsSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("API URL"), {
      target: { value: "https://api.new.local" },
    });
    fireEvent.change(screen.getByLabelText("Mina node URL"), {
      target: { value: "https://node.new.local/graphql" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onSettingsSave).toHaveBeenCalledTimes(1);
    expect(onSettingsSave).toHaveBeenCalledWith({
      networkId: "MAINNET",
      apiUrl: "https://api.new.local",
      minaNodeUrl: "https://node.new.local/graphql",
    });
  });

  it("disables saving when settings contain invalid urls", () => {
    render(
      <TreasuryWalletHeader
        defaultSettings={{
          networkId: "MAINNET",
          apiUrl: "https://api.old.local",
          minaNodeUrl: "https://node.old.local/graphql",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("API URL"), {
      target: { value: "api-without-protocol" },
    });

    const saveButton = screen.getByRole("button", { name: "Save settings" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Please enter a valid URL with http:// or https://."),
    ).toBeTruthy();
  });

  it("shows wallet controls on mobile by default", () => {
    const { container } = render(<TreasuryWalletHeader />);
    const walletControls = container.querySelector(
      '[data-component="wallet-controls"]',
    );

    expect(walletControls).toBeTruthy();
    expect(walletControls?.className.includes("flex")).toBe(true);
    expect(walletControls?.className.includes("w-full")).toBe(true);
    expect(walletControls?.className.includes("hidden")).toBe(false);
  });

  it("supports hiding wallet controls on mobile", () => {
    const { container } = render(
      <TreasuryWalletHeader hideWalletControlsOnMobile />,
    );
    const walletControls = container.querySelector(
      '[data-component="wallet-controls"]',
    );

    expect(walletControls).toBeTruthy();
    expect(walletControls?.className.includes("hidden")).toBe(true);
    expect(walletControls?.className.includes("sm:flex")).toBe(true);
  });
});
