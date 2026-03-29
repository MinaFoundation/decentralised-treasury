import assert from "node:assert";
import { it } from "node:test";
import { createHash } from "node:crypto";
import {
  assertZkappUriWithinByteLimit,
  hashMarkdownContentToZkappUri,
  MARKDOWN_ZKAPP_URI_PREFIX,
  MAX_ZKAPP_URI_UTF8_BYTES,
} from "../../src/utils/proposal-content-hash.js";

it("hashes markdown bytes into expected proposal zkapp uri", async () => {
  const markdown = "# Proposal\n\nUse shared sdk hashing.\n";
  const markdownBytes = new TextEncoder().encode(markdown);

  const hashed = await hashMarkdownContentToZkappUri(markdownBytes);
  const expectedDigest = createHash("sha256").update(markdown).digest("hex");

  assert.strictEqual(
    hashed,
    `${MARKDOWN_ZKAPP_URI_PREFIX}${expectedDigest}`,
    "expected sdk hash helper to derive deterministic zkapp uri",
  );
});

it("validates zkapp uri byte length using utf-8 bytes", () => {
  assert.doesNotThrow(() =>
    assertZkappUriWithinByteLimit("a".repeat(MAX_ZKAPP_URI_UTF8_BYTES)),
  );

  assert.throws(
    () =>
      assertZkappUriWithinByteLimit(
        "a".repeat(MAX_ZKAPP_URI_UTF8_BYTES + 1),
      ),
    /exceeds mina limit/i,
  );

  // 70 rocket emojis are 280 UTF-8 bytes (> 255).
  assert.throws(
    () => assertZkappUriWithinByteLimit("🚀".repeat(70)),
    /exceeds mina limit/i,
  );
});
