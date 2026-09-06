import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTreasuryStatusPolling } from "./treasury-status-polling";

describe("treasury status polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads immediately and then polls in the background", async () => {
    const poll = vi.fn(async () => undefined);
    const stop = startTreasuryStatusPolling(poll, 100);

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenNthCalledWith(1, false);

    await vi.advanceTimersByTimeAsync(100);
    expect(poll).toHaveBeenNthCalledWith(2, true);

    stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not start a second poll while one is active", async () => {
    let finishFirstPoll: (() => void) | undefined;
    const poll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirstPoll = resolve;
        }),
    );
    const stop = startTreasuryStatusPolling(poll, 100);

    await vi.advanceTimersByTimeAsync(300);
    expect(poll).toHaveBeenCalledTimes(1);

    finishFirstPoll?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });
});
