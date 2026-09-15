import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { expectTransactionSuccess } from "../../../e2e/utils/transaction-success";

describe("E2E transaction failure observation", () => {
  it("returns success and removes temporary observers", async () => {
    const page = new EventEmitter();
    await expect(
      expectTransactionSuccess(page as unknown as Page, async () => "included"),
    ).resolves.toBe("included");
    expect(page.eventNames()).toEqual([]);
  });

  it("fails immediately on the actual dialog error while a success wait remains pending", async () => {
    const page = new EventEmitter();
    const result = expectTransactionSuccess(
      page as unknown as Page,
      async () => {
        page.emit("console", {
          type: () => "error",
          text: () =>
            "[transaction-flow] step failed Lifecycle context is not available",
        });
        return new Promise<never>(() => {});
      },
    );
    await expect(result).rejects.toThrow("Lifecycle context is not available");
    expect(page.eventNames()).toEqual([]);
  });
});
