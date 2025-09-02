import { Command } from "commander";
import { calculateTotalSupply } from "./calculate-total-supply";
import { createTestLedger } from "./create-test-ledger";
import fs from "fs";

const program = new Command();

program
  .command("calculate-total-supply")
  .argument("<staking-ledger-path>", "Path to the staking ledger file")
  .action((stakingLedgerPath) => {
    calculateTotalSupply(stakingLedgerPath);
  });

program
  .command("create-test-ledger")
  .argument("[number-of-accounts]", "Number of accounts to create", 1000)
  .argument("[output-path]", "Path to the output file", "test-ledger.json")
  .action((numberOfAccounts, outputPath) => {
    const accounts = createTestLedger(numberOfAccounts);

    fs.writeFileSync(outputPath, JSON.stringify(accounts, null, 2));
    console.log(`Saved to ${outputPath}`);
  });

program.parse(process.argv);
