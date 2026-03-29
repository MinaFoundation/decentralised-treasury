import { Command, Option } from "commander";
import { PrivateKey, PublicKey, UInt64 } from "o1js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { logger } from "@repo/sdk/src/index.js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import { configureMinaNetwork } from "./mina-instance.js";

interface BasePauseControllerCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPublicKey: PublicKey;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
}

interface CompilePauseControllerCommandOptions {
  cachePath?: string;
}

interface DeployPauseControllerCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPrivateKey: PrivateKey;
  multisigParticipantsPublicKeys: PublicKey[];
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
}

interface PauseTreasuryCommandOptions extends BasePauseControllerCommandOptions {
  multisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
}

interface UnpauseTreasuryCommandOptions extends BasePauseControllerCommandOptions {
  multisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
}

interface TogglePauseProposalCommandOptions
  extends BasePauseControllerCommandOptions {
  proposalPublicKey: PublicKey;
  multisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
}

interface RotateMultisigKeysCommandOptions
  extends BasePauseControllerCommandOptions {
  currentMultisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
  newMultisigParticipantsPublicKeys: PublicKey[];
}

interface ReadPauseControllerStateCommandOptions {
  minaNodeUrl: string;
  pauseControllerPublicKey: PublicKey;
}

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

function parseMultisigSignatures(value: string): MultisigSignatures {
  const signatures = value
    .split(",")
    .map((signature) => signature.trim())
    .filter((signature) => signature.length > 0)
    .map(
      (signature) =>
        MultisigSignature.fromBase58(signature) as unknown as MultisigSignature,
    );
  if (signatures.length !== MULTISIG_PARTICIPANTS_COUNT) {
    throw new Error(
      `Expected ${MULTISIG_PARTICIPANTS_COUNT} multisig signatures, got ${signatures.length}`,
    );
  }
  return new MultisigSignatures({ signatures });
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

export async function compilePauseController(
  options: CompilePauseControllerCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  const result = await service.compile({
    cachePath: options.cachePath,
  });
  console.log(
    JSON.stringify({
      compiled: {
        pauseControllerVerificationKey: Boolean(
          result.pauseControllerVerificationKey,
        ),
      },
    }),
  );
}

export async function deployPauseController(
  options: DeployPauseControllerCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  logger.info(
    `[pause-controller:deploy] compiling pause controller (participants=${options.multisigParticipantsPublicKeys.length})`,
  );
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.deploy({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    pauseControllerPrivateKey: options.pauseControllerPrivateKey,
    multisigParticipantsPublicKeys: options.multisigParticipantsPublicKeys,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });
  console.log(
    JSON.stringify({
      ...result,
      multisigCommitment: MultisigSignatures.createCommitment(
        options.multisigParticipantsPublicKeys,
      ).toString(),
    }),
  );
}

export async function readPauseControllerState(
  options: ReadPauseControllerStateCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.getPauseControllerState({
    minaNodeUrl: options.minaNodeUrl,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
  });
  console.log(JSON.stringify(result));
}

export async function pauseTreasury(
  options: PauseTreasuryCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.pauseTreasury({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
    multisigParticipantsPublicKeys: options.multisigParticipantsPublicKeys,
    signatures: options.multisigSignatures,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });
  console.log(JSON.stringify(result));
}

export async function unpauseTreasury(
  options: UnpauseTreasuryCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.unpauseTreasury({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
    multisigParticipantsPublicKeys: options.multisigParticipantsPublicKeys,
    signatures: options.multisigSignatures,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });
  console.log(JSON.stringify(result));
}

export async function togglePauseProposal(
  options: TogglePauseProposalCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.togglePauseProposal({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
    proposalPublicKey: options.proposalPublicKey,
    multisigParticipantsPublicKeys: options.multisigParticipantsPublicKeys,
    signatures: options.multisigSignatures,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });
  console.log(JSON.stringify(result));
}

export async function rotateMultisigKeys(
  options: RotateMultisigKeysCommandOptions,
): Promise<void> {
  const { SqlitePauseControllerService } = await import(
    "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"
  );
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl);
  const result = await service.rotateMultisigKeys({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: options.senderPrivateKey,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
    currentMultisigParticipantsPublicKeys:
      options.currentMultisigParticipantsPublicKeys,
    signatures: options.multisigSignatures,
    newMultisigParticipantsPublicKeys: options.newMultisigParticipantsPublicKeys,
    fee: options.fee,
    nonce: options.nonce,
    memo: options.memo,
    wait: options.wait,
  });
  console.log(JSON.stringify(result));
}

export default function pauseControllerCommandFactory(program: Command) {
  const command = program
    .command("pause-controller")
    .description("Pause controller contract commands");

  command
    .command("compile")
    .description("Compile pause controller contract")
    .addOption(
      new Option("--cache-path <cache-path>", "Optional compile cache directory").env(
        "CACHE_PATH",
      ),
    )
    .action(compilePauseController);

  command
    .command("deploy")
    .description("Deploy pause controller contract")
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
        "--pause-controller-private-key <pause-controller-private-key>",
        "Pause controller private key",
      )
        .env("PAUSE_CONTROLLER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-participants-public-keys <multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig participant public keys`,
      )
        .env("MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
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
    .action(deployPauseController);

  command
    .command("read-state")
    .description("Read pause controller on-chain state fields")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option(
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .action(readPauseControllerState);

  command
    .command("pause-treasury")
    .description("Pause treasury operations via multisig")
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
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-participants-public-keys <multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig participant public keys`,
      )
        .env("MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-signatures <multisig-signatures>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order`,
      )
        .env("MULTISIG_SIGNATURES")
        .argParser(parseMultisigSignatures)
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
    .action(pauseTreasury);

  command
    .command("unpause-treasury")
    .description("Unpause treasury operations via multisig")
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
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-participants-public-keys <multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig participant public keys`,
      )
        .env("MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-signatures <multisig-signatures>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order`,
      )
        .env("MULTISIG_SIGNATURES")
        .argParser(parseMultisigSignatures)
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
    .action(unpauseTreasury);

  command
    .command("toggle-pause-proposal")
    .description("Authorize pause toggle for a proposal via multisig")
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
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
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
        "--multisig-participants-public-keys <multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig participant public keys`,
      )
        .env("MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-signatures <multisig-signatures>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order`,
      )
        .env("MULTISIG_SIGNATURES")
        .argParser(parseMultisigSignatures)
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
    .action(togglePauseProposal);

  command
    .command("rotate-multisig-keys")
    .description("Rotate multisig participants commitment")
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
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--current-multisig-participants-public-keys <current-multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} current multisig participant public keys`,
      )
        .env("CURRENT_MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--multisig-signatures <multisig-signatures>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with current participant order`,
      )
        .env("MULTISIG_SIGNATURES")
        .argParser(parseMultisigSignatures)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--new-multisig-participants-public-keys <new-multisig-participants-public-keys>",
        `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} new multisig participant public keys`,
      )
        .env("NEW_MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
        .argParser(parsePublicKeys)
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
    .action(rotateMultisigKeys);
}

