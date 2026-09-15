import { describe, expect, it } from "vitest";
import { resolveProofsEnabled } from "./resolve-proofs-enabled";

describe("browser proof mode", () => {
  it.each([
    [undefined, true],
    ["true", true],
    ["false", false],
  ])("resolves %s to %s", (input, expected) => {
    expect(resolveProofsEnabled(input)).toBe(expected);
  });
  it.each(["", "FALSE", "0", " true ", "invalid"])(
    "rejects malformed value %s",
    (input) =>
      expect(() => resolveProofsEnabled(input)).toThrow(
        "NEXT_PUBLIC_PROOFS_ENABLED must be true or false.",
      ),
  );
});
