import { Command, Option, InvalidArgumentError } from "commander";
import { Field, PrivateKey, PublicKey, UInt32 } from "o1js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { signFieldWithLedger } from "../ledger/ledger-signing.js";
import { parseIntOption } from "./option-parsers.js";

type SignerMode = "in-memory" | "ledger";

interface BaseSignOptions {
  multisigParticipantsPublicKeys: PublicKey[];
  multisigSignerPrivateKey?: PrivateKey;
  signer: SignerMode;
  nonce: number;
}

interface SignPauseTreasuryOptions extends BaseSignOptions {}

interface SignUnpauseTreasuryOptions extends BaseSignOptions {}

interface SignTogglePauseProposalOptions extends BaseSignOptions {
  proposalPublicKey: PublicKey;
}

interface SignRotateMultisigKeysOptions extends BaseSignOptions {
  newMultisigParticipantsPublicKeys: PublicKey[];
}

interface MultisigSignCommandResult {
  type: string;
  nonce: string;
  dataHash: string;
  multisigCommitment: string;
  multisigParticipantsPublicKeys: string[];
  signerPublicKey: string;
  signerParticipantIndex: number;
  signature: string;
  validSignaturesCount: number;
  proposalPublicKey?: string;
  previousMultisigCommitment?: string;
  newMultisigCommitment?: string;
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
    throw new InvalidArgumentError(
      `Expected ${MULTISIG_PARTICIPANTS_COUNT} multisig public keys, got ${keys.length}`,
    );
  }
  return keys;
}

function parseSignerPrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function ledgerSignerPublicKey(): PublicKey {
  const value = process.env.LEDGER_SIGNER_PUBLIC_KEY?.trim();
  if (!value) {
    throw new Error(
      "LEDGER_SIGNER_PUBLIC_KEY is required when --signer=ledger.",
    );
  }
  return PublicKey.fromBase58(value);
}

async function buildSignaturesResult(
  type: string,
  options: BaseSignOptions,
  dataHash: Field,
  extra: Partial<MultisigSignCommandResult> = {},
): Promise<MultisigSignCommandResult> {
  const participantPublicKeyStrings =
    options.multisigParticipantsPublicKeys.map((pk) => pk.toBase58());

  const signerPublicKey =
    options.signer === "ledger"
      ? ledgerSignerPublicKey()
      : options.multisigSignerPrivateKey?.toPublicKey();
  if (!signerPublicKey) {
    throw new Error(
      "--multisig-signer-private-key is required when --signer=in-memory.",
    );
  }
  const signerPublicKeyBase58 = signerPublicKey.toBase58();
  const signerParticipantIndex = participantPublicKeyStrings.indexOf(
    signerPublicKeyBase58,
  );
  if (signerParticipantIndex < 0) {
    throw new Error(
      `Signer public key ${signerPublicKeyBase58} is not part of --multisig-participants-public-keys`,
    );
  }

  const signature =
    options.signer === "ledger"
      ? await signFieldWithLedger(dataHash)
      : MultisigSignature.create(options.multisigSignerPrivateKey!, [dataHash]);

  const multisigCommitment = MultisigSignatures.createCommitment(
    options.multisigParticipantsPublicKeys,
  ).toString();

  return {
    type,
    nonce: UInt32.from(options.nonce).toString(),
    dataHash: dataHash.toString(),
    multisigCommitment,
    multisigParticipantsPublicKeys: participantPublicKeyStrings,
    signerPublicKey: signerPublicKeyBase58,
    signerParticipantIndex,
    signature: signature.toBase58(),
    validSignaturesCount: 1,
    ...extra,
  };
}

export async function signPauseTreasury(
  options: SignPauseTreasuryOptions,
): Promise<void> {
  const nonce = UInt32.from(options.nonce);
  const dataHash = MultisigSignature.dataPauseTreasury(nonce);
  console.log(
    JSON.stringify(
      await buildSignaturesResult("pause-treasury", options, dataHash),
    ),
  );
}

