import { type JSX, useEffect, useId, useRef } from "react";
import { Search } from "lucide-react";
import { useTreasuryIntl } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import type { TreasuryProposalTableEntry } from "../proposals/proposals-table";

export interface TreasuryProposalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  results: TreasuryProposalTableEntry[];
  loading?: boolean;
  onSelect?: (entry: TreasuryProposalTableEntry) => void;
}

export function getDefaultProposalSearchShortcutLabel(): string {
  if (typeof navigator === "undefined") {
    return "Ctrl+K";
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? "⌘K" : "Ctrl+K";
}

function ProposalSearchResultSkeletonRow(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2.5">
      <Skeleton className="h-4 w-[min(100%,14rem)]" />
      <Skeleton className="h-3 w-[min(100%,10rem)]" />
    </div>
  );
}

export function TreasuryProposalSearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  loading = false,
  onSelect,
}: TreasuryProposalSearchDialogProps): JSX.Element {
  const intl = useTreasuryIntl();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const empty =
    !loading && results.length === 0 && query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(70vh,32rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 pb-4 pt-5">
          <DialogTitle>
            {intl.formatMessage({
              id: "ui.header.proposalSearch.title",
              defaultMessage: "Find proposals",
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({
              id: "ui.header.proposalSearch.description",
              defaultMessage:
                "Search by title, proposal address, proposer, recipient, amount, or contents.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-5 py-3">
          <label className="sr-only" htmlFor={inputId}>
            {intl.formatMessage({
              id: "ui.header.proposalSearch.inputLabel",
              defaultMessage: "Search proposals",
            })}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              id={inputId}
              value={query}
              onChange={(e) => {
                onQueryChange(e.target.value);
              }}
              placeholder={intl.formatMessage({
                id: "ui.header.proposalSearch.placeholder",
                defaultMessage: "Search proposals…",
              })}
              className="pl-9"
              autoComplete="off"
              type="search"
              role="searchbox"
            />
          </div>
        </div>

        <div
          className="min-h-[16rem] flex-1 overflow-y-auto px-3 py-2"
          data-component="proposal-search-results"
        >
          {loading ? (
            <div
              className="space-y-1"
              role="status"
              aria-live="polite"
              aria-busy="true"
              data-component="proposal-search-loading"
            >
              {Array.from({ length: 3 }, (_, i) => (
                <ProposalSearchResultSkeletonRow key={i} />
              ))}
            </div>
          ) : empty ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {intl.formatMessage({
                id: "ui.header.proposalSearch.empty",
                defaultMessage: "No proposals match your search.",
              })}
            </p>
          ) : results.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {intl.formatMessage({
                id: "ui.header.proposalSearch.hint",
                defaultMessage: "Start typing to search proposals.",
              })}
            </p>
          ) : (
            <ul
              className="space-y-0.5"
              role="listbox"
              aria-label={intl.formatMessage({
                id: "ui.header.proposalSearch.resultsLabel",
                defaultMessage: "Matching proposals",
              })}
            >
              {results.map((entry) => (
                <li key={entry.id} role="none">
                  <button
                    type="button"
                    role="option"
                    className={cn(
                      "w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors",
                      "hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    )}
                    onClick={() => {
                      onSelect?.(entry);
                      onOpenChange(false);
                    }}
                  >
                    <span className="block truncate text-sm font-medium text-foreground">
                      {entry.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {entry.proposalAddress ?? entry.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface TreasuryProposalSearchTriggerProps {
  onClick: () => void;
  shortcutLabel: string;
  className?: string;
}

export function TreasuryProposalSearchTrigger({
  onClick,
  shortcutLabel,
  className,
}: TreasuryProposalSearchTriggerProps): JSX.Element {
  const intl = useTreasuryIntl();
  const label = intl.formatMessage({
    id: "ui.header.proposalSearch.trigger",
    defaultMessage: "Find proposals",
  });

  const ariaLabel = intl.formatMessage(
    {
      id: "ui.header.proposalSearch.triggerAria",
      defaultMessage: "{label} ({shortcut})",
    },
    { label, shortcut: shortcutLabel },
  );

  return (
    <Button
      type="button"
      variant="ghost"
      data-component="header-proposal-search-trigger"
      className={cn(
        "group/header-search relative h-auto justify-start overflow-hidden rounded-md border border-border/70 bg-muted/55 px-2.5 py-1.5 pr-12 text-sm font-medium text-muted-foreground shadow-none transition-[width,background-color,border-color] duration-300 ease-in-out sm:w-[4.9rem] sm:hover:w-[12.5rem] sm:focus-visible:w-[12.5rem]",
        "hover:bg-muted",
        className,
      )}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="hidden max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-300 ease-in-out sm:inline-block sm:group-hover/header-search:ml-1 sm:group-hover/header-search:max-w-[6.75rem] sm:group-hover/header-search:opacity-100 sm:group-focus-visible/header-search:ml-1 sm:group-focus-visible/header-search:max-w-[6.75rem] sm:group-focus-visible/header-search:opacity-100">
        {label}
      </span>
      <kbd
        className="pointer-events-none absolute right-2.5 top-1/2 hidden h-5 -translate-y-1/2 select-none items-center gap-0.5 rounded border border-border/80 bg-muted/80 px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex"
        aria-hidden
      >
        {shortcutLabel}
      </kbd>
    </Button>
  );
}
