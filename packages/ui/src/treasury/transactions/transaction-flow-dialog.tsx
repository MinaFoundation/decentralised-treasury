import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTreasuryIntl } from "../../i18n";
import { cn } from "../../lib/utils";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

type StepStatus = "idle" | "running" | "completed" | "error";

export type TreasuryTransactionFlowKind = "createProposal" | "vote" | "executeProposal";
export type TreasuryTransactionFlowStepId =
  | "review"
  | "signAndSend"
  | "waitForInclusion"
  | "postContent";

export interface TreasuryTransactionSummaryItem {
  label: string;
  value: string;
  mono?: boolean;
}

export interface TreasuryTransactionFlowContext {
  kind: TreasuryTransactionFlowKind;
  senderAddress: string;
  fee: string;
  nonce?: number;
  memo: string;
}

export interface TreasuryTransactionSendResult {
  hash?: string;
}

export interface TreasuryTransactionCompletionResult {
  hash?: string;
  blockHeight?: string | number;
  explorerUrl?: string;
}

export interface TreasuryTransactionFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: TreasuryTransactionFlowKind;
  senderAddress?: string | null;
  title?: string;
  description?: string;
  summaryItems?: TreasuryTransactionSummaryItem[];
  transactionDetailsCode?: string;
  defaultFee?: string;
  defaultNonce?: string;
  defaultMemo?: string;
  submitLabel?: string;
  onCompile?: (context: TreasuryTransactionFlowContext) => Promise<void>;
  onProve?: (context: TreasuryTransactionFlowContext) => Promise<void>;
  onSignAndSend?: (
    context: TreasuryTransactionFlowContext,
  ) => Promise<TreasuryTransactionSendResult | void>;
  onWaitForInclusion?: (
    context: TreasuryTransactionFlowContext & TreasuryTransactionSendResult,
  ) => Promise<TreasuryTransactionCompletionResult | void>;
  onPostInclusion?: (
    context: TreasuryTransactionFlowContext &
      TreasuryTransactionSendResult &
      TreasuryTransactionCompletionResult,
  ) => Promise<void>;
  autoCloseDelaySeconds?: number;
  preventCloseWhileRunning?: boolean;
  onComplete?: (result: TreasuryTransactionCompletionResult) => void;
  onError?: (error: Error) => void;
}

function sanitizeTransactionDetailsPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTransactionDetailsPayload(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitizedRecord: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (key === "accountUpdates") {
        continue;
      }
      sanitizedRecord[key] = sanitizeTransactionDetailsPayload(child);
    }
    return sanitizedRecord;
  }
  return value;
}

function sanitizeTransactionDetailsCode(transactionDetailsCode?: string): string | undefined {
  if (!transactionDetailsCode) {
    return transactionDetailsCode;
  }
  try {
    const parsed = JSON.parse(transactionDetailsCode);
    const sanitized = sanitizeTransactionDetailsPayload(parsed);
    return JSON.stringify(sanitized, null, 2);
  } catch {
    return transactionDetailsCode;
  }
}

