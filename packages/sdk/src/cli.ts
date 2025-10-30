import { Command } from "commander";
import stakingLedgerToVotingLedgerCommand from "./commands/staking-ledger-to-voting-ledger.js";
import deployTreasuryOwnerCommand from "./commands/deploy-treasury-owner.js";
import generateKeypairsCommandFactory from "./commands/generate-keypairs.js";
import lightnetAcquireKeyPairCommandFactory from "./commands/lightnet-acquire-keypair.js";
import transferCommandFactory from "./commands/transfer.js";
import createProposalCommandFactory from "./commands/create-proposal.js";

const program = new Command();

[
  stakingLedgerToVotingLedgerCommand,
  deployTreasuryOwnerCommand,
  generateKeypairsCommandFactory,
  lightnetAcquireKeyPairCommandFactory,
  transferCommandFactory,
  createProposalCommandFactory,
].forEach((commandFactory) => commandFactory(program));

program.parse(process.argv);
