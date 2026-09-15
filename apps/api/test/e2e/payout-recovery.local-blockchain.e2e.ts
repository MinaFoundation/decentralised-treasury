import { test } from "node:test";
import {
  proofMode,
  startLocalTreasuryStack,
} from "../../../web/e2e/utils/local-treasury-stack.js";
import { runPayoutRecoveryScenarios } from "./support/payout-recovery-scenarios.js";

test(
  `payout backend recovery (PROOFS_ENABLED=${proofMode()})`,
  { timeout: 7_200_000 },
  async (t) => {
    const stack = await startLocalTreasuryStack();
    t.after(() => stack.dispose());
    await runPayoutRecoveryScenarios(t, stack);
  },
);
