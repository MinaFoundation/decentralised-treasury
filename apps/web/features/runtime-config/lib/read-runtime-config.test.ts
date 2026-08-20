import { describe, expect, it } from "vitest";
import { readBuildTimeEnv } from "./read-build-time-env";
import { readRuntimeConfig } from "./read-runtime-config";
import { RUNTIME_CONFIG_FIELDS } from "./runtime-config-fields";

describe("readRuntimeConfig", () => {
  it("falls back to the documented defaults when nothing is configured", () => {
    const config = readRuntimeConfig({});

    expect(config.buildSha).toBe("unknown");
    expect(config.networkId).toBe("MAINNET");
    expect(config.apiUrl).toBe("http://127.0.0.1:3100/api");
    expect(config.indexerApiUrl).toBe("http://127.0.0.1:3100/indexer");
    expect(config.processorApiUrl).toBe("http://127.0.0.1:3100/processor");
    expect(config.minaNodeUrl).toBe("http://127.0.0.1:3100/mina/graphql");
  });

  it("leaves fields without a fallback undefined", () => {
    const config = readRuntimeConfig({});

    expect(config.treasuryOwnerContractAddress).toBeUndefined();
    expect(config.lifecyclePeriodDuration).toBeUndefined();
    expect(config.proofsEnabled).toBeUndefined();
    expect(config.treasuryProposalVerificationKeyJson).toBeUndefined();
  });

  it("reads the NEXT_PUBLIC name", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_TREASURY_API_URL: "https://treasury.example/api",
      NEXT_PUBLIC_PROOFS_ENABLED: "true",
    });

    expect(config.apiUrl).toBe("https://treasury.example/api");
    expect(config.proofsEnabled).toBe("true");
  });

  it("treats a blank value as unset so an unconfigured image still gets defaults", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_TREASURY_API_URL: "",
      NEXT_PUBLIC_MINA_NODE_URL: "   ",
      NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT: "",
    });

    expect(config.apiUrl).toBe("http://127.0.0.1:3100/api");
    expect(config.minaNodeUrl).toBe("http://127.0.0.1:3100/mina/graphql");
    expect(config.emptyNullifierRoot).toBeUndefined();
  });

  it("prefers the NEXT_PUBLIC name over the shorter alias", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS: "B62qpublic",
      TREASURY_OWNER_CONTRACT_ADDRESS: "B62qalias",
    });

    expect(config.treasuryOwnerContractAddress).toBe("B62qpublic");
  });

  it("falls back to the shorter alias shared with the backend services", () => {
    const config = readRuntimeConfig({
      TREASURY_OWNER_CONTRACT_ADDRESS: "B62qalias",
      LIFECYCLE_PERIOD_DURATION: "7140",
      BUILD_SHA: "abc123",
    });

    expect(config.treasuryOwnerContractAddress).toBe("B62qalias");
    expect(config.lifecyclePeriodDuration).toBe("7140");
    expect(config.buildSha).toBe("abc123");
  });

  it("keeps the legacy NEXT_PUBLIC_API_URL name working", () => {
    const config = readRuntimeConfig({ NEXT_PUBLIC_API_URL: "https://legacy/api" });

    expect(config.apiUrl).toBe("https://legacy/api");
  });
});

describe("readBuildTimeEnv", () => {
  it("statically references every NEXT_PUBLIC name a field can resolve", () => {
    // Without this the field table could gain a variable that resolves on the
    // server but silently reads as undefined in `next dev` and in tests, since
    // only static references are inlined into the bundle.
    const buildTimeNames = Object.keys(readBuildTimeEnv());
    const publicNames = Object.values(RUNTIME_CONFIG_FIELDS)
      .flatMap((field) => [...field.envNames])
      .filter((name) => name.startsWith("NEXT_PUBLIC_"));

    expect(buildTimeNames.slice().sort()).toEqual(
      Array.from(new Set(publicNames)).sort(),
    );
  });
});
