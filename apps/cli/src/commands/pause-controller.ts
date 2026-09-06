import { Command, Option } from "commander";
import { PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import {
  MIN_VALID_MULTISIG_SIGNATURES_COUNT,
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { logger } from "@repo/sdk/src/index.js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import {
  configureMinaNetwork,
  minaNetworkIdOption,
  type MinaNetworkId,
} from "./mina-instance.js";
import {
  addTransactionSignerOptions,
  createLedgerTransactionSigner,
  resolveSigningAccount,
  type SignerMode,
} from "../ledger/transaction-signer.js";

interface BasePauseControllerCommandOptions {
  minaNodeUrl: string;
  networkId: MinaNetworkId;
  signer: SignerMode;
  senderPrivateKey?: PrivateKey;
  senderPublicKey?: PublicKey;
  senderLedgerAccountIndex?: number;
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
  networkId: MinaNetworkId;
  signer: SignerMode;
  senderPrivateKey?: PrivateKey;
  senderPublicKey?: PublicKey;
  senderLedgerAccountIndex?: number;
  pauseControllerPrivateKey?: PrivateKey;
  pauseControllerPublicKey?: PublicKey;
  pauseControllerLedgerAccountIndex?: number;
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

interface TogglePauseProposalCommandOptions extends BasePauseControllerCommandOptions {
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  multisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
  lifecyclePeriodDuration: UInt32;
}

interface RotateMultisigKeysCommandOptions extends BasePauseControllerCommandOptions {
  currentMultisigParticipantsPublicKeys: PublicKey[];
  multisigSignatures: MultisigSignatures;
  newMultisigParticipantsPublicKeys: PublicKey[];
}

interface ReadPauseControllerStateCommandOptions {
  minaNodeUrl: string;
  networkId: MinaNetworkId;
  pauseControllerPublicKey: PublicKey;
}

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

export function parseMultisigSignatures(value: string): MultisigSignatures {
  const signatureSlots = value.split(",").map((signature) => signature.trim());
  if (signatureSlots.length > MULTISIG_PARTICIPANTS_COUNT) {
    throw new Error(
      `Expected at most ${MULTISIG_PARTICIPANTS_COUNT} multisig signature slots, got ${signatureSlots.length}`,
    );
  }

  const signatures = signatureSlots.map((signature, index) => {
    if (signature.length === 0) {
      return MultisigSignature.empty() as unknown as MultisigSignature;
    }
    try {
      return MultisigSignature.fromBase58(
        signature,
      ) as unknown as MultisigSignature;
    } catch {
      throw new Error(`Invalid multisig signature at slot ${index + 1}`);
    }
  });

  const validSignaturesCount = signatureSlots.filter(
    (signature) => signature.length > 0,
  ).length;
  if (validSignaturesCount < MIN_VALID_MULTISIG_SIGNATURES_COUNT) {
    throw new Error(
      `Expected at least ${MIN_VALID_MULTISIG_SIGNATURES_COUNT} multisig signatures, got ${validSignaturesCount}`,
    );
  }

  while (signatures.length < MULTISIG_PARTICIPANTS_COUNT) {
    signatures.push(MultisigSignature.empty() as unknown as MultisigSignature);
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
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
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
  const sender = resolveSigningAccount({
    signer: options.signer,
    label: "Sender",
    privateKey: options.senderPrivateKey,
    publicKey: options.senderPublicKey,
    ledgerAccountIndex: options.senderLedgerAccountIndex,
  });
  const pauseController = resolveSigningAccount({
    signer: options.signer,
    label: "Pause controller",
    privateKey: options.pauseControllerPrivateKey,
    publicKey: options.pauseControllerPublicKey,
    ledgerAccountIndex: options.pauseControllerLedgerAccountIndex,
  });
  const transactionSigner = createLedgerTransactionSigner(
    options.signer,
    [sender, pauseController],
    options.networkId,
  );
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
  const service = new SqlitePauseControllerService();
  logger.info(
    `[pause-controller:deploy] compiling pause controller (participants=${options.multisigParticipantsPublicKeys.length})`,
  );
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.deploy({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: sender.privateKey,
    senderPublicKey: sender.publicKey,
    pauseControllerPrivateKey: pauseController.privateKey,
    pauseControllerPublicKey: pauseController.publicKey,
    transactionSigner,
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
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
  const service = new SqlitePauseControllerService();
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.getPauseControllerState({
    minaNodeUrl: options.minaNodeUrl,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
  });
  console.log(JSON.stringify(result));
}

export async function pauseTreasury(
  options: PauseTreasuryCommandOptions,
): Promise<void> {
  const sender = resolveSigningAccount({
    signer: options.signer,
    label: "Sender",
    privateKey: options.senderPrivateKey,
    publicKey: options.senderPublicKey,
    ledgerAccountIndex: options.senderLedgerAccountIndex,
  });
  const transactionSigner = createLedgerTransactionSigner(
    options.signer,
    [sender],
    options.networkId,
  );
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.pauseTreasury({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: sender.privateKey,
    senderPublicKey: sender.publicKey,
    transactionSigner,
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
  const sender = resolveSigningAccount({
    signer: options.signer,
    label: "Sender",
    privateKey: options.senderPrivateKey,
    publicKey: options.senderPublicKey,
    ledgerAccountIndex: options.senderLedgerAccountIndex,
  });
  const transactionSigner = createLedgerTransactionSigner(
    options.signer,
    [sender],
    options.networkId,
  );
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.unpauseTreasury({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: sender.privateKey,
    senderPublicKey: sender.publicKey,
    transactionSigner,
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
  const sender = resolveSigningAccount({
    signer: options.signer,
    label: "Sender",
    privateKey: options.senderPrivateKey,
    publicKey: options.senderPublicKey,
    ledgerAccountIndex: options.senderLedgerAccountIndex,
  });
  const transactionSigner = createLedgerTransactionSigner(
    options.signer,
    [sender],
    options.networkId,
  );
  const [{ SqlitePauseControllerService }, { SqliteTreasuryOwnerService }] =
    await Promise.all([
      import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js"),
      import("@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js"),
    ]);
  const service = new SqlitePauseControllerService();
  const treasuryOwnerService = new SqliteTreasuryOwnerService();
  await treasuryOwnerService.compile({
    lifecyclePeriodDuration: options.lifecyclePeriodDuration,
  });
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.togglePauseProposal({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: sender.privateKey,
    senderPublicKey: sender.publicKey,
    transactionSigner,
    treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
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
  const sender = resolveSigningAccount({
    signer: options.signer,
    label: "Sender",
    privateKey: options.senderPrivateKey,
    publicKey: options.senderPublicKey,
    ledgerAccountIndex: options.senderLedgerAccountIndex,
  });
  const transactionSigner = createLedgerTransactionSigner(
    options.signer,
    [sender],
    options.networkId,
  );
  const { SqlitePauseControllerService } =
    await import("@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js");
  const service = new SqlitePauseControllerService();
  await service.compile();
  configureMinaNetwork(options.minaNodeUrl, options.networkId);
  const result = await service.rotateMultisigKeys({
    minaNodeUrl: options.minaNodeUrl,
    senderPrivateKey: sender.privateKey,
    senderPublicKey: sender.publicKey,
    transactionSigner,
    pauseControllerPublicKey: options.pauseControllerPublicKey,
    currentMultisigParticipantsPublicKeys:
      options.currentMultisigParticipantsPublicKeys,
    signatures: options.multisigSignatures,
    newMultisigParticipantsPublicKeys:
      options.newMultisigParticipantsPublicKeys,
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
      new Option(
        "--cache-path <cache-path>",
        "Optional compile cache directory",
      ).env("CACHE_PATH"),
    )
    .action(compilePauseController);

  const deployCommand = command
    .command("deploy")
    .description("Deploy pause controller contract")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
    )
    .addOption(
      new Option(
        "--pause-controller-private-key <pause-controller-private-key>",
        "Pause controller private key",
      )
        .env("PAUSE_CONTROLLER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
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
    );
  addTransactionSignerOptions(deployCommand, [
    { role: "sender", label: "Sender" },
    { role: "pause-controller", label: "Pause controller" },
  ]).action(deployPauseController);

  command
    .command("read-state")
    .description("Read pause controller on-chain state fields")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
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

  const pauseTreasuryCommand = command
    .command("pause-treasury")
    .description("Pause treasury operations via multisig")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
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
        `Comma separated list of ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}-${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order; empty entries preserve missing slots (e.g. sig1,,sig3), and unspecified trailing slots are padded with empty signatures`,
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
    );
  addTransactionSignerOptions(pauseTreasuryCommand, [
    { role: "sender", label: "Sender" },
  ]).action(pauseTreasury);

  const unpauseTreasuryCommand = command
    .command("unpause-treasury")
    .description("Unpause treasury operations via multisig")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
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
        `Comma separated list of ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}-${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order; empty entries preserve missing slots (e.g. sig1,,sig3), and unspecified trailing slots are padded with empty signatures`,
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
    );
  addTransactionSignerOptions(unpauseTreasuryCommand, [
    { role: "sender", label: "Sender" },
  ]).action(unpauseTreasury);

  const togglePauseProposalCommand = command
    .command("toggle-pause-proposal")
    .description(
      "Toggle proposal pause via treasury-owner with multisig authorization",
    )
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
    )
    .addOption(
      new Option(
        "--pause-controller-public-key <pause-controller-public-key>",
        "Pause controller public key (must match treasury owner state)",
      )
        .env("PAUSE_CONTROLLER_PUBLIC_KEY")
        .argParser(parsePublicKey)
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
      new Option(
        "--proposal-public-key <proposal-public-key>",
        "Proposal public key",
      )
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
        `Comma separated list of ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}-${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with participant order; empty entries preserve missing slots (e.g. sig1,,sig3), and unspecified trailing slots are padded with empty signatures`,
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
    .addOption(
      new Option(
        "--lifecycle-period-duration <lifecycle-period-duration>",
        "Duration of lifecycle period in slots (must match treasury owner compile config)",
      )
        .env("LIFECYCLE_PERIOD_DURATION")
        .argParser((value) => UInt32.from(value))
        .default(UInt32.from(7140)),
    );
  addTransactionSignerOptions(togglePauseProposalCommand, [
    { role: "sender", label: "Sender" },
  ]).action(togglePauseProposal);

  const rotateMultisigKeysCommand = command
    .command("rotate-multisig-keys")
    .description("Rotate multisig participants commitment")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
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
        `Comma separated list of ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}-${MULTISIG_PARTICIPANTS_COUNT} multisig signatures (base58) aligned with current participant order; empty entries preserve missing slots (e.g. sig1,,sig3), and unspecified trailing slots are padded with empty signatures`,
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
    );
  addTransactionSignerOptions(rotateMultisigKeysCommand, [
    { role: "sender", label: "Sender" },
  ]).action(rotateMultisigKeys);
}
