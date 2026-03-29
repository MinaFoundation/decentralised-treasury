import assert from "node:assert";
import { describe, it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  MARKDOWN_ZKAPP_URI_PREFIX,
  resolveProposalZkappUri,
} from "../src/commands/proposal-content-hash.js";

describe("proposal content hashing", () => {
  it("derives deterministic zkapp uri from markdown file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proposal-content-hash-"));
    const markdownPath = join(directory, "proposal.md");
    const markdown = "# Proposal\n\nThis is **markdown** content.\n";
    await writeFile(markdownPath, markdown, "utf8");

    const resolved = await resolveProposalZkappUri({
      contentFile: markdownPath,
    });

    const expectedDigest = createHash("sha256").update(markdown).digest("hex");
    assert.strictEqual(
      resolved,
      `${MARKDOWN_ZKAPP_URI_PREFIX}${expectedDigest}`,
      "expected markdown hash-based zkAppUri",
    );
  });

  it('accepts markdown containing the textual character "0"', async () => {
    const directory = await mkdtemp(join(tmpdir(), "proposal-content-hash-"));
    const markdownPath = join(directory, "proposal.md");
    const markdown = "# Proposal 0\n\nBudget increase is 10%.\n";
    await writeFile(markdownPath, markdown, "utf8");

    const resolved = await resolveProposalZkappUri({
      contentFile: markdownPath,
    });

    const expectedDigest = createHash("sha256").update(markdown).digest("hex");
    assert.strictEqual(
      resolved,
      `${MARKDOWN_ZKAPP_URI_PREFIX}${expectedDigest}`,
      'expected markdown hash-based zkAppUri for content containing "0"',
    );
  });

  it("rejects markdown files containing a NUL byte", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proposal-content-hash-"));
    const markdownPath = join(directory, "proposal.md");
    await writeFile(markdownPath, Buffer.from([0x23, 0x20, 0x61, 0x00, 0x62]));

    await assert.rejects(
      () =>
        resolveProposalZkappUri({
          contentFile: markdownPath,
        }),
      /nul byte/i,
    );
  });

  it("rejects non-markdown content files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proposal-content-hash-"));
    const textPath = join(directory, "proposal.txt");
    await writeFile(textPath, "plain text", "utf8");

    await assert.rejects(
      () =>
        resolveProposalZkappUri({
          contentFile: textPath,
        }),
      /must be markdown/i,
    );
  });

});
