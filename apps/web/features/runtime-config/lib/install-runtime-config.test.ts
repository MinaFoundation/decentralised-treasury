import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_CONFIG_WINDOW_KEY,
  getRuntimeConfig,
} from "./get-runtime-config";
import { installRuntimeConfig } from "./install-runtime-config";
import { readRuntimeConfig } from "./read-runtime-config";
import type { TreasuryRuntimeConfig } from "./runtime-config.types";

type RuntimeConfigScope = typeof globalThis & {
  [RUNTIME_CONFIG_WINDOW_KEY]?: TreasuryRuntimeConfig;
};

function clearInstalledConfig(): void {
  delete (globalThis as RuntimeConfigScope)[RUNTIME_CONFIG_WINDOW_KEY];
}

afterEach(() => {
  clearInstalledConfig();
});

describe("installRuntimeConfig", () => {
  it("publishes under the same key the page bootstrap script uses", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: "48",
    });

    installRuntimeConfig(config);

    expect((globalThis as RuntimeConfigScope)[RUNTIME_CONFIG_WINDOW_KEY]).toBe(
      config,
    );
  });

  it("is what getRuntimeConfig then reads, instead of build-time values", () => {
    // Nothing installed: the build-time env is empty under test, so the field
    // the browser prover checks first is undefined - the exact state that
    // produced "Missing required browser prover config" inside the worker.
    expect(getRuntimeConfig().lifecyclePeriodDuration).toBeUndefined();

    installRuntimeConfig(
      readRuntimeConfig({
        NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: "48",
        NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS: "B62qExample",
      }),
    );

    const config = getRuntimeConfig();

    expect(config.lifecyclePeriodDuration).toBe("48");
    expect(config.treasuryOwnerContractAddress).toBe("B62qExample");
  });

  it("replaces a previously installed config so a later message wins", () => {
    installRuntimeConfig(
      readRuntimeConfig({ NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: "48" }),
    );
    installRuntimeConfig(
      readRuntimeConfig({ NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: "7140" }),
    );

    expect(getRuntimeConfig().lifecyclePeriodDuration).toBe("7140");
  });
});
