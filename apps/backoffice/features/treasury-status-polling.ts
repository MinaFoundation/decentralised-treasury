export const TREASURY_STATUS_POLL_INTERVAL_MS = 10_000;

export function startTreasuryStatusPolling(
  poll: (background: boolean) => Promise<void>,
  intervalMs = TREASURY_STATUS_POLL_INTERVAL_MS,
): () => void {
  let active = true;
  let polling = false;

  const run = async (background: boolean): Promise<void> => {
    if (!active || polling) return;
    polling = true;
    try {
      await poll(background);
    } finally {
      polling = false;
    }
  };

  void run(false);
  const intervalId = window.setInterval(() => {
    void run(true);
  }, intervalMs);

  return () => {
    active = false;
    window.clearInterval(intervalId);
  };
}
