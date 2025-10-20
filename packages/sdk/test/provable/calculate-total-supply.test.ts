import { it } from "node:test";
import { calculateTotalSupply } from "../../src/calculate-total-supply.js";

it("foo", async () => {
  await calculateTotalSupply("test/provable/staking-epoch-ledger.json");
});
