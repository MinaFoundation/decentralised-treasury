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
  nodeBlockHeight?: number | null;
  nodeFresh?: boolean;
  archiveBlockHeight?: number | null;
  archiveFresh?: boolean;
  indexerBlockHeight?: number | null;
  indexerFresh?: boolean;
  processorRemainingEvents?: number | null;
  processorFresh?: boolean;
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

function formatBlockHeight(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `#${value}`;
}

function formatNodeProgress(
  height: number | null | undefined,
  fresh: boolean | undefined,
): Pick<FooterMetric, "value" | "tone"> {
  if (height === null || height === undefined) {
    return { value: "Unavailable", tone: "unknown" };
  }
  if (fresh === false) {
    return { value: `Stale · ${formatBlockHeight(height)}`, tone: "degraded" };
  }
  return { value: formatBlockHeight(height) };
}

function formatBlockProgress(
  height: number | null | undefined,
  referenceHeight: number | null | undefined,
  fresh: boolean | undefined,
  referenceFresh: boolean | undefined,
): Pick<FooterMetric, "value" | "tone"> {
  if (height === null || height === undefined) {
    return { value: "Unavailable", tone: "unknown" };
  }
  if (fresh === false) {
    return { value: `Stale · ${formatBlockHeight(height)}`, tone: "degraded" };
  }
  if (
    referenceHeight === null ||
    referenceHeight === undefined ||
    referenceFresh === false
  ) {
    return { value: formatBlockHeight(height) };
  }
  const blocksBehind = Math.max(0, referenceHeight - height);
  if (blocksBehind === 0) {
    return {
      value: `Up to date · ${formatBlockHeight(height)}`,
      tone: "healthy",
    };
  }
  return {
    value: `Behind by ${blocksBehind} · ${formatBlockHeight(height)}`,
    tone: "degraded",
  };
}

function formatProcessorProgress(
  remainingEvents: number | null | undefined,
  fresh: boolean | undefined,
): Pick<FooterMetric, "value" | "tone"> {
  if (remainingEvents === null || remainingEvents === undefined) {
    return { value: "Unavailable", tone: "unknown" };
  }
  if (fresh === false) {
    return {
      value:
        remainingEvents === 0
          ? "Stale · previously up to date"
          : `Stale · ${remainingEvents} events pending`,
      tone: "degraded",
    };
  }
  if (remainingEvents === 0) {
    return { value: "Up to date", tone: "healthy" };
  }
  return {
    value: `${remainingEvents} events pending`,
    tone: "degraded",
  };
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
  const nodeProgress = formatNodeProgress(
    health?.nodeBlockHeight,
    health?.nodeFresh,
  );
  const archiveProgress = formatBlockProgress(
    health?.archiveBlockHeight,
    health?.nodeBlockHeight,
    health?.archiveFresh,
    health?.nodeFresh,
  );
  const indexerProgress = formatBlockProgress(
    health?.indexerBlockHeight,
    health?.archiveBlockHeight,
    health?.indexerFresh,
    health?.archiveFresh,
  );
  const processorProgress = formatProcessorProgress(
    health?.processorRemainingEvents,
    health?.processorFresh,
  );

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
        id: "ui.footer.node",
        defaultMessage: "Node",
      }),
      ...nodeProgress,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.archive",
        defaultMessage: "Archive",
      }),
      ...archiveProgress,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.indexer",
        defaultMessage: "Indexer",
      }),
      ...indexerProgress,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.processor",
        defaultMessage: "Processor",
      }),
      ...processorProgress,
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.build",
        defaultMessage: "Build",
      }),
      value: formatBuildSha(buildSha),
    },
    {
      label: intl.formatMessage({
        id: "ui.footer.updatedAt",
        defaultMessage: "Updated",
      }),
      value: formatMetric(health?.updatedAt),
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
