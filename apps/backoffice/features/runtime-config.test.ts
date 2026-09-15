// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "./runtime-config";

afterEach(() => vi.unstubAllEnvs());

describe("proof mode configuration", () => {
  it("requires proofs by default", () => {
    vi.stubEnv("NEXT_PUBLIC_PROOFS_ENABLED", undefined);
    vi.stubEnv("PROOFS_ENABLED", undefined);
    expect(getRuntimeConfig().proofsEnabled).toBe(true);
  });

  it.each(["true", "false"])("preserves explicit %s mode", (mode) => {
    vi.stubEnv("NEXT_PUBLIC_PROOFS_ENABLED", undefined);
    vi.stubEnv("PROOFS_ENABLED", mode);
    expect(getRuntimeConfig().proofsEnabled).toBe(mode === "true");
  });

  it("rejects a misspelled mode", () => {
    vi.stubEnv("NEXT_PUBLIC_PROOFS_ENABLED", undefined);
    vi.stubEnv("PROOFS_ENABLED", "FALSE");
    expect(() => getRuntimeConfig()).toThrow("exactly true or false");
  });
});
