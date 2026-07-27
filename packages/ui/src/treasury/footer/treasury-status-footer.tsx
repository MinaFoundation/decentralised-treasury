import { type JSX } from "react";
import { cn } from "../../lib/utils";
import { useTreasuryIntl } from "../../i18n";
import {
  type TreasuryNetworkOption,
  resolveTreasuryNetworkLabel,
  resolveTreasuryNetworkOptions,
} from "../network/treasury-network-config";

export type TreasuryHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface TreasuryNetworkHealthSnapshot {
  apiStatus?: TreasuryHealthStatus;
  indexerStatus?: TreasuryHealthStatus;
  latestLiveSlot?: number | string | null;
  latestLiveBlock?: number | string | null;
  latestIndexedSlot?: number | string | null;
  latestIndexedBlock?: number | string | null;
  slotLag?: number | string | null;
  updatedAt?: string | null;
}

export interface TreasuryStatusFooterProps {
  networkId?: string | null;
  networkLabel?: string;
  networkOptions?: TreasuryNetworkOption[];
  networkConfigRaw?: string | null;
  buildSha?: string | null;
  health?: TreasuryNetworkHealthSnapshot;
  className?: string;
}

interface FooterMetric {
  label: string;
  value: string;
  tone?: TreasuryHealthStatus;
}

function formatMetric(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return `${value}`;
}

function formatBuildSha(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "unknown") {
    return "-";
  }
  return normalized.slice(0, 12);
}

function resolveStatusToneClass(
  status: TreasuryHealthStatus | undefined,
): string {
  if (status === "healthy") {
    return "text-emerald-700";
  }
  if (status === "degraded") {
    return "text-amber-700";
  }
  if (status === "down") {
    return "text-destructive";
  }
  return "text-muted-foreground";
}

function formatHealthStatus(
  intl: ReturnType<typeof useTreasuryIntl>,
  status: TreasuryHealthStatus | undefined,
): string {
  const resolved = status ?? "unknown";
  if (resolved === "healthy") {
    return intl.formatMessage({
      id: "ui.footer.health.healthy",
      defaultMessage: "Healthy",
    });
  }
  if (resolved === "degraded") {
    return intl.formatMessage({
      id: "ui.footer.health.degraded",
      defaultMessage: "Degraded",
    });
  }
  if (resolved === "down") {
    return intl.formatMessage({
      id: "ui.footer.health.down",
      defaultMessage: "Down",
    });
  }
  return intl.formatMessage({
    id: "ui.footer.health.unknown",
    defaultMessage: "Unknown",
  });
}

export function TreasuryStatusFooter({
  networkId,
  networkLabel,
  networkOptions,
  networkConfigRaw,
  buildSha,
  health,
  className,
}: TreasuryStatusFooterProps): JSX.Element {
  const intl = useTreasuryIntl();
  const resolvedNetworkOptions = resolveTreasuryNetworkOptions({
    networkOptions,
    networkConfigRaw,
  });
  const resolvedNetworkLabel =
    networkLabel ??
    resolveTreasuryNetworkLabel(networkId, resolvedNetworkOptions) ??
    intl.formatMessage({
      id: "ui.footer.network.unknown",
      defaultMessage: "Unknown",
    });

  const metrics: FooterMetric[] = [
    {
      label: intl.formatMessage({
        id: "ui.footer.network",
        defaultMessage: "Network",
      }),
      value: resolvedNetworkLabel,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.apiHealth",
        defaultMessage: "API",
      }),
      value: formatHealthStatus(intl, health?.apiStatus),
      tone: health?.apiStatus,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.indexerHealth",
        defaultMessage: "Indexer",
      }),
      value: formatHealthStatus(intl, health?.indexerStatus),
      tone: health?.indexerStatus,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.liveSlot",
        defaultMessage: "Chain",
      }),
      value: formatMetric(health?.latestLiveSlot),
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.indexedSlot",
        defaultMessage: "Indexed",
      }),
      value: formatMetric(health?.latestIndexedSlot),
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.slotLag",
        defaultMessage: "Lag",
      }),
      value: formatMetric(health?.slotLag),
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.updatedAt",
        defaultMessage: "Updated",
      }),
      value: formatMetric(health?.updatedAt),
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.build",
        defaultMessage: "Build",
      }),
      value: formatBuildSha(buildSha),
    },
  ];

  return (
    <footer
      className={cn(
        "mx-auto w-full max-w-[92rem] border-t border-border/70 px-3 py-2 sm:px-5 lg:px-6",
        className,
      )}
      data-component="treasury-status-footer"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs">
        {metrics.map((metric) => (
          <p
            key={metric.label}
            className="flex items-center gap-1 text-muted-foreground"
          >
            <span className="tracking-tight">{metric.label}</span>
            <span className="text-border" aria-hidden="true">
              /
            </span>
            <span
              className={cn(
                "font-medium text-foreground",
                resolveStatusToneClass(metric.tone),
              )}
            >
              {metric.value}
            </span>
          </p>
        ))}
      </div>
    </footer>
  );
}
