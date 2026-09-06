import { type JSX, useId, useState } from "react";
import { Settings } from "lucide-react";
import { useTreasuryIntl } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

export interface TreasuryEndpointSettings {
  networkId?: string;
  apiUrl: string;
  indexerApiUrl: string;
  processorApiUrl: string;
  minaNodeUrl: string;
}

export interface TreasurySettingsDialogProps {
  value?: TreasuryEndpointSettings;
  defaultValue?: TreasuryEndpointSettings;
  triggerLabel?: string;
  triggerClassName?: string;
  iconOnly?: boolean;
  onChange?: (value: TreasuryEndpointSettings) => void;
  onSave?: (value: TreasuryEndpointSettings) => void;
}

function updateSettingsField(
  settings: TreasuryEndpointSettings,
  field: keyof TreasuryEndpointSettings,
  value: string,
): TreasuryEndpointSettings {
  return { ...settings, [field]: value };
}

function areSettingsEqual(
  left: TreasuryEndpointSettings,
  right: TreasuryEndpointSettings,
): boolean {
  return (
    left.networkId === right.networkId &&
    left.apiUrl === right.apiUrl &&
    left.indexerApiUrl === right.indexerApiUrl &&
    left.processorApiUrl === right.processorApiUrl &&
    left.minaNodeUrl === right.minaNodeUrl
  );
}

function isLikelyValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function TreasurySettingsDialog({
  value,
  defaultValue,
  triggerLabel,
  triggerClassName,
  iconOnly = false,
  onChange,
  onSave,
}: TreasurySettingsDialogProps): JSX.Element {
  const intl = useTreasuryIntl();
  const initialValue = {
    networkId: defaultValue?.networkId,
    apiUrl: defaultValue?.apiUrl ?? "",
    indexerApiUrl: defaultValue?.indexerApiUrl ?? "",
    processorApiUrl: defaultValue?.processorApiUrl ?? "",
    minaNodeUrl: defaultValue?.minaNodeUrl ?? "",
  };
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] =
    useState<TreasuryEndpointSettings>(initialValue);
  const [draftValue, setDraftValue] = useState<TreasuryEndpointSettings>({
    networkId: value?.networkId ?? initialValue.networkId,
    apiUrl: value?.apiUrl ?? initialValue.apiUrl,
    indexerApiUrl: value?.indexerApiUrl ?? initialValue.indexerApiUrl,
    processorApiUrl: value?.processorApiUrl ?? initialValue.processorApiUrl,
    minaNodeUrl: value?.minaNodeUrl ?? initialValue.minaNodeUrl,
  });
  const currentValue = {
    networkId: value?.networkId ?? internalValue.networkId,
    apiUrl: value?.apiUrl ?? internalValue.apiUrl,
    indexerApiUrl: value?.indexerApiUrl ?? internalValue.indexerApiUrl,
    processorApiUrl: value?.processorApiUrl ?? internalValue.processorApiUrl,
    minaNodeUrl: value?.minaNodeUrl ?? internalValue.minaNodeUrl,
  };

  const resolvedTriggerLabel =
    triggerLabel ??
    intl.formatMessage({
      id: "ui.header.settings.trigger",
      defaultMessage: "Settings",
    });

  const dialogDescriptionId = useId();
  const apiUrlValid = isLikelyValidUrl(draftValue.apiUrl);
  const indexerApiUrlValid = isLikelyValidUrl(draftValue.indexerApiUrl);
  const processorApiUrlValid = isLikelyValidUrl(draftValue.processorApiUrl);
  const minaNodeUrlValid = isLikelyValidUrl(draftValue.minaNodeUrl);
  const canSave =
    apiUrlValid &&
    indexerApiUrlValid &&
    processorApiUrlValid &&
    minaNodeUrlValid;
  const canReset = !areSettingsEqual(draftValue, initialValue);

  const applyChange = (next: TreasuryEndpointSettings): void => {
    setDraftValue(next);
    onChange?.(next);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraftValue(currentValue);
      return;
    }
    setDraftValue(currentValue);
  };

  const handleCancel = (): void => {
    setDraftValue(currentValue);
    setOpen(false);
  };

  const handleSave = (): void => {
    if (!canSave) {
      return;
    }

    if (value === undefined) {
      setInternalValue(draftValue);
    }
    onSave?.(draftValue);
    setOpen(false);
  };

  const handleReset = (): void => {
    applyChange(initialValue);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? "icon" : "sm"}
          className={cn(
            iconOnly
              ? "h-9 w-9 rounded-sm border-border bg-background hover:bg-muted hover:text-foreground"
              : "rounded-sm px-3",
            triggerClassName,
          )}
          aria-label={resolvedTriggerLabel}
        >
          <Settings
            className={cn("h-4 w-4", iconOnly ? "" : "mr-1.5")}
            aria-hidden="true"
          />
          {iconOnly ? (
            <span className="sr-only">{resolvedTriggerLabel}</span>
          ) : (
            resolvedTriggerLabel
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={dialogDescriptionId}
        className="max-h-[85vh] overflow-y-auto p-4 sm:p-5"
      >
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: "ui.header.settings.title",
              defaultMessage: "Dashboard settings",
            })}
          </DialogTitle>
          <DialogDescription id={dialogDescriptionId}>
            {intl.formatMessage({
              id: "ui.header.settings.description",
              defaultMessage:
                "Configure the service endpoints used by this application.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="treasury-settings-api-url"
              className="text-sm font-medium"
            >
              {intl.formatMessage({
                id: "ui.header.settings.apiUrl.label",
                defaultMessage: "API URL",
              })}
            </label>
            <Input
              id="treasury-settings-api-url"
              type="url"
              value={draftValue.apiUrl}
              placeholder={intl.formatMessage({
                id: "ui.header.settings.apiUrl.placeholder",
                defaultMessage: "https://api.example.com",
              })}
              onChange={(event) =>
                applyChange(
                  updateSettingsField(draftValue, "apiUrl", event.target.value),
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({
                id: "ui.header.settings.urlHelp",
                defaultMessage: "Use a full URL including http:// or https://.",
              })}
            </p>
            {!apiUrlValid ? (
              <p className="text-xs text-destructive">
                {intl.formatMessage({
                  id: "ui.header.settings.invalidUrl",
                  defaultMessage:
                    "Please enter a valid URL with http:// or https://.",
                })}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="treasury-settings-indexer-api-url"
              className="text-sm font-medium"
            >
              {intl.formatMessage({
                id: "ui.header.settings.indexerApiUrl.label",
                defaultMessage: "Indexer API URL",
              })}
            </label>
            <Input
              id="treasury-settings-indexer-api-url"
              type="url"
              value={draftValue.indexerApiUrl}
              placeholder={intl.formatMessage({
                id: "ui.header.settings.indexerApiUrl.placeholder",
                defaultMessage: "https://treasury.example.com/indexer",
              })}
              onChange={(event) =>
                applyChange(
                  updateSettingsField(
                    draftValue,
                    "indexerApiUrl",
                    event.target.value,
                  ),
                )
              }
            />
            {!indexerApiUrlValid ? (
              <p className="text-xs text-destructive">
                {intl.formatMessage({
                  id: "ui.header.settings.invalidUrl",
                  defaultMessage:
                    "Please enter a valid URL with http:// or https://.",
                })}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="treasury-settings-processor-api-url"
              className="text-sm font-medium"
            >
              {intl.formatMessage({
                id: "ui.header.settings.processorApiUrl.label",
                defaultMessage: "Processor API URL",
              })}
            </label>
            <Input
              id="treasury-settings-processor-api-url"
              type="url"
              value={draftValue.processorApiUrl}
              placeholder={intl.formatMessage({
                id: "ui.header.settings.processorApiUrl.placeholder",
                defaultMessage: "https://treasury.example.com/processor",
              })}
              onChange={(event) =>
                applyChange(
                  updateSettingsField(
                    draftValue,
                    "processorApiUrl",
                    event.target.value,
                  ),
                )
              }
            />
            {!processorApiUrlValid ? (
              <p className="text-xs text-destructive">
                {intl.formatMessage({
                  id: "ui.header.settings.invalidUrl",
                  defaultMessage:
                    "Please enter a valid URL with http:// or https://.",
                })}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="treasury-settings-mina-node-url"
              className="text-sm font-medium"
            >
              {intl.formatMessage({
                id: "ui.header.settings.minaNodeUrl.label",
                defaultMessage: "Mina node URL",
              })}
            </label>
            <Input
              id="treasury-settings-mina-node-url"
              type="url"
              value={draftValue.minaNodeUrl}
              placeholder={intl.formatMessage({
                id: "ui.header.settings.minaNodeUrl.placeholder",
                defaultMessage: "https://berkeley.minascan.io/graphql",
              })}
              onChange={(event) =>
                applyChange(
                  updateSettingsField(
                    draftValue,
                    "minaNodeUrl",
                    event.target.value,
                  ),
                )
              }
            />
            {!minaNodeUrlValid ? (
              <p className="text-xs text-destructive">
                {intl.formatMessage({
                  id: "ui.header.settings.invalidUrl",
                  defaultMessage:
                    "Please enter a valid URL with http:// or https://.",
                })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="mt-5 flex-col-reverse sm:flex-row">
          <Button
            variant="ghost"
            className="w-full sm:mr-auto sm:w-auto"
            onClick={handleReset}
            disabled={!canReset}
          >
            {intl.formatMessage({
              id: "ui.header.settings.reset",
              defaultMessage: "Reset",
            })}
          </Button>
          <DialogClose asChild>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleCancel}
            >
              {intl.formatMessage({
                id: "ui.header.settings.cancel",
                defaultMessage: "Cancel",
              })}
            </Button>
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            {intl.formatMessage({
              id: "ui.header.settings.save",
              defaultMessage: "Save settings",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
