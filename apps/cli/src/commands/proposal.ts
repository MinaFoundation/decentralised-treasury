import { Command, Option } from "commander";
import { PrivateKey, PublicKey, TokenId, UInt32, UInt64 } from "o1js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import { type ProposalVote } from "@repo/sdk/src/services/treasury-owner-service.js";
import {
  SideLoadedVoteReducerProof,
  VoteAction,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { configureMinaNetwork } from "./mina-instance.js";
import { submitProposalContents } from "./proposal-content-api.js";
import {
  readProposalMarkdownContent,
  resolveProposalZkappUri,
} from "./proposal-content-hash.js";

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

interface CreateProposalCommandOptions {
  apiUrl: string;
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPrivateKey: PrivateKey;
  proposalLifecycleId: UInt32;
  recipientPublicKey: PublicKey;
  amount: UInt64;
  contentFile: string;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface VoteProposalCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  voterPrivateKey: PrivateKey;
  vote: ProposalVote;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface FetchProposalActionsCommandOptions {
  archiveNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  outputPath?: string;
}

interface TallyVotesProposalCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  voteReducerProofPath: string;
  stakingLedgerToVotingLedgerProofPath: string;
  lifecycleId: string;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface ExecuteProposalCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  recipientPublicKey: PublicKey;
  amountToPayOut?: UInt64;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface ReadProposalStateCommandOptions {
  minaNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
}

export async function createProposal(
  options: CreateProposalCommandOptions,
): Promise<void> {
  const [proposalContents, proposalZkappUri] = await Promise.all([
    readProposalMarkdownContent({
      contentFile: options.contentFile,
    }),
    resolveProposalZkappUri({
      contentFile: options.contentFile,
    }),
  ]);
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();

  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl);

  const result = await service.createProposal({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    proposalPrivateKey: options.proposalPrivateKey,
    proposalLifecycleId: options.proposalLifecycleId,
    recipientPublicKey: options.recipientPublicKey,
    amount: options.amount,
    proposalZkappUri,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  const contentSubmission = await submitProposalContents({
    apiUrl: options.apiUrl,
    proposalPublicKey: result.proposalAddress,
    contents: proposalContents,
  });

  console.log(
    JSON.stringify({
      ...result,
      contentSubmission,
    }),
  );
}

export async function voteProposal(options: VoteProposalCommandOptions): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();

  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl);

  const result = await service.voteProposal({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    proposalPublicKey: options.proposalPublicKey,
    voterPrivateKey: options.voterPrivateKey,
    vote: options.vote,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  console.log(JSON.stringify(result));
}

export async function tallyVotesProposal(
  options: TallyVotesProposalCommandOptions,
): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();
  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl);

  const [voteReducerProofJson, stakingLedgerToVotingLedgerProofJson] = await Promise.all([
    readFile(options.voteReducerProofPath, "utf8").then((value) => JSON.parse(value)),
    readFile(options.stakingLedgerToVotingLedgerProofPath, "utf8").then((value) =>
      JSON.parse(value),
    ),
  ]);
  const voteReducerProof =
    await SideLoadedVoteReducerProof.fromJSON(voteReducerProofJson);
  const stakingLedgerToVotingLedgerProof =
    await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
      stakingLedgerToVotingLedgerProofJson,
    );
  const {
    treasuryOwnerAccount,
    treasuryOwnerAccountWitness,
  } = await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
    options.lifecycleId,
    options.treasuryOwnerPublicKey,
  );

  const result = await service.tallyVotes({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    proposalPublicKey: options.proposalPublicKey,
    voteReducerProof,
    stakingLedgerToVotingLedgerProof,
    treasuryOwnerAccount,
    treasuryOwnerAccountWitness,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  console.log(JSON.stringify(result));
}

export async function executeProposal(
  options: ExecuteProposalCommandOptions,
): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();
  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl);

  const result = await service.executeProposal({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    proposalPublicKey: options.proposalPublicKey,
    recipientPublicKey: options.recipientPublicKey,
    amountToPayOut: options.amountToPayOut,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  console.log(JSON.stringify(result));
}

export async function fetchProposalActions(
  options: FetchProposalActionsCommandOptions,
): Promise<void> {
  const { SqliteVoteReducerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js"
  );
  const treasuryOwner = new TreasuryOwnerSmartContract(
    options.treasuryOwnerPublicKey,
  );
  const tokenId = treasuryOwner.deriveTokenId();
  const service = new SqliteVoteReducerService({
    lifecycleId: "proposal-fetch-actions",
    archiveNodeUrl: options.archiveNodeUrl,
    proposalPublicKey: options.proposalPublicKey.toBase58(),
    proposalTokenId: TokenId.toBase58(tokenId),
  });
  const actionsResult = await service.fetchProposalActions();

  const payload = {
    proposalPublicKey: actionsResult.proposalPublicKey,
    proposalTokenId: actionsResult.proposalTokenId,
    actionStateHistoryTarget: actionsResult.actionStateHistoryTarget,
    voteActions: actionsResult.voteActions.map((voteAction) =>
      VoteAction.toJSON(voteAction),
    ),
  };

  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, JSON.stringify(payload, null, 2));
  }

  console.log(
    JSON.stringify({
      count: payload.voteActions.length,
      outputPath: options.outputPath,
      ...payload,
    }),
  );
}

