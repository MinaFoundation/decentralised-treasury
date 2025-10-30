import { Command } from "commander";

import fs, { mkdirSync, writeFileSync } from "fs";
import { readLedger } from "../read-ledger.js";
import { StakingLedgerToVotingLedgerService } from "../services/staking-ledger-to-voting-ledger-service.js";
import { Provable } from "o1js";

export default function stakingLedgerToVotingLedgerCommandFactory(
  program: Command
) {
  program
    .command("staking-ledger-to-voting-ledger")
    .requiredOption(
      "--staking-ledger-path <staking-ledger-path>",
      "Path to the staking ledger file"
    )
    .requiredOption(
      "--voting-ledger-output-path <voting-ledger-output-path>",
      "Path to the voting ledger file"
    )
    .requiredOption(
      "--proof-output-path <proof-output-path>",
      "Path to the proof output file"
    )
    .action(
      async (stakingLedgerPath, votingLedgerOutputPath, proofOutputPath) => {
        const service = new StakingLedgerToVotingLedgerService();
        let accounts = await service.readLedger(
          process.cwd() + "/" + stakingLedgerPath
        );

        await service.populateStakingLedgerTree(accounts);
        await service.compile();
        const proof = await service.digest(accounts);

        votingLedgerOutputPath = process.cwd() + "/" + votingLedgerOutputPath;
        service.votingAccountService.toFile(votingLedgerOutputPath);

        proofOutputPath = process.cwd() + "/" + proofOutputPath;
        mkdirSync(proofOutputPath.split("/").slice(0, -1).join("/"), {
          recursive: true,
        });
        writeFileSync(proofOutputPath, JSON.stringify(proof.toJSON()));

        console.log("digest completed");
        Provable.log("totalCurrency", proof.publicOutput.totalCurrency);
        Provable.log("votingLedgerRoot", proof.publicOutput.votingLedgerRoot);
        console.log("proof saved to:", proofOutputPath);
        console.log("voting ledger saved to:", votingLedgerOutputPath);
      }
    );
}

/**
 * TODO:
 * CLI:
 * - deploy treasury
 * - create proposal
 * - vote on proposal
 * - tally votes
 * - execute proposal
 */
