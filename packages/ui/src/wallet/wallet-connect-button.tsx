import { ChevronDown } from "lucide-react";
import { forwardRef, type JSX, useState } from "react";
import { Button, type ButtonProps } from "../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { useTreasuryIntl } from "../i18n";
import {
  resolveWalletConnectMessages,
  type WalletAccountInfo,
  type WalletDetail,
  type WalletConnectionStatus,
  type WalletConnectMessages,
} from "./wallet-types";

const WALLET_BUTTON_MIN_WIDTH_CLASS = "min-w-[13rem]";

export interface WalletConnectButtonProps {
  loading?: boolean;
  status: WalletConnectionStatus;
  address?: string | null;
  accountInfo?: WalletAccountInfo;
  details?: WalletDetail[];
  accountInfoLoading?: boolean;
  showAccountDropdown?: boolean;
  className?: string;
  disabled?: boolean;
  isWalletAvailable?: boolean;
  onClick?: () => void;
  onInstallClick?: () => void;
  onDisconnectClick?: () => void;
  messages?: Partial<WalletConnectMessages>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}

function shortenAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function isLikelyAddress(value: string | null | undefined): value is string {
  return Boolean(value && value.trim().length >= 20);
}

function resolveDisplayValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}

function resolveButtonLabel(
  input: Pick<WalletConnectButtonProps, "loading" | "status" | "address" | "isWalletAvailable"> & {
    resolvedMessages: WalletConnectMessages;
  },
): string {
  const { resolvedMessages } = input;

  if (input.address && input.loading) {
    return shortenAddress(input.address);
  }

  if (input.loading) {
    return resolvedMessages.loading;
  }

  if (input.isWalletAvailable === false) {
    return resolvedMessages.install;
  }

  if (input.status === "connecting") {
    return resolvedMessages.connecting;
  }

  if (input.status === "connected") {
    if (input.address) {
      return shortenAddress(input.address);
    }
    return resolvedMessages.connected;
  }

  return resolvedMessages.connect;
}

export const WalletConnectButton = forwardRef<
  HTMLButtonElement,
  WalletConnectButtonProps