export async function signUnpauseTreasury(
  options: SignUnpauseTreasuryOptions,
): Promise<void> {
  const nonce = UInt32.from(options.nonce);
  const dataHash = MultisigSignature.dataUnpauseTreasury(nonce);
  console.log(
    JSON.stringify(
      await buildSignaturesResult("unpause-treasury", options, dataHash),
    ),
  );
}

export async function signTogglePauseProposal(
  options: SignTogglePauseProposalOptions,
): Promise<void> {
  const nonce = UInt32.from(options.nonce);
  const dataHash = MultisigSignature.dataTogglePauseProposal(
    options.proposalPublicKey,
    nonce,
  );
  console.log(
    JSON.stringify(
      await buildSignaturesResult("toggle-pause-proposal", options, dataHash, {
        proposalPublicKey: options.proposalPublicKey.toBase58(),
      }),
    ),
  );
}

export async function signRotateMultisigKeys(
  options: SignRotateMultisigKeysOptions,
): Promise<void> {
  const nonce = UInt32.from(options.nonce);
  const previousMultisigCommitment = MultisigSignatures.createCommitment(
    options.multisigParticipantsPublicKeys,
  );
  const newMultisigCommitment = MultisigSignatures.createCommitment(
    options.newMultisigParticipantsPublicKeys,
  );
  const dataHash = MultisigSignature.dataRotateMultisigKeys(
    previousMultisigCommitment,
    newMultisigCommitment,
    nonce,
  );
  console.log(
    JSON.stringify(
      await buildSignaturesResult("rotate-multisig-keys", options, dataHash, {
        previousMultisigCommitment: previousMultisigCommitment.toString(),
        newMultisigCommitment: newMultisigCommitment.toString(),
      }),
    ),
  );
}

export default function multisigSignCommandFactory(program: Command) {
  const command = program
    .command("multisig-sign")
    .description("Sign pause-controller multisig messages");

  const baseOptions = (subcommand: Command) =>
    subcommand
      .addOption(
        new Option("--signer <signer>", "Signing implementation")
          .choices(["in-memory", "ledger"])
          .default("in-memory")
          .env("SIGNER"),
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
          "--multisig-signer-private-key <multisig-signer-private-key>",
          "Single signer private key for partial multisig signature generation",
        )
          .env("MULTISIG_SIGNER_PRIVATE_KEY")
          .argParser(parseSignerPrivateKey),
      )
      .addOption(
        new Option("--nonce <nonce>", "Pause controller nonce")
          .env("TX_NONCE")
          .argParser(parseIntOption)
          .makeOptionMandatory(),
      );

  baseOptions(
    command
      .command("pause-treasury")
      .description("Sign multisig payload for pause-treasury"),
  ).action(signPauseTreasury);

  baseOptions(
    command
      .command("unpause-treasury")
      .description("Sign multisig payload for unpause-treasury"),
  ).action(signUnpauseTreasury);

  baseOptions(
    command
      .command("toggle-pause-proposal")
      .description("Sign multisig payload for toggle-pause-proposal")
      .addOption(
        new Option(
          "--proposal-public-key <proposal-public-key>",
          "Proposal public key",
        )
          .env("PROPOSAL_PUBLIC_KEY")
          .argParser(parsePublicKey)
          .makeOptionMandatory(),
      ),
  ).action(signTogglePauseProposal);

  baseOptions(
    command
      .command("rotate-multisig-keys")
      .description("Sign multisig payload for rotate-multisig-keys")
      .addOption(
        new Option(
          "--new-multisig-participants-public-keys <new-multisig-participants-public-keys>",
          `Comma separated list of ${MULTISIG_PARTICIPANTS_COUNT} new multisig participant public keys`,
        )
          .env("NEW_MULTISIG_PARTICIPANTS_PUBLIC_KEYS")
          .argParser(parsePublicKeys)
          .makeOptionMandatory(),
      ),
  ).action(signRotateMultisigKeys);
}
