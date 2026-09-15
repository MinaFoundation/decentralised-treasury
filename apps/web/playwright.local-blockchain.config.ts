import { defineConfig, devices } from "@playwright/test";
import { proofMode } from "./e2e/utils/local-treasury-stack";

const mode = proofMode();
const artifacts =
  process.env.E2E_ARTIFACT_DIRECTORY ??
  process.env.E2E_ARTIFACTS_DIR ??
  `test-results/local-${mode}`;

export default defineConfig({
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "**/*.local-blockchain.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: Number(process.env.E2E_CASE_TIMEOUT_MS ?? 1_800_000),
  expect: { timeout: 30_000 },
  outputDir: `${artifacts}/browser`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifacts}/results.json` }],
    ["junit", { outputFile: `${artifacts}/junit.xml` }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
