import { Command } from "commander";
import { fileURLToPath } from "node:url";
import stakingLedgerCommandFactory from "./commands/staking-ledger.js";
import stakingLedgerToVotingLedgerCommandFactory from "./commands/staking-ledger-to-voting-ledger.js";
import workerCommandFactory from "./commands/worker.js";
import treasuryOwnerCommandFactory from "./commands/treasury-owner.js";
import pauseControllerCommandFactory from "./commands/pause-controller.js";
import lightnetCommandFactory from "./commands/lightnet.js";
import generateKeypairsCommandFactory from "./commands/generate-keypairs.js";
import proposalCommandFactory from "./commands/proposal.js";
import voteReducerCommandFactory from "./commands/vote-reducer.js";
import multisigSignCommandFactory from "./commands/multisig-sign.js";
import transferCommandFactory from "./commands/transfer.js";
import votingLedgerSchedulerCommandFactory from "./commands/voting-ledger-scheduler.js";
import minaLedgerParityCommandFactory from "./commands/mina-ledger-parity.js";

export function createProgram(): Command {
  const program = new Command();

  [
    stakingLedgerCommandFactory,
    stakingLedgerToVotingLedgerCommandFactory,
    workerCommandFactory,
    treasuryOwnerCommandFactory,
    pauseControllerCommandFactory,
    proposalCommandFactory,
    voteReducerCommandFactory,
    multisigSignCommandFactory,
    lightnetCommandFactory,
    generateKeypairsCommandFactory,
    transferCommandFactory,
    votingLedgerSchedulerCommandFactory,
    minaLedgerParityCommandFactory,
  ].forEach((commandFactory) => commandFactory(program));

  return program;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await createProgram().parseAsync(process.argv);
}
