import { type JSX, type ReactNode, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Menu, SquarePen, Trash2, Wallet, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { formatMinaAmountWithSuffix } from "../../lib/mina";
import { cn } from "../../lib/utils";
import { useTreasuryIntl } from "../../i18n";
import { WalletConnectButton } from "../../wallet/wallet-connect-button";
import { TreasuryLogoIcon } from "../branding/treasury-logo-icon";
import type { TreasuryProposalTableEntry } from "../proposals/proposals-table";
import {
  TreasurySettingsDialog,
  type TreasuryEndpointSettings,
} from "./treasury-settings-dialog";
import {
  getDefaultProposalSearchShortcutLabel,
  TreasuryProposalSearchDialog,
  TreasuryProposalSearchTrigger,
} from "./treasury-proposal-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import {
  resolveTreasuryHeaderMessages,
  type WalletAccountInfo,
  type WalletDetail,
  type WalletConnectionStatus,
  type WalletConnectMessages,
  type TreasuryHeaderMessages,
} from "../../wallet/wallet-types";

export interface TreasuryHeaderProposalSearchConfig {
  query: string;
  onQueryChange: (query: string) => void;
  results: TreasuryProposalTableEntry[];
  loading?: boolean;
  onSelect?: (entry: TreasuryProposalTableEntry) => void;
  /** Override keyboard shortcut label shown in the navbar (defaults to ⌘K / Ctrl+K). */
  shortcutLabel?: string;
}

export interface TreasuryHeaderNavigationItem {
  id: string;
  label: string;
  href?: string;
  isActive?: boolean;
  onClick?: () => void;
}

export interface TreasuryHeaderRenderContext {
  isCompact: boolean;
}

export interface TreasuryHeaderSearchRenderContext extends TreasuryHeaderRenderContext {
  shortcutLabel: string;
}

const defaultProposalSearchConfig: TreasuryHeaderProposalSearchConfig = {
  query: "",
  onQueryChange: () => {},
  results: [],
};

function TreasuryHeaderNavItem({
  item,
  className,
}: {
  item: TreasuryHeaderNavigationItem;
  className?: string;
}): JSX.Element {
  const itemClassName = cn(
    "inline-flex items-center bg-transparent px-0 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    item.isActive
      ? "font-medium text-foreground/70"
      : "font-medium text-muted-foreground hover:text-foreground",
    className,
  );

  if (item.href) {
    return (
      <a
        href={item.href}
        aria-current={item.isActive ? "page" : undefined}
        className={itemClassName}
        onClick={item.onClick}
      >
        {item.label}
      </a>
    );
  }

  return (
    <button
      type="button"
      aria-current={item.isActive ? "page" : undefined}
      className={itemClassName}
      onClick={item.onClick}
    >
      {item.label}
    </button>
  );
}

export interface TreasuryHeaderProps {
  title?: string;
  subtitle?: ReactNode;
  showLogo?: boolean;
  logo?: ReactNode;
  logoClassName?: string;
  messages?: Partial<TreasuryHeaderMessages>;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  brandingClassName?: string;
  navigationClassName?: string;
  rightContentClassName?: string;
  showNavigation?: boolean;
  stickyCardScrollOffset?: number;
  activeNavigationItemId?: string;
  navigationItems?: TreasuryHeaderNavigationItem[];
  onDashboardClick?: () => void;
  onProposalsClick?: () => void;
  /** Header search is always rendered; pass a config to control results and query state. */
  proposalSearch?: TreasuryHeaderProposalSearchConfig;
  renderProposalSearch?: (context: TreasuryHeaderSearchRenderContext) => ReactNode;
  renderRightContent?: (context: TreasuryHeaderRenderContext) => ReactNode;
  treasuryPaused?: boolean;
  pausedBannerLabel?: string;
  children?: ReactNode;
}

