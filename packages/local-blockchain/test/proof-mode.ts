import assert from "node:assert/strict";
import { join } from "node:path";
import { Cache, Mina } from "../src/o1js.js";

const requestedMode = process.env.PROOFS_ENABLED ?? "false";
assert(
  requestedMode === "false" || requestedMode === "true",
  "PROOFS_ENABLED must be exactly false or true",
);

export const proofsEnabled = requestedMode === "true";
export const proofMode = requestedMode;
export const proofTimeoutMs = proofsEnabled ? 7_200_000 : 600_000;
export const proofCacheDirectory = process.env.E2E_ARTIFACT_DIRECTORY
  ? join(process.env.E2E_ARTIFACT_DIRECTORY, "cache", "service")
  : join(process.cwd(), "cache", "e2e", `proofs-${proofMode}`);
export const proofCache = Cache.FileSystem(proofCacheDirectory);

export async function assertServerProofMode(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/admin/state`, {
    headers: { connection: "close" },
  });
  assert.equal(response.status, 200);
  const state = (await response.json()) as { proofsEnabled?: boolean };
  assert.equal(
    state.proofsEnabled,
    proofsEnabled,
    "Server proof mode mismatch",
  );
}

export async function proveNetworkTransaction(
  original: Awaited<ReturnType<typeof Mina.transaction>>,
) {
  if (proofsEnabled) return original.prove();
  // Mina.Network captures proof mode when the transaction object is created.
  // Rebuild it under the explicit local mode and retain pending authorization.
  Mina.activeInstance.proofsEnabled = proofsEnabled;
  const transaction = Mina.Transaction.fromJSON(original.toJSON());
  transaction.transaction.feePayer.lazyAuthorization =
    original.transaction.feePayer.lazyAuthorization;
  original.transaction.accountUpdates.forEach((update, index) => {
    transaction.transaction.accountUpdates[index]!.lazyAuthorization =
      update.lazyAuthorization;
  });
  return transaction.prove();
}
