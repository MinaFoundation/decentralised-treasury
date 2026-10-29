import { useId } from "react";
import { Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  defaultProposalAcknowledgements,
  type ProposalAcknowledgementsConfig,
  type ProposalAcknowledgementText,
} from "./proposal-acknowledgements-config";

export type ProposalAcknowledgementsValue = { kyc: boolean; terms: boolean };

export function ProposalAcknowledgements({
  value,
  onChange,
  config = defaultProposalAcknowledgements,
}: {
  value: ProposalAcknowledgementsValue;
  onChange: (value: ProposalAcknowledgementsValue) => void;
  config?: ProposalAcknowledgementsConfig;
}) {
  const id = useId();

  return (
    <fieldset className="space-y-4 border-t border-border/70 pt-4">
      <legend className="sr-only">{config.title}</legend>
      <div className="space-y-1">
        <p className="text-sm font-semibold" aria-hidden="true">
          {config.title}
        </p>
        <p id={`${id}-description`} className="text-sm text-foreground/70">
          {config.description}
        </p>
      </div>
      {(["kyc", "terms"] as const).map((key) => {
        return (
          <div key={key} className="flex items-start gap-3">
            <span className="relative mt-1 h-4 w-4 shrink-0">
              <input
                id={`${id}-${key}`}
                type="checkbox"
                required
                checked={value[key]}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.checked })
                }
                aria-describedby={`${id}-description`}
                className="peer block h-4 w-4 cursor-pointer appearance-none rounded-[3px] border border-muted-foreground bg-background checked:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring forced-colors:appearance-auto"
              />
              <Check
                aria-hidden="true"
                strokeWidth={3}
                className="pointer-events-none absolute inset-0.5 h-3 w-3 text-primary opacity-0 peer-checked:opacity-100 forced-colors:hidden"
              />
            </span>
            <div className="min-w-0 text-sm leading-6">
              <label htmlFor={`${id}-${key}`} className="cursor-pointer">
                {key === "kyc" ? (
                  config.kyc.label
                ) : (
                  <AcknowledgementText text={config.terms.text} />
                )}
              </label>{" "}
              {key === "kyc" ? (
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${config.readMoreLabel}: ${config.kyc.title}`}
                      className="rounded-sm font-medium underline underline-offset-4 hover:text-foreground/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                    >
                      {config.readMoreLabel}
                    </button>
                  </DialogTrigger>
                  <DialogContent
                    aria-describedby={undefined}
                    className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
                  >
                    <DialogHeader className="shrink-0 border-b px-5 py-5 sm:px-6">
                      <DialogTitle className="leading-6">
                        {config.kyc.title}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 space-y-6 overflow-y-auto break-words px-5 py-5 text-sm leading-6 sm:px-6">
                      {config.kyc.sections.map((section, index) => (
                        <section key={index} className="space-y-3">
                          {section.title ? (
                            <h3 className="font-semibold">{section.title}</h3>
                          ) : null}
                          {section.paragraphs.map((text, paragraphIndex) => (
                            <p key={paragraphIndex}>
                              <AcknowledgementText text={text} />
                            </p>
                          ))}
                        </section>
                      ))}
                    </div>
                    <DialogFooter className="mt-0 shrink-0 border-t px-5 py-4 sm:px-6">
                      <DialogClose asChild>
                        <Button type="button" variant="outline">
                          {config.closeLabel}
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function AcknowledgementText({ text }: { text: ProposalAcknowledgementText }) {
  return text.map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm font-medium underline underline-offset-4 hover:text-foreground/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {part.label}
      </a>
    ),
  );
}
