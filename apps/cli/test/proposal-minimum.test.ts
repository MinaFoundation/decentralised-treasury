import assert from "node:assert/strict";
import { it } from "node:test";
import { UInt64 } from "o1js";
import { createProposal } from "../src/commands/proposal.js";

it("rejects a low proposal amount before resolving keys, files, or compilation", async () => {
  await assert.rejects(
    () =>
      createProposal({
        amount: UInt64.from(9_999_999_999n),
      } as Parameters<typeof createProposal>[0]),
    /at least 10 MINA/,
  );
});
