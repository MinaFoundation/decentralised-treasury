import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composePath = new URL("../compose.yml", import.meta.url);

function serviceBlock(source, serviceName) {
  const marker = `  ${serviceName}:`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing Compose service: ${serviceName}`);

  const remainder = source.slice(start + marker.length);
  const nextService = /\n  [a-z0-9_-]+:\n/u.exec(remainder);
  const end =
    nextService === null
      ? source.length
      : start + marker.length + nextService.index;
  return source.slice(start, end);
}

test("Compose selects native o1js only for real proof services", async () => {
  const source = await readFile(composePath, "utf8");
  const proofServices = ["proving-worker", "proving-scheduler"];

  for (const serviceName of proofServices) {
    const block = serviceBlock(source, serviceName);
    assert.match(
      block,
      /^      O1JS_BACKEND: native$/mu,
      `${serviceName} must select the native o1js backend`,
    );
    assert.match(
      block,
      /^      PROOFS_ENABLED: \$\{PROOFS_ENABLED:-false\}$/mu,
      `${serviceName} must keep the fail-closed proof enablement gate`,
    );
  }

  const nonProofServices = [
    "postgres",
    "api-migrate",
    "api",
    "indexer-api",
    "processor-api",
    "indexer",
    "processor",
    "voting-ledger-scheduler",
    "redis",
    "web",
    "backoffice",
    "reverse-proxy",
  ];

  for (const serviceName of nonProofServices) {
    assert.doesNotMatch(
      serviceBlock(source, serviceName),
      /^      O1JS_BACKEND:/mu,
      `${serviceName} must not select a proof backend`,
    );
  }
});
