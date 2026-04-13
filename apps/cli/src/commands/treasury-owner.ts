import { Command, Option } from "commander";
import {
  PrivateKey,
  Provable,
  PublicKey,
  UInt32,
  UInt64,
  VerificationKey,
} from "o1js";
import { logger } from "@repo/sdk/src/index.js";
import { MULTISIG_PARTICIPANTS_COUNT } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import { configureMinaNetwork } from "./mina-instance.js";

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

function parsePublicKeys(value: string): PublicKey[] {
  const keys = value
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => PublicKey.fromBase58(key));

  if (keys.length !== MULTISIG_PARTICIPANTS_COUNT) {
    throw new Error(
      `Expected ${MULTISIG_PARTICIPANTS_COUNT} multisig public keys, got ${keys.length}`,
    );
  }
  return keys;
}

interface DeployTreasuryOwnerCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPrivateKey: PrivateKey;
  pauseControllerPrivateKey: PrivateKey;
  treasuryDeployedAtSlot: UInt32;
  multisigParticipantsPublicKeys: PublicKey[];
  allowDeployToExistingAccount: boolean;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface CompileTreasuryOwnerCommandOptions {
  lifecyclePeriodDuration: UInt32;
}

interface TransferToTreasuryCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  fundingPrivateKey?: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  amount: UInt64;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
  lifecyclePeriodDuration: UInt32;
}

interface ReadTreasuryOwnerStateCommandOptions {
  minaNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
  lifecyclePeriodDuration: UInt32;
}

export async function compileTreasuryOwner(
  options: CompileTreasuryOwnerCommandOptions,
): Promise<void> {
  const startedAt = Date.now();
  logger.info(
    `[treasury-owner:compile] starting (lifecyclePeriodDuration=${options.lifecyclePeriodDuration.toString()})`,
  );

  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();

  const compileStartedAt = Date.now();
  const result = await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  logger.info(
    `[treasury-owner:compile] compile completed (elapsedMs=${Date.now() - compileStartedAt})`,
  );

  const browserCompileConfig = {
    lifecyclePeriodDuration: options.lifecyclePeriodDuration.toString(),
    voteReducerVerificationKeyJson: VerificationKey.toJSON(
      result.voteReducerVerificationKey,
    ),
    stakingLedgerToVotingLedgerVerificationKeyJson: VerificationKey.toJSON(
      result.stakingLedgerToVotingLedgerVerificationKey,
    ),
    treasuryProposalVerificationKeyJson: VerificationKey.toJSON(
      result.treasuryProposalVerificationKey,
    ),
    emptyVotingLedgerRoot: result.emptyVotingLedgerRoot.toString(),
    emptyNullifierRoot: result.emptyNullifierRoot.toString(),
  };

  const browserEnv = {
    NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: browserCompileConfig.lifecyclePeriodDuration,
    NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON: JSON.stringify(
      browserCompileConfig.voteReducerVerificationKeyJson,
    ),
    NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON:
      JSON.stringify(browserCompileConfig.stakingLedgerToVotingLedgerVerificationKeyJson),
    NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON: JSON.stringify(
      browserCompileConfig.treasuryProposalVerificationKeyJson,
    ),
    NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT: browserCompileConfig.emptyVotingLedgerRoot,
    NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT: browserCompileConfig.emptyNullifierRoot,
  };

  console.log(
    JSON.stringify({
      lifecyclePeriodDuration: options.lifecyclePeriodDuration.toString(),
      compiled: {
        voteReducerVerificationKey: Boolean(result.voteReducerVerificationKey),
        stakingLedgerToVotingLedgerVerificationKey: Boolean(
          result.stakingLedgerToVotingLedgerVerificationKey,
        ),
        treasuryProposalVerificationKey: Boolean(
          result.treasuryProposalVerificationKey,
        ),
        treasuryPauseControllerVerificationKey: Boolean(
          result.treasuryPauseControllerVerificationKey,
        ),
        treasuryOwnerVerificationKey: Boolean(result.treasuryOwnerVerificationKey),
      },
      browserCompileConfig,
      browserEnv,
    }),
  );

  logger.info(
    `[treasury-owner:compile] done (elapsedMs=${Date.now() - startedAt})`,
  );
}