export async function readProposalState(
  options: ReadProposalStateCommandOptions,
): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.getProposalState({
    minaNodeUrl: options.minaNodeUrl,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    proposalPublicKey: options.proposalPublicKey,
  });
  console.log(JSON.stringify(result));
}

export default function proposalCommandFactory(program: Command) {
  const command = program
    .command("proposal")
    .description("Proposal contract commands")
    .addHelpText(
      "after",
      "\nTip: if you are waiting for a lifecycle period, run `treasury-owner read-state` and check `currentLifecyclePeriod`.",
    );

  command
    .command("create")
    .description(
      "Create a proposal (must be submitted during the proposal creation period)",
    )
    .addOption(
      new Option("--api-url <api-url>", "Treasury API base URL")
        .env("TREASURY_API_URL")
        .default("http://127.0.0.1:4000"),
    )
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option("--sender-private-key <sender-private-key>", "Sender private key")
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-private-key <proposal-private-key>", "Proposal private key")
        .env("PROPOSAL_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-lifecycle-id <proposal-lifecycle-id>", "Proposal lifecycle ID")
        .env("PROPOSAL_LIFECYCLE_ID")
        .argParser((value) => UInt32.from(value))
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--recipient-public-key <recipient-public-key>", "Proposal recipient")
        .env("RECIPIENT_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--amount <amount>", "Proposal transfer amount in nanomina")
        .env("PROPOSAL_AMOUNT")
        .argParser((value) => UInt64.from(value))
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--content-file <content-file>",
        "Path to markdown proposal content file (hashed to derive zkappUri)",
      )
        .env("PROPOSAL_CONTENT_FILE")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--fee <fee>", "Transaction fee in nanomina")
        .env("TX_FEE")
        .argParser((value) => UInt64.from(value))
        .default(UInt64.from(1 * 10 ** 9)),
    )
    .addOption(
      new Option("--nonce <nonce>", "Nonce to use for the transaction")
        .env("TX_NONCE")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--memo <memo>", "Memo to use for transactions").env("TX_MEMO"),
    )
    .addOption(
      new Option("--wait <wait>", "Wait for transaction inclusion")
        .env("TX_WAIT")
        .argParser(parseBooleanOption)
        .default(true),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(createProposal);

  command
    .command("vote")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option("--sender-private-key <sender-private-key>", "Sender private key")
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-public-key <proposal-public-key>", "Proposal public key")
        .env("PROPOSAL_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-private-key <voter-private-key>", "Voter private key")
        .env("VOTER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--vote <vote>", "Vote selection")
        .choices(["yay", "nay", "abstain"])
        .env("PROPOSAL_VOTE")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--fee <fee>", "Transaction fee in nanomina")
        .env("TX_FEE")
        .argParser((value) => UInt64.from(value))
        .default(UInt64.from(1 * 10 ** 9)),
    )
    .addOption(
      new Option("--nonce <nonce>", "Nonce to use for the transaction")
        .env("TX_NONCE")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--memo <memo>", "Memo to use for transactions").env("TX_MEMO"),
    )
    .addOption(
      new Option("--wait <wait>", "Wait for transaction inclusion")
        .env("TX_WAIT")
        .argParser(parseBooleanOption)
        .default(true),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(voteProposal);

  command
    .command("execute")
    .description("Execute an approved proposal payout")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option("--sender-private-key <sender-private-key>", "Sender private key")
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-public-key <proposal-public-key>", "Proposal public key")
        .env("PROPOSAL_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--recipient-public-key <recipient-public-key>",
        "Proposal recipient public key",
      )
        .env("RECIPIENT_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--amount-to-pay-out <amount-to-pay-out>",
        "Optional payout amount in nanomina (defaults to full remaining proposal amount with bond)",
      )
        .env("EXECUTE_PROPOSAL_AMOUNT")
        .argParser((value) => UInt64.from(value)),
    )
    .addOption(
      new Option("--fee <fee>", "Transaction fee in nanomina")
        .env("TX_FEE")
        .argParser((value) => UInt64.from(value))
        .default(UInt64.from(1 * 10 ** 9)),
    )
    .addOption(
      new Option("--nonce <nonce>", "Nonce to use for the transaction")
        .env("TX_NONCE")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--memo <memo>", "Memo to use for transaction").env("TX_MEMO"),
    )
    .addOption(
      new Option("--wait <wait>", "Wait for transaction inclusion")
        .env("TX_WAIT")
        .argParser(parseBooleanOption)
        .default(true),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(executeProposal);

  command
    .command("read-state")
    .description("Read proposal on-chain state fields")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-public-key <proposal-public-key>", "Proposal public key")
        .env("PROPOSAL_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .action(readProposalState);

  command
    .command("fetch-actions")
    .addOption(
      new Option("--archive-node-url <archive-node-url>", "Archive GraphQL URL")
        .env("ARCHIVE_NODE_URL")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-public-key <proposal-public-key>", "Proposal public key")
        .env("PROPOSAL_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--output-path <output-path>",
        "Optional output file path for vote actions JSON",
      ).env("PROPOSAL_ACTIONS_OUTPUT_PATH"),
    )
    .action(fetchProposalActions);

  command
    .command("tally-votes")
    .description("Tally votes on a proposal using sideloaded proofs")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option("--sender-private-key <sender-private-key>", "Sender private key")
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <treasury-owner-public-key>",
        "Treasury owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposal-public-key <proposal-public-key>", "Proposal public key")
        .env("PROPOSAL_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--vote-reducer-proof-path <vote-reducer-proof-path>",
        "Path to merged vote-reducer proof JSON",
      )
        .env("VOTE_REDUCER_PROOF_PATH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--staking-ledger-to-voting-ledger-proof-path <staking-ledger-to-voting-ledger-proof-path>",
        "Path to staking-ledger-to-voting-ledger proof JSON",
      )
        .env("STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--lifecycle-id <lifecycle-id>",
        "Lifecycle ID for sqlite staking ledger witness extraction",
      )
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--fee <fee>", "Transaction fee in nanomina")
        .env("TX_FEE")
        .argParser((value) => UInt64.from(value))
        .default(UInt64.from(1 * 10 ** 9)),
    )
    .addOption(
      new Option("--nonce <nonce>", "Nonce to use for the transaction")
        .env("TX_NONCE")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--memo <memo>", "Memo to use for transaction").env("TX_MEMO"),
    )
    .addOption(
      new Option("--wait <wait>", "Wait for transaction inclusion")
        .env("TX_WAIT")
        .argParser(parseBooleanOption)
        .default(true),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(tallyVotesProposal);
}
