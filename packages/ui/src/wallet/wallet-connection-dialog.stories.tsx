import { WalletConnectionDialog } from "./wallet-connection-dialog";

const pendingConnection = () => new Promise<void>(() => undefined);

const meta = {
  title: "Wallet/WalletConnectionDialog",
  component: WalletConnectionDialog,
  parameters: {
    layout: "centered",
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
    onConnect: async () => undefined,
    onInstallAuro: () => undefined,
    auroInstalled: true,
    ledgerSupported: true,
  },
};

export default meta;
type PlayContext = { canvasElement: HTMLElement };

function findTab(canvasElement: HTMLElement, name: string): HTMLButtonElement {
  const tab = Array.from(
    canvasElement.ownerDocument.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ),
  ).find((candidate) => candidate.textContent?.trim() === name);
  if (!tab) throw new Error(`Tab ${name} was not found.`);
  return tab;
}

function findButton(
  canvasElement: HTMLElement,
  name: string,
): HTMLButtonElement {
  const button = Array.from(
    canvasElement.ownerDocument.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`Button ${name} was not found.`);
  return button;
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 20));
}

async function selectLedger(canvasElement: HTMLElement) {
  const ledgerTab = findTab(canvasElement, "Ledger");
  ledgerTab.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  ledgerTab.click();
  await waitForRender();
}

export const AuroInstalled = {};

export const AuroNotInstalled = {
  args: {
    auroInstalled: false,
  },
};

export const AuroPrompting = {
  args: {
    onConnect: pendingConnection,
  },
  play: async ({ canvasElement }: PlayContext) => {
    findButton(canvasElement, "Connect").click();
    await waitForRender();
  },
};

export const AuroError = {
  args: {
    onConnect: async () => {
      throw new Error("Auro connection was rejected.");
    },
  },
  play: async ({ canvasElement }: PlayContext) => {
    findButton(canvasElement, "Connect").click();
    await waitForRender();
  },
};

export const LedgerSupported = {
  play: async ({ canvasElement }: PlayContext) => {
    await selectLedger(canvasElement);
  },
};

export const LedgerNotSupported = {
  args: {
    ledgerSupported: false,
  },
  play: async ({ canvasElement }: PlayContext) => {
    await selectLedger(canvasElement);
  },
};

export const LedgerPrompting = {
  args: {
    onConnect: pendingConnection,
  },
  play: async ({ canvasElement }: PlayContext) => {
    await selectLedger(canvasElement);
    findButton(canvasElement, "Connect").click();
    await waitForRender();
  },
};

export const LedgerError = {
  args: {
    onConnect: async () => {
      throw new Error("Ledger device access was rejected.");
    },
  },
  play: async ({ canvasElement }: PlayContext) => {
    await selectLedger(canvasElement);
    findButton(canvasElement, "Connect").click();
    await waitForRender();
  },
};