export function TreasuryTransactionFlowDialog({
  open,
  onOpenChange,
  kind,
  senderAddress,
  title,
  description,
  summaryItems = [],
  transactionDetailsCode,
  defaultFee = "0.1",
  defaultNonce = "",
  defaultMemo = "",
  submitLabel,
  onCompile,
  onProve,
  onSignAndSend,
  onWaitForInclusion,
  onPostInclusion,
  autoCloseDelaySeconds,
  preventCloseWhileRunning = false,
  onComplete,
  onError,
}: TreasuryTransactionFlowDialogProps): JSX.Element {
  const intl = useTreasuryIntl();
  const descriptionId = useId();
  const showPostContentStep = typeof onPostInclusion === "function";
  const runIdRef = useRef(0);
  const activeStepRef = useRef<TreasuryTransactionFlowStepId | null>(null);
  const signAndSendPhaseRef = useRef<"compiling" | "proving" | "awaitingSignature" | null>(null);
  const [fee, setFee] = useState(defaultFee);
  const [nonce, setNonce] = useState(defaultNonce);
  const [memo, setMemo] = useState(defaultMemo);
  const [stepStatuses, setStepStatuses] = useState<Record<TreasuryTransactionFlowStepId, StepStatus>>(
    createInitialStepStatuses,
  );
  const [activeStep, setActiveStep] = useState<TreasuryTransactionFlowStepId | null>(null);
  const [signAndSendPhase, setSignAndSendPhase] = useState<
    "compiling" | "proving" | "awaitingSignature" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedStage, setFailedStage] = useState<
    "compiling" | "proving" | "awaitingSignature" | "awaitingInclusion" | "postingContent" | null
  >(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [completion, setCompletion] = useState<TreasuryTransactionCompletionResult | null>(null);
  const [notificationDismissed, setNotificationDismissed] = useState(false);
  const [autoCloseRemainingSeconds, setAutoCloseRemainingSeconds] = useState<number | null>(null);
  const [autoCloseCancelled, setAutoCloseCancelled] = useState(false);
  const completionRef = useRef<TreasuryTransactionCompletionResult | null>(null);
  const completionCallbackInvokedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    if (!open && completion) {
      setNotificationDismissed(false);
    }
  }, [completion, open]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const hasSenderAddress = senderAddress?.trim().length ? true : false;
  const normalizedSenderAddress = senderAddress?.trim() ?? "";
  const parsedFee = parseFeeValue(fee);
  const parsedNonce = parseNonceValue(nonce);
  const feeError =
    fee.trim().length === 0
      ? intl.formatMessage({
          id: "ui.transactionFlow.feeRequired",
          defaultMessage: "Enter a transaction fee.",
        })
      : parsedFee === null || parsedFee <= 0
        ? intl.formatMessage({
            id: "ui.transactionFlow.feeInvalid",
            defaultMessage: "Fee must be a positive MINA value.",
          })
        : null;
  const nonceError =
    nonce.trim().length === 0
      ? null
      : parsedNonce === null
        ? intl.formatMessage({
            id: "ui.transactionFlow.nonceInvalid",
            defaultMessage: "Nonce must be a whole number greater than or equal to zero.",
          })
        : null;
  const senderError = !hasSenderAddress
    ? intl.formatMessage({
        id: "ui.transactionFlow.senderRequired",
        defaultMessage: "Connect a wallet before preparing a transaction.",
      })
    : null;
  const canStart =
    activeStep === null && !completion && !senderError && !feeError && !nonceError;
  const isRunning = activeStep !== null;
  const isWaitingForInclusion = activeStep === "waitForInclusion";
  const isLockedWhileRunning = preventCloseWhileRunning && isRunning;
  const showBackgroundWaitingNotice = !preventCloseWhileRunning && !open && isWaitingForInclusion;
  const showCompletionNotification = !open && completion && !notificationDismissed;
  const normalizedAutoCloseDelaySeconds =
    typeof autoCloseDelaySeconds === "number" && Number.isFinite(autoCloseDelaySeconds)
      ? Math.max(0, Math.floor(autoCloseDelaySeconds))
      : 0;
  const shouldAutoCloseAfterCompletion = normalizedAutoCloseDelaySeconds > 0;

  const resolvedTitle = title ?? getDefaultTitle(intl, kind);
  const resolvedDescription = description ?? getDefaultDescription(intl, kind);
  const resolvedSubmitLabel =
    submitLabel ??
    intl.formatMessage({
      id: "ui.transactionFlow.submit",
      defaultMessage: "Start transaction",
    });
  const reviewSubmitLabel = intl.formatMessage({
    id: "ui.transactionFlow.signAndSendCta",
    defaultMessage: "Sign and send",
  });
  const doneLabel = intl.formatMessage({
    id: "ui.transactionFlow.done",
    defaultMessage: "Done",
  });
  const keepOpenCountdownLabel = intl.formatMessage(
    {
      id: "ui.transactionFlow.keepOpenCountdown",
      defaultMessage: "Keep open ({seconds}s)",
    },
    {
      seconds: autoCloseRemainingSeconds ?? 0,
    },
  );
  const steps = useMemo(() => getStepDefinitions(intl), [intl]);
  const stepOrder = useMemo(() => getStepOrder(showPostContentStep), [showPostContentStep]);
  const terminalStepId = showPostContentStep ? "postContent" : "waitForInclusion";
  const completedHeaderDescription = getCompletedHeaderDescription(intl, showPostContentStep);
  const displayedStepId =
    activeStep ??
    (completion
      ? terminalStepId
      : stepOrder.find((stepId) => stepStatuses[stepId] === "error") ??
        (stepStatuses.waitForInclusion === "completed" ? terminalStepId : "review"));
  const headerDescription =
    displayedStepId === "review"
      ? resolvedDescription
      : completion
        ? completedHeaderDescription
      : displayedStepId === "signAndSend"
        ? steps.find((step) => step.id === "signAndSend")?.description ?? resolvedDescription
      : displayedStepId === "postContent"
        ? steps.find((step) => step.id === "postContent")?.description ?? resolvedDescription
        : steps.find((step) => step.id === "waitForInclusion")?.description ?? resolvedDescription;
  const displayedTransactionDetailsCode = useMemo(
    () => sanitizeTransactionDetailsCode(transactionDetailsCode),
    [transactionDetailsCode],
  );

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  useEffect(() => {
    signAndSendPhaseRef.current = signAndSendPhase;
  }, [signAndSendPhase]);

  const emitDeferredCompletionIfNeeded = useCallback((): void => {
    if (!shouldAutoCloseAfterCompletion) {
      return;
    }
    if (completionCallbackInvokedRef.current) {
      return;
    }
    const completionResult = completionRef.current;
    if (!completionResult) {
      return;
    }
    completionCallbackInvokedRef.current = true;
    onCompleteRef.current?.(completionResult);
  }, [shouldAutoCloseAfterCompletion]);

  const closeDialog = useCallback((): void => {
    emitDeferredCompletionIfNeeded();
    onOpenChangeRef.current(false);
  }, [emitDeferredCompletionIfNeeded]);

  useEffect(() => {
    if (!open || !completion || !shouldAutoCloseAfterCompletion) {
      setAutoCloseRemainingSeconds(null);
      setAutoCloseCancelled(false);
      return;
    }
    setAutoCloseCancelled(false);
    setAutoCloseRemainingSeconds(normalizedAutoCloseDelaySeconds);
  }, [completion, normalizedAutoCloseDelaySeconds, open, shouldAutoCloseAfterCompletion]);

  useEffect(() => {
    if (
      !open ||
      !completion ||
      !shouldAutoCloseAfterCompletion ||
      autoCloseCancelled ||
      autoCloseRemainingSeconds === null
    ) {
      return;
    }
    if (autoCloseRemainingSeconds <= 0) {
      closeDialog();
      return;
    }
    const timerId = window.setTimeout(() => {
      setAutoCloseRemainingSeconds((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    }, 1000);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    autoCloseCancelled,
    autoCloseRemainingSeconds,
    closeDialog,
    completion,
    open,
    shouldAutoCloseAfterCompletion,
  ]);

  const isAutoCloseCountdownActive =
    completion &&
    open &&
    shouldAutoCloseAfterCompletion &&
    !autoCloseCancelled &&
    autoCloseRemainingSeconds !== null;

  const handleStart = async (): Promise<void> => {
    if (!canStart || !hasSenderAddress) {
      return;
    }

    const currentRunId = runIdRef.current + 1;
    runIdRef.current = currentRunId;
    setStepStatuses({
      review: "completed",
      signAndSend: "idle",
      waitForInclusion: "idle",
      postContent: "idle",
    });
    setActiveStep(null);
    setSignAndSendPhase(null);
    setErrorMessage(null);
    setFailedStage(null);
    setTransactionHash(null);
    setCompletion(null);
    setNotificationDismissed(false);
    setAutoCloseRemainingSeconds(null);
    setAutoCloseCancelled(false);
    completionRef.current = null;
    completionCallbackInvokedRef.current = false;

    const context: TreasuryTransactionFlowContext = {
      kind,
      senderAddress: normalizedSenderAddress,
      fee: fee.trim(),
      nonce: parsedNonce ?? undefined,
      memo: memo.trim(),
    };

    let signAndSendResult: TreasuryTransactionSendResult = {};

    try {
      await runStep({
        currentRunId,
        stepId: "signAndSend",
        setActiveStep,
        setStepStatuses,
        onStep: async () => {
          setSignAndSendPhase("compiling");
          await onCompile?.(context);
          if (runIdRef.current !== currentRunId) {
            return;
          }
          setSignAndSendPhase("proving");
          await onProve?.(context);
          if (runIdRef.current !== currentRunId) {
            return;
          }
          setSignAndSendPhase("awaitingSignature");
          signAndSendResult = (await onSignAndSend?.(context)) ?? {};
          if (signAndSendResult.hash) {
            setTransactionHash(signAndSendResult.hash);
          }
        },
        runIdRef,
      });

      let completionResult: TreasuryTransactionCompletionResult = signAndSendResult;
      await runStep({
        currentRunId,
        stepId: "waitForInclusion",
        setActiveStep,
        setStepStatuses,
        onStep: async () => {
          completionResult =
            (await onWaitForInclusion?.({
              ...context,
              ...signAndSendResult,
            })) ?? signAndSendResult;
        },
        runIdRef,
      });

      if (onPostInclusion) {
        await runStep({
          currentRunId,
          stepId: "postContent",
          setActiveStep,
          setStepStatuses,
          onStep: async () => {
            await onPostInclusion({
              ...context,
              ...signAndSendResult,
              ...completionResult,
            });
          },
          runIdRef,
        });
      }

      if (runIdRef.current !== currentRunId) {
        return;
      }

      setActiveStep(null);
      setSignAndSendPhase(null);
      setCompletion(completionResult);
      completionRef.current = completionResult;
      completionCallbackInvokedRef.current = false;
      if (shouldAutoCloseAfterCompletion) {
        setAutoCloseCancelled(false);
        setAutoCloseRemainingSeconds(normalizedAutoCloseDelaySeconds);
      } else {
        completionCallbackInvokedRef.current = true;
        onCompleteRef.current?.(completionResult);
      }
    } catch (error) {
      if (runIdRef.current !== currentRunId) {
        return;
      }

      const resolvedError = normalizeError(error);
      const failedStageId =
        signAndSendPhaseRef.current ??
        (activeStepRef.current === "waitForInclusion"
          ? "awaitingInclusion"
          : activeStepRef.current === "postContent"
            ? "postingContent"
            : null);
      console.error("[transaction-flow] step failed", {
        kind,
        failedStageId,
        activeStep: activeStepRef.current,
        signAndSendPhase: signAndSendPhaseRef.current,
        error: resolvedError,
      });
      setActiveStep(null);
      setSignAndSendPhase(null);
      setErrorMessage(resolvedError.message);
      setFailedStage(failedStageId);
      onError?.(resolvedError);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen === open) {
            return;
          }
          if (nextOpen) {
            return;
          }
          if (!nextOpen && isLockedWhileRunning) {
            return;
          }
          closeDialog();
        }}
      >
        <DialogContent
          aria-describedby={descriptionId}
          className="max-h-[90vh] max-w-4xl overflow-hidden bg-background p-0"
          onEscapeKeyDown={(event) => {
            if (isLockedWhileRunning) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (isLockedWhileRunning) {
              event.preventDefault();
            }
          }}
        >
          <div className="flex max-h-[90vh] min-h-0 flex-col overflow-hidden">
            <DialogHeader className="border-b px-4 py-4 sm:px-5">
              <div className="space-y-2">
                <DialogTitle>{resolvedTitle}</DialogTitle>
                <DialogDescription id={descriptionId}>{headerDescription}</DialogDescription>
              </div>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="space-y-5">
                {displayedStepId === "review" && summaryItems.length > 0 ? (
                  <section className="space-y-4 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] via-primary/[0.03] to-transparent px-5 py-4 shadow-[0_1px_0_rgba(0,0,0,0.015)]">
                    <div className="grid gap-3 md:grid-cols-2">
                      {summaryItems.map((item) => (
                        <SummaryRow key={`${item.label}-${item.value}`} item={item} />
                      ))}
                    </div>
                  </section>
                ) : null}

                {displayedStepId === "review" ? (
                  <section className="space-y-4">
                    <details className="group border-t border-border/70 pt-4">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 marker:hidden">
                        <div className="space-y-1">
                          <span className="block text-sm font-medium text-foreground/80">
                            {intl.formatMessage({
                              id: "ui.transactionFlow.txSettingsTitle",
                              defaultMessage: "Transaction settings",
                            })}
                          </span>
                          <span className="block text-sm leading-6 text-muted-foreground">
                            {intl.formatMessage({
                              id: "ui.transactionFlow.txSettingsDescription",
                              defaultMessage:
                                "Fee, memo, and sender wallet.",
                            })}
                          </span>
                        </div>
                        <ChevronDown
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                          aria-hidden="true"
                        />
                      </summary>
                      <div className="mt-4 space-y-4">
                        <FieldShell
                          label={intl.formatMessage({
                            id: "ui.transactionFlow.senderLabel",
                            defaultMessage: "Sender wallet",
                          })}
                          error={senderError}
                        >
                          <Input
                            value={hasSenderAddress ? normalizedSenderAddress : ""}
                            disabled
                            aria-label={intl.formatMessage({
                              id: "ui.transactionFlow.senderLabel",
                              defaultMessage: "Sender wallet",
                            })}
                            className="font-mono text-xs"
                            placeholder={intl.formatMessage({
                              id: "ui.transactionFlow.senderPlaceholder",
                              defaultMessage: "Connect wallet to continue",
                            })}
                          />
                        </FieldShell>

                        <FieldShell
                          label={intl.formatMessage({
                            id: "ui.transactionFlow.feeLabel",
                            defaultMessage: "Fee (MINA)",
                          })}
                          error={feeError}
                        >
                          <Input
                            value={fee}
                            onChange={(event) => setFee(event.target.value)}
                            disabled={isRunning}
                            inputMode="decimal"
                            aria-label={intl.formatMessage({
                              id: "ui.transactionFlow.feeLabel",
                              defaultMessage: "Fee (MINA)",
                            })}
                          />
                        </FieldShell>

                        <FieldShell
                          label={intl.formatMessage({
                            id: "ui.transactionFlow.nonceLabel",
                            defaultMessage: "Nonce",
                          })}
                          error={nonceError}
                        >
                          <Input
                            value={nonce}
                            onChange={(event) => setNonce(event.target.value)}
                            disabled={isRunning}
                            inputMode="numeric"
                            aria-label={intl.formatMessage({
                              id: "ui.transactionFlow.nonceLabel",
                              defaultMessage: "Nonce",
                            })}
                            placeholder={intl.formatMessage({
                              id: "ui.transactionFlow.noncePlaceholder",
                              defaultMessage: "Optional nonce override",
                            })}
                          />
                        </FieldShell>

                        <FieldShell
                          label={intl.formatMessage({
                            id: "ui.transactionFlow.memoLabel",
                            defaultMessage: "Memo",
                          })}
                        >
                          <Input
                            value={memo}
                            onChange={(event) => setMemo(event.target.value)}
                            disabled={isRunning}
                            aria-label={intl.formatMessage({
                              id: "ui.transactionFlow.memoLabel",
                              defaultMessage: "Memo",
                            })}
                            placeholder={intl.formatMessage({
                              id: "ui.transactionFlow.memoPlaceholder",
                              defaultMessage: "Optional transaction memo",
                            })}
                          />
                        </FieldShell>

                        {displayedTransactionDetailsCode ? (
                          <FieldShell
                            label={intl.formatMessage({
                              id: "ui.transactionFlow.rawAccountUpdatesLabel",
                              defaultMessage: "Transaction details",
                            })}
                          >
                            <div className="overflow-hidden rounded-md border border-border/70 bg-muted/30">
                              <pre className="max-h-80 overflow-auto p-3 text-left font-mono text-xs leading-5 text-foreground">
                                <code>{displayedTransactionDetailsCode}</code>
                              </pre>
                            </div>
                          </FieldShell>
                        ) : null}
                      </div>
                    </details>
                  </section>
                ) : null}

                {displayedStepId === "signAndSend" ||
                displayedStepId === "waitForInclusion" ||
                displayedStepId === "postContent" ? (
                  <TransactionFlowCenteredProgress
                    intl={intl}
                    showPostContentStep={showPostContentStep}
                    signAndSendPhase={signAndSendPhase}
                    isWaitingForInclusion={isWaitingForInclusion}
                    isPostingContent={activeStep === "postContent"}
                    preventCloseWhileRunning={preventCloseWhileRunning}
                    completion={completion}
                    transactionHash={transactionHash}
                    errorMessage={errorMessage}
                    failedStage={failedStage}
                  />
                ) : null}
              </div>
            </div>

            <DialogFooter className="border-t px-4 py-4 sm:justify-between sm:px-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  disabled={isLockedWhileRunning}
                >
                  {isWaitingForInclusion
                    ? preventCloseWhileRunning
                      ? intl.formatMessage({
                          id: "ui.transactionFlow.closeDisabled",
                          defaultMessage: "Close disabled until content is posted",
                        })
                      : intl.formatMessage({
                          id: "ui.transactionFlow.closeAndWait",
                          defaultMessage: "Close and keep waiting",
                        })
                    : activeStep === "postContent" && preventCloseWhileRunning
                      ? intl.formatMessage({
                          id: "ui.transactionFlow.closeDisabled",
                          defaultMessage: "Close disabled until content is posted",
                        })
                      : intl.formatMessage({
                          id: "ui.transactionFlow.close",
                          defaultMessage: "Close",
                        })}
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={
                      completion
                        ? isAutoCloseCountdownActive
                          ? () => {
                              setAutoCloseCancelled(true);
                              setAutoCloseRemainingSeconds(null);
                            }
                          : closeDialog
                        : () => void handleStart()
                    }
                    disabled={!completion && !canStart}
                    data-component="transaction-flow-start-button"
                  >
                    {isRunning ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        {getRunningButtonLabel(intl, activeStep)}
                      </>
                    ) : (
                      completion
                        ? isAutoCloseCountdownActive
                          ? keepOpenCountdownLabel
                          : doneLabel
                        : errorMessage
                          ? intl.formatMessage({
                              id: "ui.transactionFlow.retry",
                              defaultMessage: "Try again",
                            })
                        : displayedStepId === "review"
                          ? reviewSubmitLabel
                          : resolvedSubmitLabel
                    )}
                  </Button>
                </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {showBackgroundWaitingNotice ? (
        <FixedNotificationCard variant="default">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {intl.formatMessage({
                  id: "ui.transactionFlow.backgroundWaitingTitle",
                  defaultMessage: "Waiting for inclusion in background",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {transactionHash
                  ? intl.formatMessage(
                      {
                        id: "ui.transactionFlow.backgroundWaitingHash",
                        defaultMessage: "Monitoring transaction {hash}.",
                      },
                      { hash: transactionHash },
                    )
                  : intl.formatMessage({
                      id: "ui.transactionFlow.backgroundWaitingBody",
                      defaultMessage: "The transaction has been sent and is still being monitored.",
                    })}
              </p>
            </div>
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          </div>
        </FixedNotificationCard>
      ) : null}

      {showCompletionNotification ? (
        <FixedNotificationCard variant="success">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {intl.formatMessage({
                  id: "ui.transactionFlow.notificationCompleteTitle",
                  defaultMessage: "Transaction included",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {completion?.blockHeight != null
                  ? intl.formatMessage(
                      {
                        id: "ui.transactionFlow.notificationCompleteBody",
                        defaultMessage: "The network included the transaction at block #{blockHeight}.",
                      },
                      { blockHeight: String(completion.blockHeight) },
                    )
                  : intl.formatMessage({
                      id: "ui.transactionFlow.notificationCompleteNoBlock",
                      defaultMessage: "The network included the transaction successfully.",
                    })}
              </p>
              {completion?.hash ? (
                <p className="break-all font-mono text-xs text-muted-foreground">{completion.hash}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setNotificationDismissed(true)}
              aria-label={intl.formatMessage({
                id: "ui.transactionFlow.dismissNotification",
                defaultMessage: "Dismiss notification",
              })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </FixedNotificationCard>
      ) : null}
    </>
  );
}

function FieldShell({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function SummaryRow({ item }: { item: TreasuryTransactionSummaryItem }): JSX.Element {
  return (
    <div className="space-y-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {item.label}
      </p>
      <p className={cn("text-sm text-foreground", item.mono && "break-all font-mono text-xs")}>
        {item.value}
      </p>
    </div>
  );
}

function TransactionFlowCenteredProgress({
  intl,
  showPostContentStep,
  signAndSendPhase,
  isWaitingForInclusion,
  isPostingContent,
  preventCloseWhileRunning,
  completion,
  transactionHash,
  errorMessage,
  failedStage,
}: {
  intl: ReturnType<typeof useTreasuryIntl>;
  showPostContentStep: boolean;
  signAndSendPhase: "compiling" | "proving" | "awaitingSignature" | null;
  isWaitingForInclusion: boolean;
  isPostingContent: boolean;
  preventCloseWhileRunning: boolean;
  completion: TreasuryTransactionCompletionResult | null;
  transactionHash: string | null;
  errorMessage: string | null;
  failedStage:
    | "compiling"
    | "proving"
    | "awaitingSignature"
    | "awaitingInclusion"
    | "postingContent"
    | null;
}): JSX.Element {
  type ProgressStageId =
    | "compiling"
    | "proving"
    | "awaitingSignature"
    | "awaitingInclusion"
    | "postingContent";
  const progressItems = [
    {
      id: "compiling",
      label: intl.formatMessage({
        id: "ui.transactionFlow.progressCompiling",
        defaultMessage: "Compiling",
      }),
    },
    {
      id: "proving",
      label: intl.formatMessage({
        id: "ui.transactionFlow.progressProving",
        defaultMessage: "Proving",
      }),
    },
    {
      id: "awaitingSignature",
      label: intl.formatMessage({
        id: "ui.transactionFlow.progressAwaitingSignature",
        defaultMessage: "Sign & send",
      }),
    },
    {
      id: "awaitingInclusion",
      label: intl.formatMessage({
        id: "ui.transactionFlow.progressAwaitingInclusion",
        defaultMessage: "Awaiting inclusion",
      }),
    },
    ...(showPostContentStep
      ? ([
          {
            id: "postingContent",
            label: intl.formatMessage({
              id: "ui.transactionFlow.progressPostingContent",
              defaultMessage: "Post content",
            }),
          },
        ] as const)
      : []),
  ] as const;

  const currentStage: ProgressStageId = completion
    ? showPostContentStep
      ? "postingContent"
      : "awaitingInclusion"
    : failedStage
      ? failedStage
      : isPostingContent
        ? "postingContent"
      : isWaitingForInclusion
        ? "awaitingInclusion"
        : signAndSendPhase ?? "compiling";
  const isError = Boolean(errorMessage && failedStage);
  const [now, setNow] = useState(() => Date.now());
  const [completedDurationsMs, setCompletedDurationsMs] = useState<
    Partial<Record<ProgressStageId, number>>
  >({});
  const activeStageRef = useRef<ProgressStageId>(currentStage);
  const activeStageStartedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (completion) {
      return;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [completion]);

  useEffect(() => {
    const nowMs = Date.now();
    const previousStage = activeStageRef.current;
    if (previousStage !== currentStage) {
      const previousStartedAt = activeStageStartedAtRef.current;
      setCompletedDurationsMs((current) =>
        current[previousStage] != null
          ? current
          : {
              ...current,
              [previousStage]: nowMs - previousStartedAt,
            },
      );
      activeStageRef.current = currentStage;
      activeStageStartedAtRef.current = nowMs;
      setNow(nowMs);
      return;
    }
    if (completion) {
      const currentStartedAt = activeStageStartedAtRef.current;
      setCompletedDurationsMs((current) =>
        current[currentStage] != null
          ? current
          : {
              ...current,
              [currentStage]: nowMs - currentStartedAt,
            },
      );
      setNow(nowMs);
    }
  }, [completion, currentStage]);

  const progressBody = isError
    ? currentStage === "compiling"
      ? intl.formatMessage({
          id: "ui.transactionFlow.compilingFailedBody",
          defaultMessage:
            "Contract compilation failed before the wallet request could be prepared.",
        })
      : currentStage === "proving"
        ? intl.formatMessage({
            id: "ui.transactionFlow.provingFailedBody",
            defaultMessage:
              "The transaction proof generation step failed before the wallet signature step.",
          })
        : currentStage === "awaitingSignature"
          ? intl.formatMessage({
              id: "ui.transactionFlow.signAndSendFailedBody",
              defaultMessage:
                "The wallet signature or broadcast step failed before inclusion monitoring could begin.",
            })
          : currentStage === "postingContent"
            ? intl.formatMessage({
                id: "ui.transactionFlow.postContentFailedBody",
                defaultMessage:
                  "The transaction was included, but proposal content could not be attached successfully.",
              })
            : intl.formatMessage({
                id: "ui.transactionFlow.inclusionFailedBody",
                defaultMessage:
                  "The transaction was sent, but inclusion monitoring failed before completion could be confirmed.",
              })
    : completion
      ? completion.blockHeight != null
        ? intl.formatMessage(
            {
              id: "ui.transactionFlow.completedBodyWithBlock",
              defaultMessage: "Included at block #{blockHeight}.",
            },
            { blockHeight: String(completion.blockHeight) },
          )
        : intl.formatMessage({
            id: "ui.transactionFlow.completedBody",
            defaultMessage: "The transaction was included successfully.",
          })
      : currentStage === "compiling"
        ? intl.formatMessage({
            id: "ui.transactionFlow.compilingBody",
            defaultMessage: "Preparing local contract artifacts before the transaction can be proved.",
          })
        : currentStage === "proving"
          ? intl.formatMessage({
              id: "ui.transactionFlow.provingBody",
              defaultMessage: "Building the Mina transaction and generating transaction proofs locally.",
            })
          : currentStage === "awaitingSignature"
            ? intl.formatMessage({
                id: "ui.transactionFlow.awaitingSignatureBody",
                defaultMessage: "Auro should now be open. Approve the transaction there to continue.",
              })
            : currentStage === "postingContent"
              ? intl.formatMessage({
                  id: "ui.transactionFlow.postContentBody",
                  defaultMessage:
                    "Waiting for the processor to index the proposal, then retrying content attachment until it succeeds.",
                })
              : currentStage === "awaitingInclusion"
                ? intl.formatMessage({
                    id: "ui.transactionFlow.awaitingInclusionBody",
                    defaultMessage:
                      "The transaction was broadcast successfully and is now being monitored for inclusion.",
                  })
                : intl.formatMessage({
                    id: "ui.transactionFlow.completedBody",
                    defaultMessage: "The transaction was included successfully.",
                  });
  const shouldShowTransactionHash = Boolean(transactionHash && !isError);

  return (
    <section className="flex min-h-[22rem] flex-col items-center justify-center px-2 py-6 text-center">
      <LoaderCircle
        className={cn(
          "mb-5 h-10 w-10 text-primary",
          completion || isError ? "hidden" : "animate-spin",
        )}
        aria-hidden="true"
      />
      {completion ? (
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CircleCheck className="h-5 w-5" aria-hidden="true" />
        </div>
      ) : null}
      {isError ? (
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <CircleAlert className="h-5 w-5" aria-hidden="true" />
        </div>
      ) : null}
      <div className="space-y-2">
        <h4 className="text-lg font-semibold text-foreground">
          {isError
            ? currentStage === "compiling"
              ? intl.formatMessage({
                  id: "ui.transactionFlow.compilingFailedTitle",
                  defaultMessage: "Compilation failed",
                })
              : currentStage === "proving"
                ? intl.formatMessage({
                    id: "ui.transactionFlow.provingFailedTitle",
                    defaultMessage: "Proof generation failed",
                  })
                : currentStage === "awaitingSignature"
                  ? intl.formatMessage({
                      id: "ui.transactionFlow.signAndSendFailedTitle",
                      defaultMessage: "Sign & send failed",
                    })
                  : currentStage === "postingContent"
                    ? intl.formatMessage({
                        id: "ui.transactionFlow.postContentFailedTitle",
                        defaultMessage: "Content posting failed",
                      })
                  : intl.formatMessage({
                      id: "ui.transactionFlow.inclusionFailedTitle",
                      defaultMessage: "Inclusion check failed",
                    })
            : currentStage === "compiling"
            ? intl.formatMessage({
                id: "ui.transactionFlow.compilingTitle",
                defaultMessage: "Compiling contracts",
              })
            : currentStage === "proving"
              ? intl.formatMessage({
                  id: "ui.transactionFlow.provingTitle",
                  defaultMessage: "Generating proof",
                })
              : currentStage === "awaitingSignature"
                ? intl.formatMessage({
                    id: "ui.transactionFlow.awaitingSignatureTitle",
                    defaultMessage: "Sign & send",
                  })
                : currentStage === "postingContent"
                  ? intl.formatMessage({
                      id: "ui.transactionFlow.postContentTitle",
                      defaultMessage: "Posting proposal content",
                    })
                : currentStage === "awaitingInclusion"
                  ? intl.formatMessage({
                      id: "ui.transactionFlow.awaitingInclusionTitle",
                      defaultMessage: "Awaiting inclusion",
                    })
                  : intl.formatMessage({
                      id: "ui.transactionFlow.completedTitle",
                      defaultMessage: "Transaction completed",
                    })}
        </h4>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          {progressBody}
          {shouldShowTransactionHash ? (
            <span className="mt-1 block text-xs leading-5">
              {intl.formatMessage({
                id: "ui.transactionFlow.transactionHashLabel",
                defaultMessage: "Transaction hash:",
              })}{" "}
              <strong className="break-all font-mono font-semibold text-muted-foreground">
                {transactionHash}
              </strong>
            </span>
          ) : null}
        </p>
        {isWaitingForInclusion ? (
          <p className="max-w-lg text-sm leading-6 text-muted-foreground">
            {preventCloseWhileRunning
              ? intl.formatMessage({
                  id: "ui.transactionFlow.waitCloseDisabledHint",
                  defaultMessage:
                    "Closing is disabled for this flow until proposal content is posted successfully or the flow reaches a terminal error.",
                })
              : intl.formatMessage({
                  id: "ui.transactionFlow.waitCloseHint",
                  defaultMessage:
                    "You can close this dialog while waiting. Inclusion monitoring will continue in the background.",
                })}
          </p>
        ) : isPostingContent && preventCloseWhileRunning ? (
          <p className="max-w-lg text-sm leading-6 text-muted-foreground">
            {intl.formatMessage({
              id: "ui.transactionFlow.postContentCloseDisabledHint",
              defaultMessage:
                "Closing stays disabled while the app retries processor projection and content submission.",
            })}
          </p>
        ) : null}
      </div>
      <div
        className="mt-6 flex w-full justify-center overflow-x-auto pb-1"
        data-component="transaction-flow-progress-row"
      >
        <div
          className="flex min-w-max items-start gap-0 px-1"
          data-component="transaction-flow-progress-track"
        >
          {progressItems.map((item, index) => {
            const status = resolveProgressItemStatus(
              item.id,
              currentStage,
              progressItems,
              completion != null,
              isError,
            );
            const isLast = index === progressItems.length - 1;
            const statusLabel =
              item.id === "awaitingSignature"
                ? status === "completed"
                  ? intl.formatMessage({
                      id: "ui.transactionFlow.progressCompleted",
                      defaultMessage: "Completed",
                    })
                  : status === "running"
                    ? intl.formatMessage({
                        id: "ui.transactionFlow.progressWaiting",
                        defaultMessage: "Waiting",
                      })
                    : status === "error"
                      ? intl.formatMessage({
                          id: "ui.transactionFlow.progressFailed",
                          defaultMessage: "Failed",
                        })
                    : null
                : status === "error"
                  ? intl.formatMessage({
                      id: "ui.transactionFlow.progressFailed",
                      defaultMessage: "Failed",
                    })
                : null;
            const durationMs =
              item.id === "awaitingSignature"
                ? null
                : status === "completed"
                ? completedDurationsMs[item.id]
                : (status === "running" || status === "error") && activeStageRef.current === item.id
                  ? now - activeStageStartedAtRef.current
                  : null;
            return (
                <div key={item.id} className="flex items-start">
                <div
                  className="flex w-28 flex-col items-center text-center"
                  data-component="transaction-flow-progress-step"
                  data-step-id={item.id}
                  data-step-status={status}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold",
                      status === "completed" && "border-emerald-300/70 text-emerald-600",
                      status === "running" && "border-primary/40 text-primary",
                      status === "error" && "border-rose-300/70 text-rose-600",
                      status === "idle" && "border-border/70 text-muted-foreground",
                    )}
                    data-component="transaction-flow-progress-icon"
                    data-step-id={item.id}
                    data-step-status={status}
                  >
                    {status === "completed" ? (
                      <CircleCheck className="h-4 w-4" aria-hidden="true" />
                    ) : status === "error" ? (
                      <CircleAlert className="h-4 w-4" aria-hidden="true" />
                    ) : status === "running" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-medium leading-5 text-foreground">{item.label}</p>
                  {statusLabel ? (
                    <p className="text-[11px] leading-5 text-muted-foreground">{statusLabel}</p>
                  ) : durationMs != null ? (
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      {formatStepDuration(durationMs)}
                    </p>
                  ) : null}
                </div>
                {!isLast ? (
                  <div className="mt-4 h-px w-12 shrink-0 bg-border/70" aria-hidden="true" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function resolveProgressItemStatus(
  itemId:
    | "compiling"
    | "proving"
    | "awaitingSignature"
    | "awaitingInclusion"
    | "postingContent",
  currentStage:
    | "compiling"
    | "proving"
    | "awaitingSignature"
    | "awaitingInclusion"
    | "postingContent",
  items: ReadonlyArray<{
    id:
      | "compiling"
      | "proving"
      | "awaitingSignature"
      | "awaitingInclusion"
      | "postingContent";
  }>,
  isComplete: boolean,
  isError: boolean,
): "idle" | "running" | "completed" | "error" {
  const itemIndex = items.findIndex((item) => item.id === itemId);
  const currentIndex = items.findIndex((item) => item.id === currentStage);
  if (itemIndex < currentIndex) {
    return "completed";
  }
  if (itemIndex === currentIndex) {
    if (isComplete) {
      return "completed";
    }
    return isError ? "error" : "running";
  }
  return "idle";
}

function formatStepDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function FixedNotificationCard({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "default" | "success";
}): JSX.Element {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-md">
      <Alert
        variant={variant === "success" ? "success" : "default"}
        className={cn(
          "border shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/95",
          variant === "default" && "border-border/80 bg-background/95",
        )}
      >
        {children}
      </Alert>
    </div>
  );
}

function createInitialStepStatuses(): Record<TreasuryTransactionFlowStepId, StepStatus> {
  return {
    review: "idle",
    signAndSend: "idle",
    waitForInclusion: "idle",
    postContent: "idle",
  };
}

function getDefaultTitle(
  intl: ReturnType<typeof useTreasuryIntl>,
  kind: TreasuryTransactionFlowKind,
): string {
  if (kind === "createProposal") {
    return intl.formatMessage({
      id: "ui.transactionFlow.createTitle",
      defaultMessage: "Create proposal",
    });
  }
  if (kind === "executeProposal") {
    return intl.formatMessage({
      id: "ui.transactionFlow.executeTitle",
      defaultMessage: "Execute proposal",
    });
  }
  return intl.formatMessage({
    id: "ui.transactionFlow.voteTitle",
    defaultMessage: "Cast vote",
  });
}

function getDefaultDescription(
  intl: ReturnType<typeof useTreasuryIntl>,
  kind: TreasuryTransactionFlowKind,
): string {
  if (kind === "createProposal") {
    return intl.formatMessage({
      id: "ui.transactionFlow.createDescription",
      defaultMessage:
        "Review the proposal summary and confirm the transaction details before continuing.",
    });
  }
  if (kind === "executeProposal") {
    return intl.formatMessage({
      id: "ui.transactionFlow.executeDescription",
      defaultMessage:
        "Review the payout summary and confirm the transaction details before continuing.",
    });
  }
  return intl.formatMessage({
    id: "ui.transactionFlow.voteDescription",
    defaultMessage:
      "Review the vote summary and confirm the transaction details before continuing.",
  });
}

function getStepDefinitions(
  intl: ReturnType<typeof useTreasuryIntl>,
): Array<{ id: TreasuryTransactionFlowStepId; label: string; description: string }> {
  return [
    {
      id: "review",
      label: intl.formatMessage({
        id: "ui.transactionFlow.stepReview",
        defaultMessage: "Review",
      }),
      description: intl.formatMessage({
        id: "ui.transactionFlow.stepReviewDescription",
        defaultMessage:
          "Review the action details and adjust general transaction parameters before starting the flow.",
      }),
    },
    {
      id: "signAndSend",
      label: intl.formatMessage({
        id: "ui.transactionFlow.stepSignAndSend",
        defaultMessage: "Sign & send",
      }),
      description: intl.formatMessage({
        id: "ui.transactionFlow.stepSignAndSendDescription",
        defaultMessage:
          "Compile and prove first, then request a wallet signature and broadcast automatically through Auro.",
      }),
    },
    {
      id: "waitForInclusion",
      label: intl.formatMessage({
        id: "ui.transactionFlow.stepWaitForInclusion",
        defaultMessage: "Waiting for inclusion",
      }),
      description: intl.formatMessage({
        id: "ui.transactionFlow.stepWaitForInclusionDescription",
        defaultMessage:
          "Monitor the broadcast transaction hash until the network includes it, or close the dialog and keep watching in the background.",
      }),
    },
    {
      id: "postContent",
      label: intl.formatMessage({
        id: "ui.transactionFlow.stepPostContent",
        defaultMessage: "Post content",
      }),
      description: intl.formatMessage({
        id: "ui.transactionFlow.stepPostContentDescription",
        defaultMessage:
          "Wait for the processor projection, then retry proposal content attachment until it succeeds or reaches a terminal error.",
      }),
    },
  ];
}

function getStepOrder(showPostContentStep: boolean): TreasuryTransactionFlowStepId[] {
  return showPostContentStep
    ? ["review", "signAndSend", "waitForInclusion", "postContent"]
    : ["review", "signAndSend", "waitForInclusion"];
}

function getCompletedHeaderDescription(
  intl: ReturnType<typeof useTreasuryIntl>,
  showPostContentStep: boolean,
): string {
  if (showPostContentStep) {
    return intl.formatMessage({
      id: "ui.transactionFlow.stepCompletedWithContentDescription",
      defaultMessage:
        "The transaction was included on chain and proposal content was posted successfully.",
    });
  }

  return intl.formatMessage({
    id: "ui.transactionFlow.stepCompletedDescription",
    defaultMessage: "The transaction has been included on chain and no further monitoring is needed.",
  });
}

function getRunningButtonLabel(
  intl: ReturnType<typeof useTreasuryIntl>,
  activeStep: TreasuryTransactionFlowStepId | null,
): string {
  if (activeStep === "signAndSend") {
    return intl.formatMessage({
      id: "ui.transactionFlow.runningSignAndSend",
      defaultMessage: "Signing and sending",
    });
  }
  if (activeStep === "waitForInclusion") {
    return intl.formatMessage({
      id: "ui.transactionFlow.runningWaitForInclusion",
      defaultMessage: "Waiting for inclusion",
    });
  }
  if (activeStep === "postContent") {
    return intl.formatMessage({
      id: "ui.transactionFlow.runningPostContent",
      defaultMessage: "Posting content",
    });
  }
  return intl.formatMessage({
    id: "ui.transactionFlow.running",
    defaultMessage: "Running",
  });
}

async function runStep({
  currentRunId,
  stepId,
  onStep,
  setActiveStep,
  setStepStatuses,
  runIdRef,
}: {
  currentRunId: number;
  stepId: TreasuryTransactionFlowStepId;
  onStep: () => Promise<void>;
  setActiveStep: (step: TreasuryTransactionFlowStepId | null) => void;
  setStepStatuses: React.Dispatch<
    React.SetStateAction<Record<TreasuryTransactionFlowStepId, StepStatus>>
  >;
  runIdRef: React.MutableRefObject<number>;
}): Promise<void> {
  if (runIdRef.current !== currentRunId) {
    return;
  }
  setActiveStep(stepId);
  setStepStatuses((current) => ({
    ...current,
    [stepId]: "running",
  }));
  try {
    await onStep();
    if (runIdRef.current !== currentRunId) {
      return;
    }
    setStepStatuses((current) => ({
      ...current,
      [stepId]: "completed",
    }));
  } catch (error) {
    if (runIdRef.current === currentRunId) {
      setStepStatuses((current) => ({
        ...current,
        [stepId]: "error",
      }));
    }
    throw error;
  }
}

function parseFeeValue(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNonceValue(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error.message.trim() ? error : new Error("Transaction flow failed.");
  }
  if (typeof error === "string") {
    return new Error(error.trim() || "Transaction flow failed.");
  }
  return new Error("Transaction flow failed.");
}
