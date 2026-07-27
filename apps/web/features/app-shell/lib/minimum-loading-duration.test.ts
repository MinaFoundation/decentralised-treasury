import { afterEach, describe, expect, it, vi } from "vitest";
import { withMinimumLoadingDuration } from "./minimum-loading-duration";

afterEach(() => {
  vi.useRealTimers();
});

describe("withMinimumLoadingDuration", () => {
  it("keeps a successful operation pending for the minimum duration", async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = withMinimumLoadingDuration(
      Promise.resolve("loaded"),
      300,
    ).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(299);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("loaded");
  });

  it("also delays errors to avoid flashing the loading state", async () => {
    vi.useFakeTimers();
    const result = withMinimumLoadingDuration(
      Promise.reject(new Error("failed")),
      300,
    );
    void result.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(299);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).rejects.toThrow("failed");
  });
});