>(function WalletConnectButton(
  {
    loading = false,
    status,
    address,
    accountInfo,
    details = [],
    accountInfoLoading = false,
    showAccountDropdown = true,
    className,
    disabled,
    isWalletAvailable = true,
    onClick,
    onInstallClick,
    onDisconnectClick,
    messages,
    variant,
    size = "sm",
  },
  ref,
): JSX.Element {
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);
  const intl = useTreasuryIntl();
  const resolvedMessages = resolveWalletConnectMessages(intl, messages);

  const baseLabel = resolveButtonLabel({
    loading,
    status,
    address,
    isWalletAvailable,
    resolvedMessages,
  });
  const showDisconnectLabel =
    !loading && status === "connected" && isHoveredOrFocused && isWalletAvailable !== false;
  const label = showDisconnectLabel ? resolvedMessages.disconnect : baseLabel;

  const resolvedVariant: ButtonProps["variant"] =
    variant ??
    (isWalletAvailable === false ? "outline" : "outline");
  const resolvedClickHandler =
    isWalletAvailable === false
      ? (onInstallClick ?? onClick)
      : status === "connected"
        ? (onDisconnectClick ?? onClick)
        : onClick;
  const showWalletAccountDropdown =
    showAccountDropdown &&
    isWalletAvailable !== false &&
    status === "connected" &&
    (accountInfoLoading ||
      Boolean(
        address ||
          details.length > 0 ||
          accountInfo?.minaBalance ||
          accountInfo?.votingWeight ||
          accountInfo?.delegatedTo ||
          accountInfo?.delegatedVotingWeight,
      ));
  const currentLifecycleVotingWeight =
    accountInfo?.votingWeight ?? accountInfo?.delegatedVotingWeight;

  const mainButton = (
    <Button
      ref={ref}
      variant={resolvedVariant}
      size={size}
      className={cn(
        WALLET_BUTTON_MIN_WIDTH_CLASS,
        "justify-center border-border/80 px-4 shadow-none transition-[width,border-radius,border-color,background-color,color] duration-200 ease-out",
        showWalletAccountDropdown
          ? "min-w-0 w-auto flex-1 rounded-r-none border-r-0"
          : "w-full rounded-sm",
        resolvedVariant === "outline" &&
          "bg-background/95 text-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={resolvedClickHandler}
      aria-busy={loading || status === "connecting"}
      data-wallet-status={status}
      data-wallet-available={isWalletAvailable ? "yes" : "no"}
      disabled={Boolean(disabled) || loading || status === "connecting"}
      onMouseEnter={() => setIsHoveredOrFocused(true)}
      onMouseLeave={() => setIsHoveredOrFocused(false)}
      onFocus={() => setIsHoveredOrFocused(true)}
      onBlur={() => setIsHoveredOrFocused(false)}
    >
      <span className="block truncate">{label}</span>
    </Button>
  );

  return (
    <div
      className={cn("inline-flex items-stretch", WALLET_BUTTON_MIN_WIDTH_CLASS, className)}
      data-component="wallet-connect-control"
    >
      {mainButton}
      <Popover open={accountDetailsOpen} onOpenChange={setAccountDetailsOpen}>
        <div
          className={cn(
            "overflow-hidden transition-[width,opacity,transform] duration-200 ease-out",
            showWalletAccountDropdown ? "w-10 opacity-100 translate-x-0" : "w-0 opacity-0 translate-x-1",
          )}
          aria-hidden={showWalletAccountDropdown ? undefined : "true"}
          data-component="wallet-account-trigger-shell"
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={resolvedVariant}
              size={size}
              className={cn(
                "w-10 shrink-0 rounded-l-none rounded-r-sm border-border/80 px-2.5 shadow-none transition-[border-color,background-color,color] duration-200 ease-out",
                resolvedVariant === "outline" &&
                  "bg-background/95 text-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-label={intl.formatMessage({
                id: "ui.wallet.account.toggle",
                defaultMessage: "Open wallet account details",
              })}
              data-component="wallet-account-trigger"
              disabled={!showWalletAccountDropdown}
              tabIndex={showWalletAccountDropdown ? undefined : -1}
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="w-[min(34rem,calc(100vw-1.5rem))] rounded-xl border-border/80 p-0 sm:w-[34rem]"
        >
          <div className="space-y-4 p-4">
            {accountInfoLoading ? (
              <div
                className="divide-y divide-border/60"
                data-component="wallet-account-loading"
              >
                <WalletAccountSection
                  title={intl.formatMessage({
                    id: "ui.wallet.account.latestSection",
                    defaultMessage: "Wallet",
                  })}
                >
                  <dl className="grid gap-4">
                    <WalletAccountMetricSkeleton
                      label={intl.formatMessage({
                        id: "ui.wallet.account.currentMinaBalance",
                        defaultMessage: "Wallet balance",
                      })}
                    />
                  </dl>
                  <div className="grid gap-4" data-component="wallet-address-row">
                    <AddressDetailSkeleton
                      label={intl.formatMessage({
                        id: "ui.wallet.account.currentAddress",
                        defaultMessage: "Wallet address",
                      })}
                    />
                  </div>
                </WalletAccountSection>
                <WalletAccountSection
                  title={intl.formatMessage({
                    id: "ui.wallet.account.currentLifecycleSection",
                    defaultMessage: "Current lifecycle",
                  })}
                >
                  <dl className="grid gap-4">
                    <WalletAccountMetricSkeleton
                      label={intl.formatMessage({
                        id: "ui.wallet.account.votingWeight",
                        defaultMessage: "Voting weight",
                      })}
                    />
                  </dl>
                  <div className="grid gap-4" data-component="wallet-address-row">
                    <AddressDetailSkeleton
                      label={intl.formatMessage({
                        id: "ui.wallet.account.historicalDelegation",
                        defaultMessage: "Voting delegation",
                      })}
                    />
                  </div>
                </WalletAccountSection>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                <WalletAccountSection
                  title={intl.formatMessage({
                    id: "ui.wallet.account.latestSection",
                    defaultMessage: "Wallet",
                  })}
                >
                  <dl className="grid gap-4">
                    <WalletAccountMetricField
                      label={intl.formatMessage({
                        id: "ui.wallet.account.currentMinaBalance",
                        defaultMessage: "Wallet balance",
                      })}
                      value={resolveDisplayValue(accountInfo?.minaBalance)}
                    />
                  </dl>
                  <div className="grid gap-4" data-component="wallet-address-row">
                    <AddressDetailField
                      label={intl.formatMessage({
                        id: "ui.wallet.account.currentAddress",
                        defaultMessage: "Wallet address",
                      })}
                      value={resolveDisplayValue(address)}
                    />
                    {details.map((detail) => (
                      <AddressDetailField
                        key={detail.label}
                        label={detail.label}
                        value={resolveDisplayValue(detail.value)}
                      />
                    ))}
                  </div>
                </WalletAccountSection>
                <WalletAccountSection
                  title={intl.formatMessage({
                    id: "ui.wallet.account.currentLifecycleSection",
                    defaultMessage: "Current lifecycle",
                  })}
                >
                  <dl className="grid gap-4">
                    <WalletAccountMetricField
                      label={intl.formatMessage({
                        id: "ui.wallet.account.votingWeight",
                        defaultMessage: "Voting weight",
                      })}
                      value={resolveDisplayValue(currentLifecycleVotingWeight)}
                    />
                  </dl>
                  <div className="grid gap-4" data-component="wallet-address-row">
                    <AddressDetailField
                      label={intl.formatMessage({
                        id: "ui.wallet.account.historicalDelegation",
                        defaultMessage: "Voting delegation",
                      })}
                      value={resolveDisplayValue(accountInfo?.delegatedTo)}
                    />
                  </div>
                </WalletAccountSection>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});

function WalletAccountSection({
  title,
  children,
}: {
  title: string;
  children: JSX.Element | null | Array<JSX.Element | null>;
}): JSX.Element {
  return (
    <section className="space-y-3 py-3 first:pt-0 last:pb-0" data-component="wallet-account-section">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {title}
      </p>
      {children}
    </section>
  );
}

function WalletAccountMetricField({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function WalletAccountMetricSkeleton({
  label,
}: {
  label: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Skeleton className="h-5 w-28" />
    </div>
  );
}

function AddressDetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="space-y-2" data-component="wallet-address-field">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono font-medium leading-relaxed text-foreground",
          isLikelyAddress(value) ? "break-all text-xs" : "truncate text-sm",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function AddressDetailSkeleton({
  label,
}: {
  label: string;
}): JSX.Element {
  return (
    <div className="space-y-2" data-component="wallet-address-field">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Skeleton className="h-5 w-40" />
    </div>
  );
}
