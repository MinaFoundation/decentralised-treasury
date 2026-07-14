import { AlertTriangle, RotateCw } from "lucide-react";
import {
  type FormEvent,
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTreasuryIntl } from "../../i18n";
import { cn } from "../../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { MinaAmountInput } from "../../components/ui/mina-amount-input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import {
  assertZkappUriWithinByteLimit,
  hashMarkdownContentToZkappUri,
} from "@repo/sdk/src/utils/proposal-content-hash.js";
import type { TreasuryLifecyclePeriodId } from "../lifecycle/lifecycle-period-info";

const DEFAULT_PROPOSAL_CONTENT_TEMPLATE = `## Summary

Describe the proposal intent and why treasury funding is needed.

## Scope of work

- deliverable 1
- deliverable 2
- deliverable 3

## Milestones

### Milestone 1

- outcome
- timing

### Milestone 2

- outcome
- timing

## Reporting

Explain how progress updates and final outcomes will be shared.`;

const PROPOSAL_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-4 text-2xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-3 mt-6 text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-5 text-lg font-semibold tracking-tight first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-4 leading-7 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-4 list-disc space-y-2 pl-6 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-6 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-7">{children}</li>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-4 border-l-2 border-border pl-4 italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="mb-4 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-sm last:mb-0">
      {children}
    </pre>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-border/70" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table className="w-full min-w-[28rem] border-collapse border border-border/70 text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-muted/30">{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="border-t border-border/70">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-border/70 px-3 py-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-border/70 px-3 py-2 align-top">{children}</td>
  ),
  input: ({ checked, type }: { checked?: boolean; type?: string }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        readOnly
        className="mr-2 translate-y-[1px]"
      />
    ) : (
      <input type={type} disabled readOnly />
    ),
};

export interface TreasuryProposalCreationDraft {
  lifecycleId: number | null;
  proposerAddress: string | null;
  content: string;
  amount: string;
  recipient: string;
}

export interface TreasuryProposalCreationFormProps {
  lifecycleId?: number | null;
  connectedWalletAddress?: string | null;
  currentPeriod?: TreasuryLifecyclePeriodId | null;
  treasuryBalance?: string | number | null;
  eligibleVotingWeight?: string | number | null;
  className?: string;
  initialTitle?: string;
  initialContent?: string;
  initialAmount?: string;
  initialRecipient?: string;
  submitLabel?: string;
  onSubmit?: (draft: TreasuryProposalCreationDraft) => void;
  onSaveDraft?: (draft: TreasuryProposalCreationDraft) => void;
  onConnectWalletClick?: () => void;
  onCancel?: () => void;
}

