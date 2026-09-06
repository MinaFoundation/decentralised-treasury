import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3200",
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS: "",
      NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS: "",
    },
  },
});