export async function deployTreasuryOwner(
  options: DeployTreasuryOwnerCommandOptions,
): Promise<void> {
  const startedAt = Date.now();
  const senderPublicKey = options.senderPrivateKey.toPublicKey().toBase58();
  const treasuryOwnerPublicKey =
    options.treasuryOwnerPrivateKey.toPublicKey().toBase58();
  const pauseControllerPublicKey =
    options.pauseControllerPrivateKey.toPublicKey().toBase58();
  logger.info(
    `[treasury-owner:deploy] starting (minaNodeUrl=${options.minaNodeUrl}, sender=${senderPublicKey}, treasuryOwner=${treasuryOwnerPublicKey}, pauseController=${pauseControllerPublicKey}, treasuryDeployedAtSlot=${options.treasuryDeployedAtSlot.toString()}, multisigParticipants=${options.multisigParticipantsPublicKeys.length}, allowDeployToExistingAccount=${String(options.allowDeployToExistingAccount)}, wait=${String(options.wait)})`,
  );

  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();

  logger.info(
    "[treasury-owner:deploy] compiling treasury-owner dependencies and contracts",
  );
  const compileStartedAt = Date.now();
  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  logger.info(
    `[treasury-owner:deploy] compile completed (elapsedMs=${Date.now() - compileStartedAt})`,
  );

  logger.info("[treasury-owner:deploy] configuring Mina network instance");
  configureMinaNetwork(options.minaNodeUrl);

  logger.info(
    "[treasury-owner:deploy] submitting pause-controller and treasury-owner deployment transactions",
  );
  const deployStartedAt = Date.now();
  const result = await service.deploy({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    treasuryOwnerPrivateKey: options.treasuryOwnerPrivateKey,
    pauseControllerPrivateKey: options.pauseControllerPrivateKey,
    treasuryDeployedAtSlot: options.treasuryDeployedAtSlot,
    multisigParticipantsPublicKeys: options.multisigParticipantsPublicKeys,
    allowDeployToExistingAccount: options.allowDeployToExistingAccount,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  logger.info(
    `[treasury-owner:deploy] deployment completed (elapsedMs=${Date.now() - deployStartedAt}, pauseControllerTxHash=${result.pauseControllerTxHash ?? "none"}, treasuryOwnerTxHash=${result.treasuryOwnerTxHash ?? "none"})`,
  );
  console.log(JSON.stringify(result));
  Provable.log("treasuryOwner", result);
  logger.info(
    `[treasury-owner:deploy] done (elapsedMs=${Date.now() - startedAt})`,
  );
}

export async function transferToTreasury(
  options: TransferToTreasuryCommandOptions,
): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();
  await service.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.transferToTreasury({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    fundingPrivateKey: options.fundingPrivateKey,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    amount: options.amount,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });

  console.log(JSON.stringify(result));
}

export async function readTreasuryOwnerState(
  options: ReadTreasuryOwnerStateCommandOptions,
): Promise<void> {
  const { SqliteTreasuryOwnerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"
  );
  const service = new SqliteTreasuryOwnerService();
  configureMinaNetwork(options.minaNodeUrl);
  const [state, currentLifecyclePeriod] = await Promise.all([
    service.getTreasuryOwnerState({
      minaNodeUrl: options.minaNodeUrl,
      treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
    }),
    service.getCurrentLifecyclePeriod({
      minaNodeUrl: options.minaNodeUrl,
      treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
      lifecyclePeriodDuration: options.lifecyclePeriodDuration,
    }),
  ]);
  console.log(
    JSON.stringify({
      ...state,
      currentLifecyclePeriod,
    }),
  );
}

export default function treasuryOwnerCommandFactory(program: Command) {
  const command = program
    .command("treasury-owner")
    .description("Treasury owner contract commands");

  command
    .command("compile")
    .description("Compile treasury owner contracts and dependencies")
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(compileTreasuryOwner);

  command
    .command("deploy")
    .description("Deploy treasury owner and pause controller contracts")
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
        "--treasury-owner-private-key <treasury-owner-private-key>",
        "Treasury owner private key",
      )
        .env("TREASURY_OWNER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--pause-controller-private-key <pause-controller-private-key>",
        "Pause controller private key",
      )
        .env("PAUSE_CONTROLLER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-deployed-at-slot <treasury-deployed-at-slot>",
        "Slot at which the treasury lifecycle starts",
      )
        .env("TREASURY_DEPLOYED_AT_SLOT")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(0)),
    )
    .addOption(
      new Option(
        "--multisig-participants-public-keys <multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig public keys`,
      )
        .env("MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--allow-deploy-to-existing-account <allow-deploy-to-existing-account>",
        "Disable deploy isNew precondition for treasury owner (unsafe for initial production deploy)",
      )
        .env("ALLOW_DEPLOY_TO_EXISTING_ACCOUNT")
        .argParser(parseBooleanOption)
        .default(false),
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
    .action(deployTreasuryOwner);

  command
    .command("fund-treasury")
    .description("Fund treasury owner account via proof-authorized receive")
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
        "--funding-private-key <funding-private-key>",
        "Funding account private key (defaults to sender private key)",
      )
        .env("FUNDING_PRIVATE_KEY")
        .argParser(parsePrivateKey),
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
      new Option("--amount <amount>", "Transfer amount in nanomina")
        .env("TRANSFER_AMOUNT")
        .argParser((value) => UInt64.from(value))
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
    .action(transferToTreasury);

  command
    .command("read-state")
    .description(
      "Read treasury owner on-chain state fields and current lifecycle period",
    )
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
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    )
    .action(readTreasuryOwnerState);
}