export function TreasuryProposalCreationForm({
  lifecycleId,
  connectedWalletAddress,
  currentPeriod,
  treasuryBalance,
  eligibleVotingWeight,
  className,
  initialTitle = "",
  initialContent = DEFAULT_PROPOSAL_CONTENT_TEMPLATE,
  initialAmount = "",
  initialRecipient = "",
  submitLabel,
  onSubmit,
  onSaveDraft,
  onConnectWalletClick,
  onCancel,
}: TreasuryProposalCreationFormProps): JSX.Element {
  const intl = useTreasuryIntl();
  const initialContentParts = useMemo(
    () => splitProposalMarkdown(initialContent),
    [initialContent],
  );
  const [title, setTitle] = useState(initialTitle || initialContentParts.title);
  const [content, setContent] = useState(initialContentParts.body);
  const [amount, setAmount] = useState(
    normalizeProposalAmountInput(initialAmount),
  );
  const [recipient, setRecipient] = useState(initialRecipient);
  const [contentTab, setContentTab] = useState<"write" | "preview">("write");
  const [proposalContractAddress, setProposalContractAddress] =
    useState<string>(() => generateProposalContractAddress());
  const [zkAppUriHash, setZkAppUriHash] = useState<string | null>(null);
  const [isZkAppUriHashLoading, setIsZkAppUriHashLoading] = useState(false);

  useEffect(() => {
    setTitle(initialTitle || initialContentParts.title);
  }, [initialContentParts.title, initialTitle]);

  useEffect(() => {
    setContent(initialContentParts.body);
  }, [initialContentParts.body]);

  useEffect(() => {
    setAmount(normalizeProposalAmountInput(initialAmount));
  }, [initialAmount]);

  useEffect(() => {
    setRecipient(initialRecipient);
  }, [initialRecipient]);

  const normalizedWalletAddress = connectedWalletAddress?.trim() ?? "";
  const hasConnectedWallet = normalizedWalletAddress.length > 0;
  const normalizedTitle = title.trim();
  const normalizedContent = content.trim();
  const markdownContent = buildProposalMarkdown(
    normalizedTitle,
    normalizedContent,
  );
  const previewMarkdownContent = normalizedContent;
  const normalizedRecipient = recipient.trim();
  const parsedAmountValue = parseProposalAmount(amount);
  const derivedBondAmount =
    parsedAmountValue !== null ? Math.floor(parsedAmountValue / 10) : null;
  const votingRequirementEstimate = useMemo(
    () =>
      calculateVotingRequirementEstimate({
        proposalAmount: parsedAmountValue,
        treasuryBalance,
        eligibleVotingWeight,
      }),
    [eligibleVotingWeight, parsedAmountValue, treasuryBalance],
  );

  const walletError = !hasConnectedWallet
    ? intl.formatMessage({
        id: "ui.proposalCreation.walletRequired",
        defaultMessage:
          "Connect the proposer wallet before creating a proposal.",
      })
    : null;
  const titleError =
    normalizedTitle.length === 0
      ? intl.formatMessage({
          id: "ui.proposalCreation.titleRequired",
          defaultMessage: "Enter a proposal title.",
        })
      : null;
  const contentError =
    normalizedContent.length === 0
      ? intl.formatMessage({
          id: "ui.proposalCreation.contentRequired",
          defaultMessage: "Enter proposal content in markdown.",
        })
      : null;
  const amountError =
    amount.trim().length === 0
      ? intl.formatMessage({
          id: "ui.proposalCreation.amountRequired",
          defaultMessage: "Enter a requested amount.",
        })
      : parsedAmountValue === null
        ? intl.formatMessage({
            id: "ui.proposalCreation.amountInvalid",
            defaultMessage: "Enter a valid MINA amount.",
          })
        : parsedAmountValue <= 0
          ? intl.formatMessage({
              id: "ui.proposalCreation.amountNonPositive",
              defaultMessage: "Requested amount must be greater than zero.",
            })
          : null;
  const recipientError =
    normalizedRecipient.length === 0
      ? intl.formatMessage({
          id: "ui.proposalCreation.recipientRequired",
          defaultMessage: "Enter a recipient address.",
        })
      : null;

  const canSubmit =
    walletError === null &&
    titleError === null &&
    contentError === null &&
    amountError === null &&
    recipientError === null;
  const canSubmitWithoutWallet =
    titleError === null &&
    contentError === null &&
    amountError === null &&
    recipientError === null;
  const canCreateProposal =
    currentPeriod == null || currentPeriod === "proposal";
  const isDraftOnlyPeriod = !canCreateProposal;
  const resolvedSubmitLabel = isDraftOnlyPeriod
    ? intl.formatMessage({
        id: "ui.proposalCreation.saveDraft",
        defaultMessage: "Save as draft",
      })
    : (submitLabel ??
      intl.formatMessage({
        id: "ui.proposalCreation.submit",
        defaultMessage: "Create proposal",
      }));
  const primaryActionLabel = !hasConnectedWallet
    ? intl.formatMessage({
        id: "ui.proposalCreation.connectWalletCta",
        defaultMessage: "Connect proposer wallet",
      })
    : resolvedSubmitLabel;
  const lifecycleLabel = intl.formatMessage({
    id: "ui.proposalCreation.lifecycleLabel",
    defaultMessage: "Lifecycle",
  });
  const proposerWalletLabel = intl.formatMessage({
    id: "ui.proposalCreation.proposerWalletLabel",
    defaultMessage: "Proposer wallet",
  });
  const titleLabel = intl.formatMessage({
    id: "ui.proposalCreation.titleField",
    defaultMessage: "Title",
  });
  const amountLabel = intl.formatMessage({
    id: "ui.proposalCreation.amountField",
    defaultMessage: "Amount",
  });
  const recipientLabel = intl.formatMessage({
    id: "ui.proposalCreation.recipientField",
    defaultMessage: "Recipient",
  });
  const contentLabel = intl.formatMessage({
    id: "ui.proposalCreation.contentField",
    defaultMessage: "Content",
  });

  useEffect(() => {
    let cancelled = false;

    if (markdownContent.length === 0) {
      setZkAppUriHash(null);
      setIsZkAppUriHashLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsZkAppUriHashLoading(true);
    void computeProposalZkAppUriHash(markdownContent)
      .then((nextHash) => {
        if (cancelled) {
          return;
        }
        setZkAppUriHash(nextHash);
        setIsZkAppUriHashLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setZkAppUriHash(null);
        setIsZkAppUriHashLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [markdownContent]);

  const createDraftPayload = (): TreasuryProposalCreationDraft => ({
    lifecycleId: lifecycleId ?? null,
    proposerAddress: hasConnectedWallet ? normalizedWalletAddress : null,
    content: markdownContent,
    amount: formatProposalAmountForSubmit(parsedAmountValue),
    recipient: normalizedRecipient,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const draft = createDraftPayload();
    if (isDraftOnlyPeriod) {
      onSaveDraft?.(draft);
      return;
    }
    onSubmit?.(draft);
  };

  const handleSaveDraftClick = (): void => {
    if (!canSubmitWithoutWallet) {
      return;
    }
    onSaveDraft?.(createDraftPayload());
  };

  return (
    <form className={cn("space-y-6", className)} onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <CardTitle className="text-2xl sm:text-[2rem]">
          {intl.formatMessage({
            id: "ui.proposalCreation.title",
            defaultMessage: "Create proposal",
          })}
        </CardTitle>
        <CardDescription className="max-w-3xl text-[15px] leading-6 text-foreground/70">
          {intl.formatMessage({
            id: "ui.proposalCreation.description",
            defaultMessage:
              "Draft a treasury proposal with lifecycle context, markdown content preview, and derived submission details.",
          })}
        </CardDescription>
      </div>

      {isDraftOnlyPeriod ? (
        <Alert variant="warning" className="flex items-start gap-3 py-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <AlertTitle>
              {intl.formatMessage({
                id: "ui.proposalCreation.draftOnlyTitle",
                defaultMessage: "Proposal submissions are not open",
              })}
            </AlertTitle>
            <AlertDescription>
              {intl.formatMessage(
                {
                  id: "ui.proposalCreation.draftOnlyDescription",
                  defaultMessage:
                    "The current lifecycle (Lifecycle {id}) is currently in the {period} period. You can save this proposal as a draft and submit it once the proposal period begins.",
                },
                {
                  id: lifecycleId ?? "-",
                  period: formatLifecyclePeriod(currentPeriod),
                },
              )}
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr),minmax(20rem,0.95fr)]">
        <Card className="h-full rounded-2xl shadow-none">
          <CardContent className="flex h-full flex-col space-y-6 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell label={lifecycleLabel}>
                <Input
                  value={
                    lifecycleId != null
                      ? intl.formatMessage(
                          {
                            id: "ui.proposalCreation.lifecycleValue",
                            defaultMessage: "Lifecycle {id}",
                          },
                          { id: lifecycleId },
                        )
                      : intl.formatMessage({
                          id: "ui.proposalCreation.lifecyclePending",
                          defaultMessage: "Computed automatically",
                        })
                  }
                  disabled
                  aria-label={lifecycleLabel}
                />
              </FieldShell>
              <FieldShell label={proposerWalletLabel}>
                <Input
                  value={
                    hasConnectedWallet
                      ? normalizedWalletAddress
                      : intl.formatMessage({
                          id: "ui.proposalCreation.walletMissing",
                          defaultMessage: "Connect wallet to continue",
                        })
                  }
                  disabled
                  className={cn(hasConnectedWallet && "font-mono text-xs")}
                  aria-label={proposerWalletLabel}
                />
              </FieldShell>
            </div>

            <FieldShell label={titleLabel} error={titleError}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={intl.formatMessage({
                  id: "ui.proposalCreation.titlePlaceholder",
                  defaultMessage: "Enter a concise proposal title",
                })}
                aria-label={titleLabel}
                aria-invalid={titleError ? "true" : "false"}
              />
            </FieldShell>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell label={amountLabel} error={amountError}>
                <MinaAmountInput
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={intl.formatMessage({
                    id: "ui.proposalCreation.amountPlaceholder",
                    defaultMessage: "0",
                  })}
                  aria-label={amountLabel}
                  aria-invalid={amountError ? "true" : "false"}
                />
              </FieldShell>
              <FieldShell label={recipientLabel} error={recipientError}>
                <Input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder={intl.formatMessage({
                    id: "ui.proposalCreation.recipientPlaceholder",
                    defaultMessage: "Enter recipient public key",
                  })}
                  aria-label={recipientLabel}
                  aria-invalid={recipientError ? "true" : "false"}
                />
              </FieldShell>
            </div>

            <FieldShell
              label={contentLabel}
              description={intl.formatMessage({
                id: "ui.proposalCreation.contentDescription",
                defaultMessage:
                  "Use markdown for sections, lists, and headings. Start from the template and adapt it to the proposal.",
              })}
              error={contentError}
              className="flex flex-1 flex-col"
            >
              <Tabs
                value={contentTab}
                onValueChange={(value) =>
                  setContentTab(value as "write" | "preview")
                }
                className="flex flex-1 flex-col space-y-2"
              >
                <TabsList className="self-start">
                  <TabsTrigger value="write">
                    {intl.formatMessage({
                      id: "ui.proposalCreation.writeTab",
                      defaultMessage: "Write",
                    })}
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    {intl.formatMessage({
                      id: "ui.proposalCreation.previewTab",
                      defaultMessage: "Preview",
                    })}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="mt-0 flex-1">
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    className={cn(
                      "min-h-[22rem] h-full w-full resize-none rounded-xl border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      contentError && "border-destructive/50",
                    )}
                    aria-label={contentLabel}
                    aria-invalid={contentError ? "true" : "false"}
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-0 flex-1">
                  <div
                    className="h-full min-h-[22rem] rounded-xl border border-border/70 bg-background px-4 py-4"
                    data-component="proposal-creation-markdown-preview"
                  >
                    {previewMarkdownContent ? (
                      <div className="text-sm text-foreground">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={PROPOSAL_MARKDOWN_COMPONENTS}
                        >
                          {previewMarkdownContent}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {intl.formatMessage({
                          id: "ui.proposalCreation.previewEmpty",
                          defaultMessage:
                            "Markdown preview will appear here once content is entered.",
                        })}
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </FieldShell>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {intl.formatMessage({
                  id: "ui.proposalCreation.votingEstimateTitle",
                  defaultMessage: "Voting requirement estimate",
                })}
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-foreground/70">
                {intl.formatMessage({
                  id: "ui.proposalCreation.votingEstimateDescription",
                  defaultMessage:
                    "Estimated from the requested amount, current treasury balance, and current eligible voting weight.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryParticipationEstimate",
                  defaultMessage: "Participation estimate",
                })}
                value={
                  votingRequirementEstimate
                    ? intl.formatMessage(
                        {
                          id: "ui.proposalCreation.summaryParticipationEstimateValue",
                          defaultMessage:
                            "{percent} of eligible voting weight ({amount})",
                        },
                        {
                          percent: formatBasisPointsPercent(
                            votingRequirementEstimate.requiredParticipationBp,
                          ),
                          amount: formatVoteCriteriaAmount(
                            votingRequirementEstimate.requiredParticipationWeight,
                          ),
                        },
                      )
                    : "-"
                }
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryApprovalEstimate",
                  defaultMessage: "Approval estimate",
                })}
                value={
                  votingRequirementEstimate
                    ? intl.formatMessage(
                        {
                          id: "ui.proposalCreation.summaryApprovalEstimateValue",
                          defaultMessage: "{percent} yay over nay",
                        },
                        {
                          percent: formatBasisPointsPercent(
                            votingRequirementEstimate.requiredApprovalBp,
                          ),
                        },
                      )
                    : "-"
                }
              />
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {intl.formatMessage({
                  id: "ui.proposalCreation.summaryTitle",
                  defaultMessage: "Submission summary",
                })}
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-foreground/70">
                {intl.formatMessage({
                  id: "ui.proposalCreation.summaryDescription",
                  defaultMessage:
                    "Review the proposal details and submission context before continuing.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryLifecycle",
                  defaultMessage: "Lifecycle",
                })}
                value={
                  lifecycleId != null
                    ? intl.formatMessage(
                        {
                          id: "ui.proposalCreation.summaryLifecycleValue",
                          defaultMessage: "Lifecycle {id}",
                        },
                        { id: lifecycleId },
                      )
                    : intl.formatMessage({
                        id: "ui.proposalCreation.summaryLifecyclePending",
                        defaultMessage: "Computed automatically",
                      })
                }
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryProposerWallet",
                  defaultMessage: "Proposer wallet",
                })}
                value={
                  hasConnectedWallet
                    ? normalizedWalletAddress
                    : intl.formatMessage({
                        id: "ui.proposalCreation.summaryWalletMissing",
                        defaultMessage: "Wallet not connected",
                      })
                }
                mono={hasConnectedWallet}
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryProposalContractAddress",
                  defaultMessage: "Proposal contract address",
                })}
                value={proposalContractAddress}
                description={intl.formatMessage({
                  id: "ui.proposalCreation.summaryProposalContractAddressDescription",
                  defaultMessage:
                    "Generated automatically during submission. The temporary private key is discarded automatically.",
                })}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-sm text-muted-foreground"
                    aria-label={intl.formatMessage({
                      id: "ui.proposalCreation.regenerateProposalContractAddress",
                      defaultMessage: "Regenerate proposal contract address",
                    })}
                    onClick={() => {
                      setProposalContractAddress(
                        generateProposalContractAddress(),
                      );
                    }}
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                }
                mono
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryRequestedAmount",
                  defaultMessage: "Requested amount",
                })}
                value={
                  parsedAmountValue !== null
                    ? formatProposalAmount(parsedAmountValue)
                    : "-"
                }
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryBondAmount",
                  defaultMessage: "Derived bond amount",
                })}
                value={
                  derivedBondAmount !== null
                    ? formatProposalAmount(derivedBondAmount)
                    : "-"
                }
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryRecipient",
                  defaultMessage: "Recipient",
                })}
                value={normalizedRecipient || "-"}
                mono={normalizedRecipient.length > 0}
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryTitle",
                  defaultMessage: "Title",
                })}
                value={normalizedTitle || "-"}
              />
              <SummaryRow
                label={intl.formatMessage({
                  id: "ui.proposalCreation.summaryZkAppUriHash",
                  defaultMessage: "zkApp URI hash",
                })}
                value={
                  isZkAppUriHashLoading
                    ? intl.formatMessage({
                        id: "ui.proposalCreation.summaryZkAppUriHashLoading",
                        defaultMessage: "Computing...",
                      })
                    : (zkAppUriHash ?? "-")
                }
                mono
              />

              <Alert variant="default" className="border-border/70 bg-muted/20">
                <AlertTitle>
                  {intl.formatMessage({
                    id: "ui.proposalCreation.reviewReminderTitle",
                    defaultMessage: "Before submitting",
                  })}
                </AlertTitle>
                <AlertDescription>
                  {intl.formatMessage({
                    id: "ui.proposalCreation.reviewReminder",
                    defaultMessage:
                      "Confirm the title, markdown body, recipient, amount, current lifecycle, and connected proposer wallet before creating the proposal.",
                  })}
                </AlertDescription>
              </Alert>

              <div className="flex flex-col items-stretch gap-2 pt-1">
                <Button
                  type={!hasConnectedWallet ? "button" : "submit"}
                  disabled={
                    !hasConnectedWallet ? !onConnectWalletClick : !canSubmit
                  }
                  onClick={
                    !hasConnectedWallet ? onConnectWalletClick : undefined
                  }
                  className="h-11 w-full px-5 text-sm font-semibold"
                >
                  {primaryActionLabel}
                </Button>
                {!isDraftOnlyPeriod && onSaveDraft ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canSubmitWithoutWallet}
                    onClick={handleSaveDraftClick}
                    className="h-auto self-center px-0 py-0 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                  >
                    {intl.formatMessage({
                      id: "ui.proposalCreation.saveDraft",
                      defaultMessage: "Save as draft",
                    })}
                  </Button>
                ) : null}
                {onCancel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCancel}
                    className="h-auto self-center px-0 py-0 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                  >
                    {intl.formatMessage({
                      id: "ui.proposalCreation.cancel",
                      defaultMessage: "Cancel",
                    })}
                  </Button>
                ) : null}
                {!hasConnectedWallet && canSubmitWithoutWallet ? (
                  <p className="text-sm text-muted-foreground">{walletError}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

function FieldShell({
  label,
  description,
  error,
  className,
  children,
}: {
  label: string;
  description?: string;
  error?: string | null;
  className?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {children}
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  description,
  action,
  mono = false,
}: {
  label: string;
  value: string;
  description?: string;
  action?: JSX.Element;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {action}
      </div>
      <p
        className={cn(
          "text-sm text-foreground",
          mono && "break-all font-mono text-xs",
        )}
      >
        {value}
      </p>
      {description ? (
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function parseProposalAmount(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProposalAmountInput(value: string): string {
  return value.replace(/,/g, "").trim();
}

function formatProposalAmount(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 9,
  }).format(value)} MINA`;
}

function formatVoteCriteriaAmount(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)} MINA`;
}

function formatBasisPointsPercent(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

function formatProposalAmountForSubmit(value: number | null): string {
  if (value === null) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 9,
  }).format(value);
}

async function computeProposalZkAppUriHash(markdown: string): Promise<string> {
  const markdownBytes = new TextEncoder().encode(markdown);
  const zkAppUri = await hashMarkdownContentToZkappUri(markdownBytes);
  assertZkappUriWithinByteLimit(zkAppUri);
  const o1jsModule = await import("o1js");
  const ZkappUri = (
    o1jsModule as {
      ZkappUri: {
        from(value: string): { hash: { toString(): string } };
      };
    }
  ).ZkappUri;
  return ZkappUri.from(zkAppUri).hash.toString();
}

function buildProposalMarkdown(title: string, body: string): string {
  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  if (!normalizedTitle) {
    return normalizedBody;
  }
  if (!normalizedBody) {
    return `# ${normalizedTitle}`;
  }
  return `# ${normalizedTitle}\n\n${normalizedBody}`;
}

function splitProposalMarkdown(markdown: string): {
  title: string;
  body: string;
} {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) {
    return { title: "", body: "" };
  }

  const match = normalizedMarkdown.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  if (!match) {
    return { title: "", body: normalizedMarkdown };
  }

  return {
    title: match[1]?.trim() ?? "",
    body: normalizedMarkdown.slice(match[0].length).replace(/^\s+/, ""),
  };
}

function generateProposalContractAddress(): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const prefix = "B62q";
  const length = 51;
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let suffix = "";
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }
  return `${prefix}${suffix}`;
}