export function TreasuryHeader({
  title,
  subtitle,
  showLogo = true,
  logo,
  logoClassName,
  messages,
  className,
  titleClassName,
  subtitleClassName,
  brandingClassName,
  navigationClassName,
  rightContentClassName,
  showNavigation = true,
  stickyCardScrollOffset = 24,
  activeNavigationItemId = "dashboard",
  navigationItems,
  onDashboardClick,
  onProposalsClick,
  proposalSearch,
  renderProposalSearch,
  renderRightContent,
  treasuryPaused = false,
  pausedBannerLabel,
  children,
}: TreasuryHeaderProps): JSX.Element {
  const [isStickyCardActive, setIsStickyCardActive] = useState(false);
  const [proposalSearchOpen, setProposalSearchOpen] = useState(false);
  const [isCompactMenuOpen, setIsCompactMenuOpen] = useState(false);
  const intl = useTreasuryIntl();
  const resolvedProposalSearch = proposalSearch ?? defaultProposalSearchConfig;
  const proposalSearchShortcutLabel =
    resolvedProposalSearch.shortcutLabel ?? getDefaultProposalSearchShortcutLabel();
  const resolvedMessages: TreasuryHeaderMessages =
    resolveTreasuryHeaderMessages(intl, messages);
  const resolvedPausedBannerLabel =
    pausedBannerLabel ??
    intl.formatMessage({
      id: "ui.header.pausedBanner",
      defaultMessage: "Treasury paused. Governance actions are temporarily unavailable.",
    });
  const resolvedNavigationItems: TreasuryHeaderNavigationItem[] = showNavigation
    ? (navigationItems ?? [
        {
          id: "dashboard",
          label: intl.formatMessage({
            id: "ui.header.navigation.dashboard",
            defaultMessage: "Dashboard",
          }),
          isActive: activeNavigationItemId === "dashboard",
          onClick: onDashboardClick,
        },
        {
          id: "proposals",
          label: intl.formatMessage({
            id: "ui.header.navigation.proposals",
            defaultMessage: "Proposals",
          }),
          isActive: activeNavigationItemId === "proposals",
          onClick: onProposalsClick,
        },
      ])
    : [];
  const hasSearchContent = true;
  const hasRightContent = Boolean(renderRightContent) || Boolean(children);
  const hasCompactMenuContent =
    resolvedNavigationItems.length > 0 || hasSearchContent || hasRightContent;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateStickyCardState = (): void => {
      setIsStickyCardActive(window.scrollY > stickyCardScrollOffset);
    };

    updateStickyCardState();
    window.addEventListener("scroll", updateStickyCardState, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateStickyCardState);
    };
  }, [stickyCardScrollOffset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setProposalSearchOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const compactMenuLabel = intl.formatMessage({
    id: isCompactMenuOpen ? "ui.header.menu.close" : "ui.header.menu.open",
    defaultMessage: isCompactMenuOpen ? "Close menu" : "Open menu",
  });

  return (
    <header
      className={cn(
        "sticky top-0 z-40 mx-auto flex w-full max-w-[92rem] flex-col gap-2 transition-[top] duration-300 ease-out",
        className,
      )}
      data-sticky-card-active={isStickyCardActive ? "true" : "false"}
      data-component="treasury-header"
    >
      {treasuryPaused ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          data-component="treasury-paused-banner"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span className="font-medium">{resolvedPausedBannerLabel}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-2.5 py-2 transition-[margin,padding,background-color,border-color,box-shadow,border-radius] duration-300 ease-out sm:gap-3 sm:py-3",
          isStickyCardActive ? "mt-3" : "mt-0",
          isStickyCardActive
            ? "mx-0 rounded-2xl border border-border/80 bg-background/85 px-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5 lg:px-6"
            : "-mx-3 rounded-none border border-transparent bg-background px-3 shadow-none sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6",
        )}
      >
        <div className="flex w-full items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 xl:flex-row xl:items-center xl:gap-7">
            <div
              className={cn(
                "flex min-w-0 items-center gap-2.5",
                brandingClassName,
              )}
            >
              {showLogo ? (
                <div className="shrink-0">
                  {logo ?? (
                    <TreasuryLogoIcon className={cn("h-12 w-12", logoClassName)} />
                  )}
                </div>
              ) : null}
              <div className="min-w-0 shrink-0">
                <h1
                  className={cn(
                    "truncate text-sm font-semibold tracking-tight sm:text-base md:text-lg",
                    titleClassName,
                  )}
                >
                  {title ?? resolvedMessages.title}
                </h1>
                {subtitle ? (
                  <div
                    className={cn(
                      "mt-px min-w-0 text-xs font-medium leading-tight text-muted-foreground sm:text-[13px]",
                      subtitleClassName,
                    )}
                  >
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>
            {!isCompactMenuOpen && (resolvedNavigationItems.length > 0 || hasSearchContent) ? (
              <div
                className="hidden h-12 w-px shrink-0 bg-gradient-to-b from-transparent via-border/80 to-transparent xl:block"
                data-component="header-title-divider"
                aria-hidden="true"
              />
            ) : null}

            {!isCompactMenuOpen && (resolvedNavigationItems.length > 0 || hasSearchContent) ? (
              <nav
                aria-label={intl.formatMessage({
                  id: "ui.header.navigation.label",
                  defaultMessage: "Primary navigation",
                })}
                className={cn(
                  "hidden min-w-0 flex-1 xl:flex xl:items-center",
                  navigationClassName,
                )}
                data-component="header-navigation"
              >
                {renderProposalSearch && resolvedNavigationItems.length > 0 ? (
                  <div className="flex w-full flex-1 items-center justify-between gap-4">
                    <div className="flex flex-1 flex-wrap items-center justify-start gap-4 sm:gap-5">
                      {resolvedNavigationItems.map((item) => (
                        <TreasuryHeaderNavItem key={item.id} item={item} />
                      ))}
                    </div>
                    <div className="flex shrink-0 justify-end">
                      {renderProposalSearch({
                        isCompact: false,
                        shortcutLabel: proposalSearchShortcutLabel,
                      })}
                    </div>
                  </div>
                ) : renderProposalSearch ? (
                  <div className="flex w-full flex-1 justify-end">
                    {renderProposalSearch({
                      isCompact: false,
                      shortcutLabel: proposalSearchShortcutLabel,
                    })}
                  </div>
                ) : resolvedNavigationItems.length > 0 ? (
                  <div className="flex w-full flex-1 items-center justify-between gap-4">
                    <div className="flex flex-1 flex-wrap items-center justify-start gap-4 sm:gap-5">
                      {resolvedNavigationItems.map((item) => (
                        <TreasuryHeaderNavItem key={item.id} item={item} />
                      ))}
                    </div>
                    <div className="flex shrink-0 justify-end">
                      <TreasuryProposalSearchTrigger
                        shortcutLabel={proposalSearchShortcutLabel}
                        onClick={() => {
                          setProposalSearchOpen(true);
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex w-full flex-1 justify-end">
                    <TreasuryProposalSearchTrigger
                      shortcutLabel={proposalSearchShortcutLabel}
                      onClick={() => {
                        setProposalSearchOpen(true);
                      }}
                    />
                  </div>
                )}
              </nav>
            ) : null}
          </div>
          {!isCompactMenuOpen && hasRightContent ? (
            <div
              className={cn(
                "hidden shrink-0 items-center justify-end gap-2.5 xl:flex",
                rightContentClassName,
              )}
            >
              {renderRightContent ? renderRightContent({ isCompact: false }) : children}
            </div>
          ) : null}
          {hasCompactMenuContent ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 self-center rounded-sm xl:hidden"
              aria-label={compactMenuLabel}
              aria-expanded={isCompactMenuOpen}
              onClick={() => setIsCompactMenuOpen((value) => !value)}
            >
              {isCompactMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          ) : null}
        </div>
        <TreasuryProposalSearchDialog
          open={proposalSearchOpen}
          onOpenChange={setProposalSearchOpen}
          query={resolvedProposalSearch.query}
          onQueryChange={resolvedProposalSearch.onQueryChange}
          results={resolvedProposalSearch.results}
          loading={resolvedProposalSearch.loading}
          onSelect={resolvedProposalSearch.onSelect}
        />
        {isCompactMenuOpen && hasCompactMenuContent ? (
          <div
            className="space-y-3 rounded-xl border border-border/70 bg-background/95 p-3 xl:hidden"
            data-component="header-compact-menu"
          >
            {resolvedNavigationItems.length > 0 ? (
              <nav
                aria-label={intl.formatMessage({
                  id: "ui.header.navigation.label",
                  defaultMessage: "Primary navigation",
                })}
                className="space-y-1 text-center"
              >
                {resolvedNavigationItems.map((item) => (
                  <TreasuryHeaderNavItem
                    key={item.id}
                    item={{
                      ...item,
                      onClick: () => {
                        item.onClick?.();
                        setIsCompactMenuOpen(false);
                      },
                    }}
                    className="flex w-full justify-center rounded-sm px-2 py-2 text-center"
                  />
                ))}
              </nav>
            ) : null}
            {renderProposalSearch ? (
              <div className="pt-1">
                {renderProposalSearch({
                  isCompact: true,
                  shortcutLabel: proposalSearchShortcutLabel,
                })}
              </div>
            ) : (
              <div className="pt-1">
                <TreasuryProposalSearchTrigger
                  className="w-full justify-between"
                  shortcutLabel={proposalSearchShortcutLabel}
                  onClick={() => {
                    setProposalSearchOpen(true);
                    setIsCompactMenuOpen(false);
                  }}
                />
              </div>
            )}
            {hasRightContent ? (
              <div
                className={cn(
                  "flex justify-center border-t border-border/60 pt-3",
                  rightContentClassName,
                )}
              >
                {renderRightContent ? renderRightContent({ isCompact: true }) : children}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export interface TreasuryWalletHeaderProps extends TreasuryHeaderProps {
  draftProposals?: TreasuryWalletHeaderDraftProposal[];
  createProposalLabel?: string;
  createProposalButtonClassName?: string;
  renderWalletButton?: (context: TreasuryHeaderRenderContext) => ReactNode;
  treasuryBalance?: string | bigint;
  treasuryBalanceLoading?: boolean;
  treasuryBalanceFailed?: boolean;
  walletLoading?: boolean;
  walletConnectStatus?: WalletConnectionStatus;
  walletAddress?: string | null;
  walletAccountInfo?: WalletAccountInfo;
  walletDetails?: WalletDetail[];
  walletAccountInfoLoading?: boolean;
  walletConnectButtonClassName?: string;
  isWalletAvailable?: boolean;
  settingsButtonClassName?: string;
  walletContainerClassName?: string;
  hideWalletControlsOnMobile?: boolean;
  onCreateProposalClick?: () => void;
  onDraftProposalSelect?: (draftId: string) => void;
  onDraftProposalDelete?: (draftId: string) => void;
  onConnectWalletClick?: () => void;
  onInstallWalletClick?: () => void;
  onDisconnectWalletClick?: () => void;
  settings?: TreasuryEndpointSettings;
  defaultSettings?: TreasuryEndpointSettings;
  settingsTriggerLabel?: string;
  onSettingsChange?: (value: TreasuryEndpointSettings) => void;
  onSettingsSave?: (value: TreasuryEndpointSettings) => void;
  walletConnectMessages?: Partial<WalletConnectMessages>;
}

export interface TreasuryWalletHeaderDraftProposal {
  id: string;
  title: string;
  lifecycleId?: number | null;
  updatedAt?: string;
}

export function TreasuryWalletHeader({
  draftProposals = [],
  createProposalLabel,
  createProposalButtonClassName,
  renderWalletButton,
  treasuryBalance,
  treasuryBalanceLoading = false,
  treasuryBalanceFailed = false,
  walletLoading = false,
  walletConnectStatus = "disconnected",
  walletAddress,
  walletAccountInfo,
  walletDetails,
  walletAccountInfoLoading = false,
  walletConnectButtonClassName,
  isWalletAvailable = true,
  settingsButtonClassName,
  walletContainerClassName,
  hideWalletControlsOnMobile = false,
  onCreateProposalClick,
  onDraftProposalSelect,
  onDraftProposalDelete,
  onConnectWalletClick,
  onInstallWalletClick,
  onDisconnectWalletClick,
  settings,
  defaultSettings,
  settingsTriggerLabel,
  onSettingsChange,
  onSettingsSave,
  walletConnectMessages,
  ...headerProps
}: TreasuryWalletHeaderProps): JSX.Element {
  const intl = useTreasuryIntl();
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftPendingDelete, setDraftPendingDelete] = useState<TreasuryWalletHeaderDraftProposal | null>(
    null,
  );
  const resolvedCreateProposalLabel =
    createProposalLabel ??
    intl.formatMessage({
      id: "ui.header.createProposal",
      defaultMessage: "New proposal",
    });
  const draftMenuLabel = intl.formatMessage({
    id: "ui.header.draftMenu",
    defaultMessage: "Your draft proposals",
  });
  const draftMenuEmptyState = intl.formatMessage({
    id: "ui.header.draftMenuEmpty",
    defaultMessage: "Start your first draft proposal",
  });
  const draftMenuEmptyStateDescription = intl.formatMessage({
    id: "ui.header.draftMenuEmptyDescription",
    defaultMessage:
      "Saved drafts will appear here so you can reopen and continue them from the header at any time.",
  });
  const draftMenuOpenLabel = intl.formatMessage({
    id: "ui.header.draftMenuOpen",
    defaultMessage: "Show draft proposals",
  });
  const untitledDraftLabel = intl.formatMessage({
    id: "ui.header.draftUntitled",
    defaultMessage: "Untitled draft proposal",
  });
  const draftDeleteDialogTitle = intl.formatMessage({
    id: "ui.header.draftDeleteDialog.title",
    defaultMessage: "Delete draft proposal?",
  });
  const draftDeleteDialogDescription = intl.formatMessage(
    {
      id: "ui.header.draftDeleteDialog.description",
      defaultMessage:
        "This will permanently remove \"{title}\" from saved drafts on this device. This action cannot be undone.",
    },
    { title: draftPendingDelete?.title ?? untitledDraftLabel },
  );
  const draftDeleteDialogCancelLabel = intl.formatMessage({
    id: "ui.header.draftDeleteDialog.cancel",
    defaultMessage: "Cancel",
  });
  const draftDeleteDialogConfirmLabel = intl.formatMessage({
    id: "ui.header.draftDeleteDialog.confirm",
    defaultMessage: "Delete draft",
  });
  const treasuryBalanceLoadingLabel = intl.formatMessage({
    id: "ui.header.treasuryBalance.loading",
    defaultMessage: "Loading treasury balance",
  });
  const treasuryBalanceUnavailableLabel = intl.formatMessage({
    id: "ui.header.treasuryBalance.unavailable",
    defaultMessage: "Treasury balance unavailable",
  });
  const resolvedSubtitle =
    headerProps.subtitle ??
    (treasuryBalanceLoading ? (
      <span
        className="inline-flex min-w-0 items-center gap-1 text-[11px] sm:text-xs"
        aria-label={treasuryBalanceLoadingLabel}
        data-component="treasury-balance-loading"
      >
        <Wallet className="h-3 w-3 shrink-0" strokeWidth={2.1} aria-hidden="true" />
        <Skeleton className="h-3 w-24 rounded-sm sm:w-28" aria-hidden="true" />
      </span>
    ) : treasuryBalanceFailed ? (
      <span
        className="inline-flex min-w-0 items-center gap-1 text-[11px] sm:text-xs"
        aria-label={treasuryBalanceUnavailableLabel}
      >
        <Wallet className="h-3 w-3 shrink-0" strokeWidth={2.1} aria-hidden="true" />
        <span className="truncate text-muted-foreground">-</span>
      </span>
    ) : treasuryBalance != null ? (
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] sm:text-xs">
        <Wallet className="h-3 w-3 shrink-0" strokeWidth={2.1} aria-hidden="true" />
        <span className="truncate">{formatMinaAmountWithSuffix(treasuryBalance)}</span>
      </span>
    ) : undefined);

  return (
    <TreasuryHeader
      {...headerProps}
      subtitle={resolvedSubtitle}
      renderRightContent={({ isCompact }) => (
        <div
          className={cn(
            hideWalletControlsOnMobile
              ? "hidden shrink-0 items-center gap-2 sm:flex"
              : "flex w-full shrink-0 flex-wrap items-center justify-center gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-start",
            walletContainerClassName,
          )}
          data-component="wallet-controls"
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 overflow-hidden rounded-sm sm:flex-none",
              createProposalButtonClassName,
            )}
          >
            <Button
              size="sm"
              onClick={onCreateProposalClick}
              className="min-w-0 flex-1 rounded-r-none px-3"
            >
              <SquarePen
                className="mr-1.5 h-4 w-4"
                strokeWidth={2.25}
                aria-hidden="true"
              />
              {resolvedCreateProposalLabel}
            </Button>
            <Popover open={draftsOpen} onOpenChange={setDraftsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="shrink-0 rounded-l-none border-l border-primary-foreground/15 px-2"
                  aria-label={draftMenuOpenLabel}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b border-border/70 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{draftMenuLabel}</p>
                </div>
                {draftProposals.length > 0 ? (
                  <div className="max-h-80 overflow-y-auto p-2">
                    {draftProposals.map((draft) => (
                      <div
                        key={draft.id}
                        className="group relative rounded-md transition-colors hover:bg-accent"
                      >
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 pr-10 text-left"
                          onClick={() => {
                            onDraftProposalSelect?.(draft.id);
                            setDraftsOpen(false);
                          }}
                        >
                          <span className="text-sm font-medium text-foreground">{draft.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {draft.lifecycleId != null
                              ? `Lifecycle ${draft.lifecycleId}`
                              : intl.formatMessage({
                                  id: "ui.header.draftUnknownLifecycle",
                                  defaultMessage: "Lifecycle pending",
                                })}
                            {draft.updatedAt ? ` · ${draft.updatedAt}` : ""}
                          </span>
                        </button>
                        {onDraftProposalDelete ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label={intl.formatMessage(
                              {
                                id: "ui.header.draftDeleteAria",
                                defaultMessage: "Delete draft {title}",
                              },
                              { title: draft.title },
                            )}
                            onClick={() => {
                              setDraftsOpen(false);
                              setDraftPendingDelete(draft);
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3">
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-5 text-center">
                      <p className="text-sm font-medium text-foreground">{draftMenuEmptyState}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {draftMenuEmptyStateDescription}
                      </p>
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {renderWalletButton ? (
            renderWalletButton({ isCompact })
          ) : (
            <WalletConnectButton
              status={walletConnectStatus}
              loading={walletLoading}
              address={walletAddress}
              accountInfo={walletAccountInfo}
              details={walletDetails}
              accountInfoLoading={walletAccountInfoLoading}
              isWalletAvailable={isWalletAvailable}
              onClick={onConnectWalletClick}
              onInstallClick={onInstallWalletClick}
              onDisconnectClick={onDisconnectWalletClick}
              messages={walletConnectMessages}
              className={cn("min-w-[13rem] flex-1 basis-[13rem]", walletConnectButtonClassName)}
            />
          )}

          <TreasurySettingsDialog
            value={settings}
            defaultValue={defaultSettings}
            triggerLabel={settingsTriggerLabel}
            iconOnly
            triggerClassName={cn("shrink-0", settingsButtonClassName)}
            onChange={onSettingsChange}
            onSave={onSettingsSave}
          />

          <Dialog
            open={draftPendingDelete !== null}
            onOpenChange={(open) => {
              if (!open) {
                setDraftPendingDelete(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{draftDeleteDialogTitle}</DialogTitle>
                <DialogDescription>{draftDeleteDialogDescription}</DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-2 flex-col-reverse sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDraftPendingDelete(null);
                  }}
                >
                  {draftDeleteDialogCancelLabel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (!draftPendingDelete) {
                      return;
                    }
                    onDraftProposalDelete?.(draftPendingDelete.id);
                    setDraftPendingDelete(null);
                  }}
                >
                  {draftDeleteDialogConfirmLabel}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    />
  );
}
