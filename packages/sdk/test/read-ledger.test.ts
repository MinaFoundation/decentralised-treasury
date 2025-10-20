import { it } from "node:test";
import { readLedger } from "../src/read-ledger.js";

it("should read the staking epoch ledger", async () => {
  const accounts = await readLedger("test/provable/staking-epoch-ledger.json");
  console.log(accounts);
});