function formatLifecyclePeriod(
  value: TreasuryLifecyclePeriodId | null | undefined,
): string {
  if (value === "proposal") {
    return "proposal";
  }
  if (value === "exploration") {
    return "exploration";
  }
  if (value === "voting") {
    return "voting";
  }
  if (value === "cooldown") {
    return "cooldown";
  }
  return "current";
}

function calculateVotingRequirementEstimate({
  proposalAmount,
  treasuryBalance,
  eligibleVotingWeight,
}: {
  proposalAmount: number | null;
  treasuryBalance?: string | number | null;
  eligibleVotingWeight?: string | number | null;
}): {
  requiredParticipationBp: number;
  requiredApprovalBp: number;
  requiredParticipationWeight: number;
} | null {
  const parsedTreasuryBalance = parseContextAmount(treasuryBalance);
  const parsedEligibleVotingWeight = parseContextAmount(eligibleVotingWeight);
  if (
    proposalAmount === null ||
    proposalAmount <= 0 ||
    parsedTreasuryBalance === null ||
    parsedTreasuryBalance <= 0 ||
    parsedEligibleVotingWeight === null ||
    parsedEligibleVotingWeight <= 0
  ) {
    return null;
  }

  const basisPoints = 10_000;
  const ratioBp = Math.min(
    (proposalAmount * basisPoints) / parsedTreasuryBalance,
    basisPoints,
  );
  const participationCurveDenominator =
    ratioBp + (500 * (basisPoints - ratioBp)) / basisPoints;
  const participationCurveBp =
    (ratioBp * basisPoints) / participationCurveDenominator;
  const approvalCurveDenominator =
    ratioBp + (1000 * (basisPoints - ratioBp)) / basisPoints;
  const approvalCurveBp = (ratioBp * basisPoints) / approvalCurveDenominator;

  const requiredParticipationBp =
    2_000 + ((5_000 - 2_000) * participationCurveBp) / basisPoints;
  const requiredApprovalBp =
    5_100 + ((7_000 - 5_100) * approvalCurveBp) / basisPoints;

  return {
    requiredParticipationBp,
    requiredApprovalBp,
    requiredParticipationWeight:
      (parsedEligibleVotingWeight * requiredParticipationBp) / basisPoints,
  };
}

function parseContextAmount(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]/g, "").trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
