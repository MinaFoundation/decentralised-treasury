import { defineConfig } from "@playwright/test";
import path from "node:path";

const mode = process.env.PROOFS_ENABLED;
if (mode !== "true" && mode !== "false") {
  throw new Error(
    "Set PROOFS_ENABLED to exactly true or false for the live lane.",
  );
}
const artifactDirectory =
  process.env.E2E_ARTIFACT_DIRECTORY ?? process.env.E2E_ARTIFACTS_DIR;
const outputDir = artifactDirectory
  ? path.join(artifactDirectory, "backoffice", `proofs-${mode}`)
  : `test-results/local-blockchain/proofs-${mode}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "backoffice.local-blockchain.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 90 * 60_000,
  expect: { timeout: 30_000 },
  outputDir,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(outputDir, "report.json"),
      },
    ],
  ],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
