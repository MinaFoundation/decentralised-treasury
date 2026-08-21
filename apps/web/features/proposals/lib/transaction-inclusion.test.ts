import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";
import { resolveInclusionTimeoutMs } from "./transaction-inclusion";

vi.mock("../../runtime-config/lib/get-runtime-config", () => ({
  getRuntimeConfig: vi.fn(),
}));

function withSlotDuration(slotDurationMs: string | undefined): void {
  vi.mocked(getRuntimeConfig).mockReturnValue({
    slotDurationMs,
  } as ReturnType<typeof getRuntimeConfig>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveInclusionTimeoutMs", () => {
  it("scales with the chain's slot duration", () => {
    withSlotDuration("90000");
    // Ten slots. The previous flat three minutes was two slots on this chain,
    // against an average block interval of roughly three minutes, so healthy
    // transactions timed out while still in the mempool.
    expect(resolveInclusionTimeoutMs()).toBe(15 * 60_000);

    withSlotDuration("180000");
    expect(resolveInclusionTimeoutMs()).toBe(30 * 60_000);
  });

  it("still scales on a fast local chain", () => {
    withSlotDuration("37500");
    expect(resolveInclusionTimeoutMs()).toBe(6.25 * 60_000);
  });

  it("never drops below the floor", () => {
    // Ten slots would be under two minutes here, which is too tight to survive
    // a single slow block regardless of how fast the chain claims to be.
    withSlotDuration("10000");
    expect(resolveInclusionTimeoutMs()).toBe(5 * 60_000);
  });

  it("falls back when the slot duration is missing or unusable", () => {
    withSlotDuration(undefined);
    expect(resolveInclusionTimeoutMs()).toBe(30 * 60_000);

    withSlotDuration("not-a-number");
    expect(resolveInclusionTimeoutMs()).toBe(30 * 60_000);

    withSlotDuration("0");
    expect(resolveInclusionTimeoutMs()).toBe(30 * 60_000);
  });
});
