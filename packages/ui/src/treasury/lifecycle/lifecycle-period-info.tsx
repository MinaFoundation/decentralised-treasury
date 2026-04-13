import { type JSX, useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { IntlShape } from "react-intl";
import { useTreasuryIntl } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";

export type TreasuryLifecyclePeriodId =
  | "proposal"
  | "exploration"
  | "voting"
  | "cooldown";

export interface TreasuryLifecyclePeriodInfoProps {
  currentPeriod?: TreasuryLifecyclePeriodId;
  currentPeriodProgress?: number;
  currentSlot?: number | string | null;
  lifecycleId?: number | string;
  isHistoricalLifecycle?: boolean;
  lifecycleOptions?: Array<number | string>;
  onLifecycleChange?: (lifecycleId: number) => void;
  periodEndsIn?: string;
  periodMetadata?: TreasuryLifecyclePeriodMetadata[];
  className?: string;
  title?: string;
  description?: string;
  loading?: boolean;
}

interface LifecyclePeriodDefinition {
  id: TreasuryLifecyclePeriodId;
  emoji: string;
}

export interface TreasuryLifecyclePeriodMetadata {
  period: TreasuryLifecyclePeriodId;
  purpose?: string;
  slotRange?: string;
  /** ISO 8601 string, epoch ms, or Date — shown with locale-aware date/time */
  estimatedStart?: string | number | Date;
  /** ISO 8601 string, epoch ms, or Date — shown with locale-aware date/time */
  estimatedEnd?: string | number | Date;
}

const PERIODS: LifecyclePeriodDefinition[] = [
  { id: "proposal", emoji: "📝" },
  { id: "exploration", emoji: "🔎" },
  { id: "voting", emoji: "🗳️" },
  { id: "cooldown", emoji: "⏳" },
];

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function parseToDate(
  value: string | number | Date | undefined | null,
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Shorter dates for single-line slot + time summaries */
function formatCompactDateTime(
  intl: IntlShape,
  value: string | number | Date | undefined | null,
): string {
  const date = parseToDate(value);
  if (!date) {
    return "-";
  }
  return intl.formatDate(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface LifecycleTimingSummary {
  primary: string | null;
  secondary: string | null;
}

interface ParsedSlotRange {
  start: number;
  end: number;
}

interface LifecyclePeriodProgressSummary {
  percent: number;
  currentSlot: number | null;
}

function formatDateTimeRange(
  intl: IntlShape,
  estimatedStart: string | number | Date | undefined,
  estimatedEnd: string | number | Date | undefined,
): string | null {
  const start = formatCompactDateTime(intl, estimatedStart);
  const end = formatCompactDateTime(intl, estimatedEnd);
  const hasStart = start !== "-";
  const hasEnd = end !== "-";

  if (hasStart && hasEnd) {
    return `${start} - ${end}`;
  }
  if (hasStart) {
    return start;
  }
  if (hasEnd) {
    return end;
  }
  return null;
}

function parseSlotRange(slotRange: string | undefined): ParsedSlotRange | null {
  const trimmed = slotRange?.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return { start, end };
}

function parseNumericValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSlotRangeLabel(slotRange: string | undefined): string | null {
  const parsed = parseSlotRange(slotRange);
  if (!parsed) {
    const trimmed = slotRange?.trim();
    if (!trimmed) {
      return null;
    }
    return /\bslots?\b/i.test(trimmed) ? trimmed : `${trimmed} slots`;
  }
  return `#${parsed.start} - #${parsed.end} slots`;
}

function formatRemainingSlots(
  intl: IntlShape,
  slotRange: string | undefined,
  currentPeriodProgress: number,
  currentSlot: number | null,
): string | null {
  const parsed = parseSlotRange(slotRange);
  if (!parsed) {
    return null;
  }

  const totalSlots = Math.max(0, parsed.end - parsed.start + 1);
  const remainingSlots =
    currentSlot !== null
      ? Math.max(0, parsed.end - currentSlot)
      : Math.max(
          0,
          Math.ceil(
            totalSlots * ((100 - clampPercentage(currentPeriodProgress)) / 100),
          ),
        );

  return intl.formatMessage(
    {
      id: "ui.lifecycle.remainingSlots",
      defaultMessage:
        "#{count, number} {count, plural, one {slot} other {slots}}",
    },
    { count: remainingSlots },
  );
}

function resolveLifecycleProgressSummary(
  periodId: TreasuryLifecyclePeriodId,
  isHistoricalLifecycle: boolean,
  currentPeriod: TreasuryLifecyclePeriodId,
  currentPeriodIndex: number,
  currentPeriodProgress: number,
  slotRange: string | undefined,
  currentSlot: number | null,
): LifecyclePeriodProgressSummary {
  if (isHistoricalLifecycle) {
    return { percent: 100, currentSlot };
  }

  const periodIndex = PERIODS.findIndex((period) => period.id === periodId);
  if (periodIndex < currentPeriodIndex) {
    return { percent: 100, currentSlot };
  }
  if (periodId === currentPeriod) {
    return { percent: clampPercentage(currentPeriodProgress), currentSlot };
  }
  return { percent: 0, currentSlot };
}

function formatStaticCountdownToDate(
  intl: IntlShape,
  target: string | number | Date | undefined,
): string | null {
  const targetDate = parseToDate(target);
  if (!targetDate) {
    return null;
  }

  const remainingMs = Math.max(0, targetDate.getTime() - Date.now());
  const totalMinutes = Math.floor(remainingMs / 60000);
  if (totalMinutes <= 0) {
    return intl.formatMessage({
      id: "ui.lifecycle.imminent",
      defaultMessage: "In a few moments",
    });
  }
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return intl.formatMessage(
    {
      id: "ui.lifecycle.staticCountdown",
      defaultMessage:
        "{days} {days, plural, one {day} other {days}} {hours} {hours, plural, one {hour} other {hours}} {minutes} {minutes, plural, one {minute} other {minutes}}",
    },
    { days, hours, minutes },
  );
}

function formatTimingSummary(
  intl: IntlShape,
  slotRange: string | undefined,
  estimatedStart: string | number | Date | undefined,
  estimatedEnd: string | number | Date | undefined,
): LifecycleTimingSummary {
  return {
    primary: formatDateTimeRange(intl, estimatedStart, estimatedEnd),
    secondary: formatSlotRangeLabel(slotRange),
  };
}

export function TreasuryLifecyclePeriodInfo({
  currentPeriod = "proposal",
  currentPeriodProgress = 0,
  currentSlot,
  lifecycleId,
  isHistoricalLifecycle = false,
  lifecycleOptions,
  onLifecycleChange,
  periodEndsIn,
  periodMetadata,
  className,
  title,
  description,
  loading = false,
}: TreasuryLifecyclePeriodInfoProps): JSX.Element {
  const intl = useTreasuryIntl();
  const [isLifecycleSelectorOpen, setIsLifecycleSelectorOpen] = useState(false);
  const [maxDerivedLifecycleId, setMaxDerivedLifecycleId] = useState<number | null>(
    parseNumericValue(lifecycleId),
  );
  const resolvedCurrentSlot = parseNumericValue(currentSlot);
  const numericLifecycleId = parseNumericValue(lifecycleId);

  useEffect(() => {
    if (numericLifecycleId === null) {
      return;
    }
    setMaxDerivedLifecycleId((value) =>
      value === null ? numericLifecycleId : Math.max(value, numericLifecycleId),
    );
  }, [numericLifecycleId]);

  const resolvedLifecycleOptions =
    lifecycleOptions ??
    (maxDerivedLifecycleId !== null
      ? Array.from({ length: maxDerivedLifecycleId + 1 }, (_value, index) => index)
      : []);
  const formatLifecycleOptionLabel = (option: number | string): string =>
    intl.formatMessage(
      {
        id: "ui.lifecycle.lifecycleId",
        defaultMessage: "Lifecycle {id}",
      },
      { id: option },
    );
  const currentValidLifecycleOption =
    resolvedLifecycleOptions.length > 0
      ? (resolvedLifecycleOptions[resolvedLifecycleOptions.length - 1] ?? null)
      : null;
  const currentValidLifecycleOptionLabel =
    currentValidLifecycleOption !== null
      ? formatLifecycleOptionLabel(currentValidLifecycleOption)
      : null;
  const currentValidLifecycleOptionNumber =
    currentValidLifecycleOption !== null ? Number(currentValidLifecycleOption) : null;
  const historicalLifecycleOptions = resolvedLifecycleOptions.filter(
    (option) => String(option) !== String(currentValidLifecycleOption),
  ).slice().reverse();
  const currentPeriodIndex = Math.max(
    0,
    PERIODS.findIndex((period) => period.id === currentPeriod),
  );
  const safeCurrentPeriodProgress = clampPercentage(currentPeriodProgress);
  const currentPeriodLabel = intl.formatMessage({
    id: `ui.lifecycle.period.${currentPeriod}`,
    defaultMessage: currentPeriod,
  });
  const currentPeriodTitle = intl.formatMessage(
    {
      id: "ui.lifecycle.periodTitle",
      defaultMessage: "{period} period",
    },
    { period: currentPeriodLabel },
  );
  const currentPeriodDefinition =
    PERIODS.find((period) => period.id === currentPeriod) ?? PERIODS[0];
  const metadataByPeriod = new Map(
    (periodMetadata ?? []).map((entry) => [entry.period, entry]),
  );
  const currentPeriodMetadata = metadataByPeriod.get(currentPeriod);
  const lifecycleEndMetadata = metadataByPeriod.get("cooldown");

  const currentPeriodPurpose =
    currentPeriodMetadata?.purpose ??
    intl.formatMessage({
      id: `ui.lifecycle.purpose.${currentPeriod}`,
      defaultMessage: currentPeriod,
    });

  const heroTimingSummary = formatTimingSummary(
    intl,
    currentPeriodMetadata?.slotRange,
    currentPeriodMetadata?.estimatedStart,
    currentPeriodMetadata?.estimatedEnd,
  );
  const currentPeriodProgressSummary = resolveLifecycleProgressSummary(
    currentPeriod,
    isHistoricalLifecycle,
    currentPeriod,
    currentPeriodIndex,
    safeCurrentPeriodProgress,
    currentPeriodMetadata?.slotRange,
    resolvedCurrentSlot,
  );
  const remainingSlotsLabel = isHistoricalLifecycle
    ? null
    : formatRemainingSlots(
        intl,
        currentPeriodMetadata?.slotRange,
        currentPeriodProgressSummary.percent,
        currentPeriodProgressSummary.currentSlot,
      );
  const countdownLabel = formatStaticCountdownToDate(
    intl,
    currentPeriodMetadata?.estimatedEnd,
  );
  const endingInSummary =
    isHistoricalLifecycle
      ? formatCompactDateTime(intl, lifecycleEndMetadata?.estimatedEnd)
      : countdownLabel ??
        periodEndsIn ??
        intl.formatMessage({
          id: "ui.lifecycle.endingInFallback",
          defaultMessage: "Not available",
        });

  if (loading) {
    return (
      <section
        className={cn("space-y-8", className)}
        data-component="treasury-lifecycle-period-info"
        data-loading="true"
      >
        <header className="border-b border-border/80 px-1 pb-8 sm:px-2">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-28 rounded-sm" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-md sm:h-10 sm:w-10" />
                  <Skeleton className="h-10 w-52 sm:h-12 sm:w-64" />
                </div>
                <Skeleton className="h-5 w-full max-w-3xl" />
                <Skeleton className="h-5 w-[min(100%,38rem)]" />
              </div>
            </div>
            <div className="space-y-2 sm:min-w-[12rem] sm:text-right">
              <Skeleton className="ml-auto h-4 w-20 rounded-sm" />
              <Skeleton className="ml-auto h-8 w-36" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          </div>
        </header>

        <div className="space-y-5 pt-1">
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_value, index) => (
              <li
                key={`loading-card-${index}`}
                className="rounded-xl border border-border/70 bg-background px-4 py-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-6 w-20 rounded-sm" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-[85%]" />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                  <Skeleton className="h-3 w-16 rounded-sm" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </li>
            ))}
          </ol>

          <div className="space-y-2">
            <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3">
              {Array.from({ length: 4 }, (_value, index) => (
                <Skeleton key={`loading-progress-label-${index}`} className="h-4 w-20" />
              ))}
            </div>
            <div className="relative flex min-w-0 gap-px">
              {Array.from({ length: 4 }, (_value, index) => (
                <Skeleton
                  key={`loading-progress-bar-${index}`}
                  className={cn(
                    "h-4 min-w-0 flex-1 rounded-none",
                    index === 0 ? "rounded-l-md" : "",
                    index === 3 ? "rounded-r-md" : "",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn("space-y-8", className)}
      data-component="treasury-lifecycle-period-info"
    >
      <header className="border-b border-border/80 px-1 sm:px-2 pb-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {lifecycleId !== undefined ? (
                  resolvedLifecycleOptions.length > 0 ? (
                    <>
                      <label className="relative inline-flex items-center sm:hidden">
                        <span className="sr-only">
                          {intl.formatMessage({
                            id: "ui.lifecycle.selectorLabel",
                            defaultMessage: "Select lifecycle",
                          })}
                        </span>
                        <select
                          className="min-w-[8.75rem] appearance-none bg-transparent py-1 pr-4 text-[11px] font-medium uppercase tracking-[0.12em] text-foreground outline-none"
                          value={String(lifecycleId)}
                          onChange={(event) => {
                            onLifecycleChange?.(Number(event.target.value));
                          }}
                          aria-label={intl.formatMessage({
                            id: "ui.lifecycle.selectorLabel",
                            defaultMessage: "Select lifecycle",
                          })}
                        >
                          {currentValidLifecycleOption !== null ? (
                            <optgroup
                              label={intl.formatMessage({
                                id: "ui.lifecycle.selectorSectionCurrent",
                                defaultMessage: "Current",
                              })}
                            >
                              <option
                                key={String(currentValidLifecycleOption)}
                                value={String(currentValidLifecycleOption)}
                              >
                                {currentValidLifecycleOptionLabel}
                              </option>
                            </optgroup>
                          ) : null}
                          {historicalLifecycleOptions.length > 0 ? (
                            <optgroup
                              label={intl.formatMessage({
                                id: "ui.lifecycle.selectorSectionHistorical",
                                defaultMessage: "Historical",
                              })}
                            >
                              {historicalLifecycleOptions.map((option) => (
                                <option key={String(option)} value={String(option)}>
                                  {formatLifecycleOptionLabel(option)}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-1 h-3.5 w-3.5 text-muted-foreground"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      </label>

                      <Popover
                        open={isLifecycleSelectorOpen}
                        onOpenChange={setIsLifecycleSelectorOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            className="hidden h-auto min-w-0 gap-1 rounded-sm px-0 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-foreground hover:bg-transparent hover:text-foreground sm:inline-flex"
                            aria-label={intl.formatMessage({
                              id: "ui.lifecycle.selectorLabel",
                              defaultMessage: "Select lifecycle",
                            })}
                          >
                            {intl.formatMessage(
                              {
                                id: "ui.lifecycle.lifecycleId",
                                defaultMessage: "Lifecycle {id}",
                              },
                              { id: lifecycleId },
                            )}
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                                isLifecycleSelectorOpen ? "rotate-180" : "",
                              )}
                              strokeWidth={2.25}
                              aria-hidden="true"
                            />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="bottom"
                          sideOffset={8}
                          className="hidden w-48 p-1 sm:block"
                        >
                          <div className="border-b border-border/60 px-2.5 py-2">
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              {intl.formatMessage({
                                id: "ui.lifecycle.selectorDescription",
                                defaultMessage: "Select a lifecycle to display",
                              })}
                            </p>
                          </div>
                          <div className="max-h-64 overflow-auto py-1 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/70 [&::-webkit-scrollbar-track]:bg-transparent">
                            {currentValidLifecycleOption !== null ? (
                              <div className="px-2.5 pb-1 pt-1">
                                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                                  {intl.formatMessage({
                                    id: "ui.lifecycle.selectorSectionCurrent",
                                    defaultMessage: "Current",
                                  })}
                                </p>
                              </div>
                            ) : null}
                            {currentValidLifecycleOption !== null ? (
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted hover:text-foreground",
                                  String(currentValidLifecycleOption) === String(lifecycleId)
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground",
                                )}
                                onClick={() => {
                                  if (currentValidLifecycleOptionNumber !== null) {
                                    onLifecycleChange?.(currentValidLifecycleOptionNumber);
                                  }
                                  setIsLifecycleSelectorOpen(false);
                                }}
                              >
                                <span className="min-w-0">
                                  {currentValidLifecycleOptionLabel}
                                </span>
                                {String(currentValidLifecycleOption) === String(lifecycleId) ? (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                ) : null}
                              </button>
                            ) : null}
                            {historicalLifecycleOptions.length > 0 ? (
                              <>
                                <div className="px-2.5 pb-1 pt-3">
                                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                                    {intl.formatMessage({
                                      id: "ui.lifecycle.selectorSectionHistorical",
                                      defaultMessage: "Historical",
                                    })}
                                  </p>
                                </div>
                                {historicalLifecycleOptions.map((option) => {
                                  const isSelected = String(option) === String(lifecycleId);
                                  return (
                                    <button
                                      key={String(option)}
                                      type="button"
                                      className={cn(
                                        "flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted hover:text-foreground",
                                        isSelected
                                          ? "bg-muted text-foreground"
                                          : "text-muted-foreground",
                                      )}
                                      onClick={() => {
                                        onLifecycleChange?.(Number(option));
                                        setIsLifecycleSelectorOpen(false);
                                      }}
                                    >
                                      <span className="min-w-0">
                                        {formatLifecycleOptionLabel(option)}
                                      </span>
                                      {isSelected ? (
                                        <Check
                                          className="h-3.5 w-3.5 shrink-0 text-primary"
                                          aria-hidden="true"
                                        />
                                      ) : null}
                                    </button>
                                  );
                                })}
                              </>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </>
                  ) : (
                    <span>
                      {intl.formatMessage(
                        {
                          id: "ui.lifecycle.lifecycleId",
                          defaultMessage: "Lifecycle {id}",
                        },
                        { id: lifecycleId },
                      )}
                    </span>
                  )
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-2xl sm:text-3xl" aria-hidden="true">
                        {currentPeriodDefinition?.emoji}
                      </span>
                      <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                        {title ?? currentPeriodTitle}
                      </h2>
                    </div>
                    <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                      {description ?? currentPeriodPurpose}
                    </p>
                  </div>
                  <div className="shrink-0 space-y-2 sm:min-w-[12rem] sm:pt-0 sm:text-right">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {isHistoricalLifecycle
                        ? intl.formatMessage({
                            id: "ui.lifecycle.ended",
                            defaultMessage: "Ended",
                          })
                        : intl.formatMessage({
                            id: "ui.lifecycle.endingIn",
                            defaultMessage: "Ending in",
                          })}
                    </p>
                    <p className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
                      {endingInSummary}
                    </p>
                    {remainingSlotsLabel ? (
                      <p className="text-sm leading-snug text-muted-foreground">
                        <span className="font-mono tabular-nums">{remainingSlotsLabel}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
      </header>

      <div className="space-y-5 pt-1">
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PERIODS.map((period, index) => {
              const isActive = !isHistoricalLifecycle && period.id === currentPeriod;
              const isCompleted = isHistoricalLifecycle || index < currentPeriodIndex;
              const metadata = metadataByPeriod.get(period.id);
              const periodPurposeText =
                metadata?.purpose ??
                intl.formatMessage({
                  id: `ui.lifecycle.purpose.${period.id}`,
                  defaultMessage: period.id,
                });
              const stateLabel = isActive
                ? intl.formatMessage({
                    id: "ui.lifecycle.state.current",
                    defaultMessage: "Current",
                  })
                : isCompleted
                  ? intl.formatMessage({
                      id: "ui.lifecycle.state.completed",
                      defaultMessage: "Completed",
                    })
                  : intl.formatMessage({
                      id: "ui.lifecycle.state.upcoming",
                      defaultMessage: "Upcoming",
                    });

              const periodTimingSummary = formatTimingSummary(
                intl,
                metadata?.slotRange,
                metadata?.estimatedStart,
                metadata?.estimatedEnd,
              );

              return (
                <li
                  key={period.id}
                  className={cn(
                    "rounded-xl border px-4 py-4 transition-colors",
                    isActive
                      ? "border-primary/50 bg-primary/12 shadow-sm ring-1 ring-primary/20 text-foreground"
                      : isCompleted
                        ? "border-border/70 bg-muted/35 text-foreground/80"
                        : "border-border/70 bg-background text-muted-foreground",
                  )}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "flex min-w-0 items-center gap-1.5 truncate text-sm",
                            isActive ? "font-semibold" : "font-medium",
                          )}
                        >
                          <span className="shrink-0" aria-hidden="true">
                            {period.emoji}
                          </span>
                          <span className="truncate">
                          {intl.formatMessage({
                            id: `ui.lifecycle.period.${period.id}`,
                            defaultMessage: period.id,
                          })}
                          </span>
                        </span>
                      </div>
                      <span
                        className={cn(
                        "mt-0.5 inline-flex shrink-0 items-center rounded-sm py-1 text-[11px] font-medium leading-none",
                          isActive
                          ? "bg-primary/12 px-2.5 text-primary"
                            : isCompleted
                            ? "bg-muted px-2.5 text-foreground/80"
                            : "bg-background px-2.5 text-muted-foreground",
                        )}
                      >
                      {stateLabel}
                    </span>
                    </div>
                    <div className="w-full">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {periodPurposeText}
                      </p>
                    </div>
                  </div>
                  {periodTimingSummary.primary ||
                  periodTimingSummary.secondary ? (
                    <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                      {periodTimingSummary.primary ? (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                            {intl.formatMessage({
                              id: "ui.lifecycle.duration",
                              defaultMessage: "Duration",
                            })}
                          </p>
                          <p
                            className={cn(
                              "text-xs leading-relaxed",
                              isActive ? "text-foreground" : "text-foreground/85",
                            )}
                          >
                            <span className="font-mono font-medium tabular-nums">
                              {periodTimingSummary.primary}
                            </span>
                          </p>
                        </div>
                      ) : null}
                      {periodTimingSummary.secondary ? (
                        <p
                          className={cn(
                            "text-[11px] leading-relaxed",
                            "text-muted-foreground",
                          )}
                        >
                          <span className="font-mono tabular-nums">
                            {periodTimingSummary.secondary}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
          })}
        </ol>

        <div className="space-y-2">
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3">
            {PERIODS.map((period) => {
              const periodLabel = intl.formatMessage({
                id: `ui.lifecycle.period.${period.id}`,
                defaultMessage: period.id,
              });
              const isCurrentPeriod = !isHistoricalLifecycle && period.id === currentPeriod;

              return (
                <div
                  key={period.id}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-xs",
                    isCurrentPeriod ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  {isCurrentPeriod ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm bg-foreground/25"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 truncate">{periodLabel}</span>
                </div>
              );
            })}
          </div>

          <div className="relative flex min-w-0">
            {PERIODS.map((period, index) => {
              const metadata = metadataByPeriod.get(period.id);
              const periodLabel = intl.formatMessage({
                id: `ui.lifecycle.period.${period.id}`,
                defaultMessage: period.id,
              });
              const progressSummary = resolveLifecycleProgressSummary(
                period.id,
                isHistoricalLifecycle,
                currentPeriod,
                currentPeriodIndex,
                safeCurrentPeriodProgress,
                metadata?.slotRange,
                resolvedCurrentSlot,
              );
              const isCurrentPeriod = !isHistoricalLifecycle && period.id === currentPeriod;
              const isCompletedPeriod = isHistoricalLifecycle || index < currentPeriodIndex;
              const isFirst = index === 0;
              const isLast = index === PERIODS.length - 1;

              return (
                <div key={period.id} className="relative min-w-0 flex-1">
                  <div
                    role="progressbar"
                    aria-label={intl.formatMessage(
                      {
                        id: "ui.lifecycle.progressAriaLabelForPeriod",
                        defaultMessage: "{period} progress",
                      },
                      { period: periodLabel },
                    )}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressSummary.percent)}
                    className={cn(
                      "relative h-4 overflow-hidden bg-muted",
                      isFirst && isLast
                        ? "rounded-md"
                        : isFirst
                          ? "rounded-l-md"
                          : isLast
                            ? "rounded-r-md"
                            : "rounded-none",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 transition-all",
                        (!isHistoricalLifecycle && isCurrentPeriod) || isCompletedPeriod
                          ? "bg-primary"
                          : "bg-foreground/35",
                        isFirst && isLast
                          ? "rounded-md"
                          : isFirst
                            ? "rounded-l-md"
                            : isLast
                              ? "rounded-r-md"
                              : "rounded-none",
                      )}
                      style={{ width: `${progressSummary.percent}%` }}
                    />
                  </div>

                  {!isLast ? (
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-6 translate-x-1/2 items-center justify-center"
                      aria-hidden="true"
                      data-component="lifecycle-boundary-caret"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-[calc(100%+2px)] w-5 shrink-0 text-white"
                      >
                        <path
                          d="M2 1 L9 8 L2 15 L6 15 L13 8 L6 1 Z"
                          fill="currentColor"
                          stroke="currentColor"
                          strokeWidth="0.5"
                          strokeLinejoin="miter"
                        />
                      </svg>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
