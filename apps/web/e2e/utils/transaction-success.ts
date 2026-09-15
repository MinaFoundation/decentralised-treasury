import type { ConsoleMessage, Page } from "@playwright/test";

/** Fail on the real dialog's failure event instead of waiting for a success URL. */
export async function expectTransactionSuccess<T>(
  page: Page,
  run: () => Promise<T>,
): Promise<T> {
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  const onConsole = (message: ConsoleMessage) => {
    if (
      message.type() === "error" &&
      message.text().startsWith("[transaction-flow] step failed")
    ) {
      rejectFailure(new Error(`Transaction dialog failed: ${message.text()}`));
    }
  };
  const onPageError = (error: Error) => rejectFailure(error);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {
    return await Promise.race([run(), failed]);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}
