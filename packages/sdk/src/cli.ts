import { Command } from "commander";
import stakingLedgerToVotingLedgerCommand from "./commands/staking-ledger-to-voting-ledger.js";
import deployTreasuryOwnerCommand from "./commands/deploy-treasury-owner.js";
import generateKeypairsCommandFactory from "./commands/generate-keypairs.js";
import lightnetAcquireKeyPairCommandFactory from "./commands/lightnet-acquire-keypair.js";
import transferCommandFactory from "./commands/transfer.js";
import createProposalCommandFactory from "./commands/create-proposal.js";
import readProposalCommandFactory from "./commands/read-proposal.js";
import voteOnProposalCommandFactory from "./commands/vote-on-proposal.js";
import tallyVotesCommandFactory from "./commands/tally-votes.js";
import executeProposalCommandFactory from "./commands/execute-proposal.js";

const program = new Command();

[
  stakingLedgerToVotingLedgerCommand,
  deployTreasuryOwnerCommand,
  generateKeypairsCommandFactory,
  lightnetAcquireKeyPairCommandFactory,
  transferCommandFactory,
  createProposalCommandFactory,
  readProposalCommandFactory,
  voteOnProposalCommandFactory,
  tallyVotesCommandFactory,
  executeProposalCommandFactory,
].forEach((commandFactory) => commandFactory(program));

program.parse(process.argv);
