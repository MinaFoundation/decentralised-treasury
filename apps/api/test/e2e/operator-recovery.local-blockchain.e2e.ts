import { test } from "node:test";
import {
  startLocalTreasuryStack,
  proofMode,
} from "../../../web/e2e/utils/local-treasury-stack.js";
import { runOperatorRecoveryScenarios } from "./support/operator-recovery-scenarios.js";

const mode = proofMode();
test(
  `operator service recovery (PROOFS_ENABLED=${mode})`,
  { timeout: 7_200_000 },
  async (t) => {
    const stack = await startLocalTreasuryStack();
    t.after(() => stack.dispose());
    await runOperatorRecoveryScenarios(t, stack, stack.services);
  },
);
