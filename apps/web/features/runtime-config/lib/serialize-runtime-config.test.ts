import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./read-runtime-config";
import { serializeRuntimeConfig } from "./serialize-runtime-config";

function evaluateSerialized(serialized: string): unknown {
  return JSON.parse(serialized);
}

describe("serializeRuntimeConfig", () => {
  it("round-trips through JSON", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_TREASURY_API_URL: "https://treasury.example/api",
      NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS: "B62qtreasury",
    });

    expect(evaluateSerialized(serializeRuntimeConfig(config))).toEqual(config);
  });

  it("escapes a value that would otherwise close the script element", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_NETWORK_ID: "</script><script>alert(1)</script>",
    });
    const serialized = serializeRuntimeConfig(config);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<");
    expect(evaluateSerialized(serialized)).toEqual(config);
  });

  it("escapes the line separators that are legal in JSON but not in JavaScript", () => {
    const config = readRuntimeConfig({
      NEXT_PUBLIC_NETWORK_ID: "a\u2028b\u2029c",
    });
    const serialized = serializeRuntimeConfig(config);

    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(evaluateSerialized(serialized)).toEqual(config);
  });
});
