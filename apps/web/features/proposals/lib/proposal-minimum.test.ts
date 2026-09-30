import { describe, expect, it } from "vitest";
import {
  buildCreateProposalTransactionInCurrentThread,
  type PrepareCreateProposalTransactionInput,
} from "./proposal-prover-runtime";

describe("proposal creation minimum", () => {
  it.each(["0", "0.000000001", "9.999999999", "9.9999999999"])(
    "rejects %s MINA before loading the prover or accessing the network",
    async (amount) => {
      await expect(
        buildCreateProposalTransactionInCurrentThread({
          amount,
        } as PrepareCreateProposalTransactionInput),
      ).rejects.toThrow("at least 10 MINA");
    },
  );
});
