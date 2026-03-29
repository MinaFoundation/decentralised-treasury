import assert from "node:assert";
import { it } from "node:test";
import {
  runCli,
  parseGeneratedKeypair,
} from "./utils/cli-test-utils.js";

it("generates one keypair with env-friendly output", async () => {
  const output = await runCli(["generate-keypair"]);
  assert(
    output.includes("PRIVATE_KEY="),
    "expected generate-keypair output to include PRIVATE_KEY",
  );
  assert(
    output.includes("PUBLIC_KEY="),
    "expected generate-keypair output to include PUBLIC_KEY",
  );
});

it("generates one keypair as JSON output", async () => {
  const output = await runCli(["generate-keypair", "--json"]);
  const parsed = parseGeneratedKeypair(output);
  assert(parsed, "expected JSON keypair output");
  assert(parsed.privateKey, "expected privateKey in JSON output");
  assert(parsed.publicKey, "expected publicKey in JSON output");
});
