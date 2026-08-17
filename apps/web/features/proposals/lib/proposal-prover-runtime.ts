import {
  assertZkappUriWithinByteLimit,
  hashMarkdownContentToZkappUri,
} from "@repo/sdk/src/utils/proposal-content-hash.js";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";

const MINA_DECIMALS = 1_000_000_000n;

export interface PrepareCreateProposalTransactionInput {
  minaNodeUrl: string;
  treasuryOwnerContractAddress: string;
  senderAddress: string;
  lifecycleId: number;
  recipient: string;
  amount: string;
  contents: string;
  fee: string;
  nonce?: number;
  memo: string;
}

export interface PreparedCreateProposalTransaction {
  proposalPublicKey: string;
  proposalZkAppUri: string;
  zkAppUriHash: string;
  transactionJson: string;
}

interface ConstructedCreateProposalTransaction {
  transaction: any;
  proposalPrivateKey: any;
  preparedTransaction: Omit<
    PreparedCreateProposalTransaction,
    "transactionJson"
  >;
}

export type ProposalVoteChoice = "yay" | "nay" | "abstain";

export interface PrepareVoteProposalTransactionInput {
  minaNodeUrl: string;
  treasuryOwnerContractAddress: string;
  senderAddress: string;
  proposalPublicKey: string;
  vote: ProposalVoteChoice;
  fee: string;
  nonce?: number;
  memo: string;
}

export interface PreparedVoteProposalTransaction {
  proposalPublicKey: string;
  vote: ProposalVoteChoice;
  transactionJson: string;
}

interface ConstructedVoteProposalTransaction {
  transaction: any;
  preparedTransaction: Omit<PreparedVoteProposalTransaction, "transactionJson">;
}

interface ConstructedExecuteProposalTransaction {
  transaction: any;
  preparedTransaction: Omit<
    PreparedExecuteProposalTransaction,
    "transactionJson"
  >;
}

export interface PrepareExecuteProposalTransactionInput {
  minaNodeUrl: string;
  treasuryOwnerContractAddress: string;
  senderAddress: string;
  proposalPublicKey: string;
  recipient: string;
  amount: string;
  fee: string;
  nonce?: number;
  memo: string;
}

export interface PreparedExecuteProposalTransaction {
  proposalPublicKey: string;
  recipient: string;
  amount: string;
  transactionJson: string;
}

export interface SerializedProposalCompileArtifacts {
  lifecyclePeriodDuration: string;
  voteReducerVerificationKeyJson: string;
  stakingLedgerToVotingLedgerVerificationKeyJson: string;
  treasuryProposalVerificationKeyJson: string;
  emptyNullifierRoot: string;
  emptyVotingLedgerRoot: string;
}

interface ProposalProverOptions {
  proofsEnabled?: boolean;
}

function getRuntimeOrigin(): string | undefined {
  return typeof globalThis.location?.origin === "string"
    ? globalThis.location.origin
    : undefined;
}

function resolveProverEndpointUrl(endpointRoot: string): string {
  const trimmedEndpointRoot = endpointRoot.trim();
  const runtimeOrigin = getRuntimeOrigin();

  if (!runtimeOrigin && !/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedEndpointRoot)) {
    throw new Error(
      `Relative endpoint URL requires a browser origin: ${endpointRoot}`,
    );
  }

  return new URL(trimmedEndpointRoot, runtimeOrigin).toString();
}

interface TransactionAuthorizationSummaryItem {
  index: number;
  publicKey?: string;
  isSigned: boolean;
  isProved: boolean;
  hasSignature: boolean;
  hasProof: boolean;
}

function summarizeTransactionAuthorization(transactionJson: string): {
  feePayerAuthType: string;
  accountUpdates: TransactionAuthorizationSummaryItem[];
} {
  const parsed = JSON.parse(transactionJson) as {
    feePayer?: { authorization?: unknown };
    accountUpdates?: Array<{
      body?: {
        publicKey?: string;
        authorizationKind?: {
          isSigned?: boolean;
          isProved?: boolean;
        };
      };
      authorization?: {
        signature?: unknown;
        proof?: unknown;
      };
    }>;
  };

  return {
    feePayerAuthType: typeof parsed.feePayer?.authorization,
    accountUpdates:
      parsed.accountUpdates?.map((accountUpdate, index) => ({
        index,
        publicKey: accountUpdate.body?.publicKey,
        isSigned: Boolean(accountUpdate.body?.authorizationKind?.isSigned),
        isProved: Boolean(accountUpdate.body?.authorizationKind?.isProved),
        hasSignature: accountUpdate.authorization?.signature != null,
        hasProof: accountUpdate.authorization?.proof != null,
      })) ?? [],
  };
}

function logTransactionAuthorizationSummary(
  label: string,
  transactionJson: string,
): void {
  try {
    const parsed = summarizeTransactionAuthorization(transactionJson);
    console.info(`[proposal-prover][tx-json] ${label}`, {
      feePayerAuthType: parsed.feePayerAuthType,
      accountUpdates: parsed.accountUpdates,
    });
  } catch (error) {
    console.error(
      "[proposal-prover][tx-json] failed to inspect transaction json",
      {
        label,
        error,
      },
    );
  }
}

function logExpectedSignerCoverage(
  label: string,
  transactionJson: string,
  signerPublicKeys: string[],
): void {
  try {
    const parsed = summarizeTransactionAuthorization(transactionJson);
    const signerKeySet = new Set(signerPublicKeys);
    console.info(`[proposal-prover][tx-json] ${label}`, {
      signerPublicKeys,
      feePayerAuthType: parsed.feePayerAuthType,
      matchingSignedAccountUpdates: parsed.accountUpdates.filter(
        (accountUpdate) =>
          accountUpdate.isSigned &&
          accountUpdate.publicKey != null &&
          signerKeySet.has(accountUpdate.publicKey),
      ),
    });
  } catch (error) {
    console.error(
      "[proposal-prover][tx-json] failed to inspect signer coverage",
      {
        label,
        signerPublicKeys,
        error,
      },
    );
  }
}

function assertProofsPresent(label: string, transactionJson: string): void {
  const summary = summarizeTransactionAuthorization(transactionJson);
  const missingProofs = summary.accountUpdates.filter(
    (accountUpdate) => accountUpdate.isProved && !accountUpdate.hasProof,
  );
  if (missingProofs.length === 0) {
    return;
  }
  console.error("[proposal-prover][tx-json] missing proofs after prove", {
    label,
    missingProofs,
  });
  throw new Error(
    `Proof generation did not populate all proved account updates: ${missingProofs
      .map(
        (accountUpdate) =>
          `${accountUpdate.index}:${accountUpdate.publicKey ?? "unknown"}`,
      )
      .join(", ")}`,
  );
}

let compileContractsPromise: Promise<void> | null = null;
let compileContractsProofsEnabled: boolean | null = null;
let compiledProposalCompileArtifacts: SerializedProposalCompileArtifacts | null =
  null;

function parseJsonStringValue(value: string): unknown {
  const candidates = [value];

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    candidates.push(value.slice(1, -1));
  }

  if (value.includes('\\"')) {
    candidates.push(value.replace(/\\"/g, '"'));
  }

  if (
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) &&
    value.slice(1, -1).includes('\\"')
  ) {
    candidates.push(value.slice(1, -1).replace(/\\"/g, '"'));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        return JSON.parse(parsed);
      }
      return parsed;
    } catch {
      // Try the next normalization shape.
    }
  }

  throw new Error("Failed to parse browser prover JSON configuration.");
}

function getConfiguredProposalCompileArtifacts(): SerializedProposalCompileArtifacts {
  const runtimeConfig = getRuntimeConfig();
  const lifecyclePeriodDuration = runtimeConfig.lifecyclePeriodDuration;
  const voteReducerVerificationKeyJson =
    runtimeConfig.voteReducerVerificationKeyJson;
  const stakingLedgerToVotingLedgerVerificationKeyJson =
    runtimeConfig.stakingLedgerToVotingLedgerVerificationKeyJson;
  const treasuryProposalVerificationKeyJson =
    runtimeConfig.treasuryProposalVerificationKeyJson;
  const emptyNullifierRoot = runtimeConfig.emptyNullifierRoot;
  const emptyVotingLedgerRoot = runtimeConfig.emptyVotingLedgerRoot;

  const missingName =
    typeof lifecyclePeriodDuration !== "string" ||
    lifecyclePeriodDuration.trim().length === 0
      ? "NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION"
      : typeof voteReducerVerificationKeyJson !== "string" ||
          voteReducerVerificationKeyJson.trim().length === 0
        ? "NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON"
        : typeof stakingLedgerToVotingLedgerVerificationKeyJson !== "string" ||
            stakingLedgerToVotingLedgerVerificationKeyJson.trim().length === 0
          ? "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON"
          : typeof treasuryProposalVerificationKeyJson !== "string" ||
              treasuryProposalVerificationKeyJson.trim().length === 0
            ? "NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON"
            : typeof emptyNullifierRoot !== "string" ||
                emptyNullifierRoot.trim().length === 0
              ? "NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT"
              : typeof emptyVotingLedgerRoot !== "string" ||
                  emptyVotingLedgerRoot.trim().length === 0
                ? "NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT"
                : null;

  if (missingName) {
    throw new Error(
      `Missing required browser prover config: ${missingName}. Run the treasury-owner CLI compile command and copy the emitted browserEnv values into apps/web/.env.dev, apps/web/.env.testnet, or apps/web/.env.local-blockchain - or, when running a published image, into the web container's environment.`,
    );
  }

  const configuredLifecyclePeriodDuration = lifecyclePeriodDuration as string;
  const configuredVoteReducerVerificationKeyJson =
    voteReducerVerificationKeyJson as string;
  const configuredStakingLedgerToVotingLedgerVerificationKeyJson =
    stakingLedgerToVotingLedgerVerificationKeyJson as string;
  const configuredTreasuryProposalVerificationKeyJson =
    treasuryProposalVerificationKeyJson as string;
  const configuredEmptyNullifierRoot = emptyNullifierRoot as string;
  const configuredEmptyVotingLedgerRoot = emptyVotingLedgerRoot as string;

  return {
    lifecyclePeriodDuration: configuredLifecyclePeriodDuration,
    voteReducerVerificationKeyJson: configuredVoteReducerVerificationKeyJson,
    stakingLedgerToVotingLedgerVerificationKeyJson:
      configuredStakingLedgerToVotingLedgerVerificationKeyJson,
    treasuryProposalVerificationKeyJson:
      configuredTreasuryProposalVerificationKeyJson,
    emptyNullifierRoot: configuredEmptyNullifierRoot,
    emptyVotingLedgerRoot: configuredEmptyVotingLedgerRoot,
  };
}

export async function getProposalModules(): Promise<{
  o1js: any;
  TreasuryOwnerSmartContract: any;
  TreasuryPauseControllerSmartContract: any;
  TreasuryProposalSmartContract: any;
  LIFECYCLE_PERIOD_DURATION: any;
  MULTISIG_PARTICIPANTS_COUNT: number;
  Vote: any;
}> {
  const [
    o1js,
    ownerModule,
    pauseControllerModule,
    multisigSignaturesModule,
    proposalModule,
    voteReducerModule,
  ] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-owner.js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js"),
    import("@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js"),
    import("@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js"),
  ]);

  return {
    o1js,
    TreasuryOwnerSmartContract: (
      ownerModule as { TreasuryOwnerSmartContract: any }
    ).TreasuryOwnerSmartContract,
    TreasuryPauseControllerSmartContract: (
      pauseControllerModule as {
        TreasuryPauseControllerSmartContract: any;
      }
    ).TreasuryPauseControllerSmartContract,
    TreasuryProposalSmartContract: (
      proposalModule as { TreasuryProposalSmartContract: any }
    ).TreasuryProposalSmartContract,
    LIFECYCLE_PERIOD_DURATION: (
      ownerModule as unknown as { LIFECYCLE_PERIOD_DURATION: any }
    ).LIFECYCLE_PERIOD_DURATION,
    MULTISIG_PARTICIPANTS_COUNT: (
      multisigSignaturesModule as {
        MULTISIG_PARTICIPANTS_COUNT: number;
      }
    ).MULTISIG_PARTICIPANTS_COUNT,
    Vote: (voteReducerModule as { Vote: any }).Vote,
  };
}

export async function compileProposalContractsInCurrentThread(
  options?: ProposalProverOptions,
): Promise<void> {
  const proofsEnabled = options?.proofsEnabled ?? true;
  if (
    !compileContractsPromise ||
    compileContractsProofsEnabled !== proofsEnabled
  ) {
    compileContractsPromise = (async () => {
      const configuredArtifacts = getConfiguredProposalCompileArtifacts();
      const {
        o1js,
        TreasuryOwnerSmartContract,
        TreasuryPauseControllerSmartContract,
        TreasuryProposalSmartContract,
        MULTISIG_PARTICIPANTS_COUNT,
      } = await getProposalModules();
      const { UInt32, VerificationKey } = o1js;
      await applySerializedProposalCompileArtifactsInCurrentThread(
        configuredArtifacts,
      );
      TreasuryOwnerSmartContract.lifecyclePeriodDuration = UInt32.from(
        configuredArtifacts.lifecyclePeriodDuration,
      );
      TreasuryPauseControllerSmartContract.multisigParticipants = Array.from(
        { length: MULTISIG_PARTICIPANTS_COUNT },
        () => o1js.PublicKey.empty(),
      );
      const { verificationKey: treasuryProposalVerificationKey } =
        await TreasuryProposalSmartContract.compile();
      TreasuryOwnerSmartContract.proposalContractVerificationKey =
        treasuryProposalVerificationKey;
      await TreasuryPauseControllerSmartContract.compile();
      await TreasuryOwnerSmartContract.compile();
      compiledProposalCompileArtifacts = {
        ...configuredArtifacts,
        treasuryProposalVerificationKeyJson: JSON.stringify(
          VerificationKey.toJSON(treasuryProposalVerificationKey),
        ),
      };
    })();
    compileContractsProofsEnabled = proofsEnabled;
  }

  await compileContractsPromise;
}

export async function serializeProposalCompileArtifactsInCurrentThread(options?: {
  proofsEnabled?: boolean;
}): Promise<SerializedProposalCompileArtifacts> {
  await compileProposalContractsInCurrentThread(options);
  return (
    compiledProposalCompileArtifacts ?? getConfiguredProposalCompileArtifacts()
  );
}

export async function applySerializedProposalCompileArtifactsInCurrentThread(
  artifacts: SerializedProposalCompileArtifacts,
): Promise<void> {
  const { o1js, TreasuryOwnerSmartContract, TreasuryProposalSmartContract } =
    await getProposalModules();
  const { Field, UInt32, VerificationKey } = o1js;
  const voteReducerVerificationKey = VerificationKey.fromJSON(
    parseJsonStringValue(artifacts.voteReducerVerificationKeyJson),
  );
  const stakingLedgerToVotingLedgerVerificationKey = VerificationKey.fromJSON(
    parseJsonStringValue(
      artifacts.stakingLedgerToVotingLedgerVerificationKeyJson,
    ),
  );
  const treasuryProposalVerificationKey = VerificationKey.fromJSON(
    parseJsonStringValue(artifacts.treasuryProposalVerificationKeyJson),
  );
  TreasuryOwnerSmartContract.lifecyclePeriodDuration = UInt32.from(
    artifacts.lifecyclePeriodDuration,
  );
  TreasuryProposalSmartContract.voteReducerVerificationKey =
    voteReducerVerificationKey;
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    stakingLedgerToVotingLedgerVerificationKey;
  TreasuryProposalSmartContract.emptyNullifierRoot = Field(
    artifacts.emptyNullifierRoot,
  );
  TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(
    artifacts.emptyVotingLedgerRoot,
  );
  TreasuryProposalSmartContract._verificationKey =
    treasuryProposalVerificationKey;
  TreasuryOwnerSmartContract.proposalContractVerificationKey =
    treasuryProposalVerificationKey;
}

async function createProposalZkAppUriArtifacts(contents: string): Promise<{
  proposalZkAppUri: string;
  zkAppUriHash: string;
}> {
  const markdownBytes = new TextEncoder().encode(contents);
  const proposalZkAppUri = await hashMarkdownContentToZkappUri(markdownBytes);
  assertZkappUriWithinByteLimit(proposalZkAppUri);
  const { ZkappUri } = await import("o1js");
  return {
    proposalZkAppUri,
    zkAppUriHash: ZkappUri.from(proposalZkAppUri).hash.toString(),
  };
}

export async function buildCreateProposalTransactionInCurrentThread(
  input: PrepareCreateProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<PreparedCreateProposalTransaction> {
  const constructed = await constructCreateProposalTransactionInCurrentThread(
    input,
    options,
  );
  constructed.transaction.sign([constructed.proposalPrivateKey]);
  return {
    ...constructed.preparedTransaction,
    transactionJson: normalizeSerializedTransactionJson(
      constructed.transaction.toJSON(),
    ),
  };
}

export async function buildAndProveCreateProposalTransactionInCurrentThread(
  input: PrepareCreateProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<{
  preparedTransaction: PreparedCreateProposalTransaction;
  provedTransactionJson: string;
}> {
  const startedAt = Date.now();
  console.info("[proposal-prover][create] buildAndProve start", {
    senderAddress: input.senderAddress,
    lifecycleId: input.lifecycleId,
    recipient: input.recipient,
    amount: input.amount,
    fee: input.fee,
    nonce: input.nonce,
    memoLength: input.memo.length,
    contentsLength: input.contents.length,
    hasCompileArtifacts: Boolean(options?.compileArtifacts),
  });
  const constructed = await constructCreateProposalTransactionInCurrentThread(
    input,
    options,
  );
  const constructedAt = Date.now();
  console.info("[proposal-prover][create] transaction constructed", {
    proposalPublicKey: constructed.preparedTransaction.proposalPublicKey,
    elapsedMs: constructedAt - startedAt,
  });
  console.info("[proposal-prover][create] prove begin", {
    proposalPublicKey: constructed.preparedTransaction.proposalPublicKey,
  });
  await constructed.transaction.prove();
  const provedAt = Date.now();
  console.info("[proposal-prover][create] prove complete", {
    proposalPublicKey: constructed.preparedTransaction.proposalPublicKey,
    proveElapsedMs: provedAt - constructedAt,
    totalElapsedMs: provedAt - startedAt,
  });
  const provedUnsignedTransactionJson = normalizeSerializedTransactionJson(
    constructed.transaction.toJSON(),
  );
  logTransactionAuthorizationSummary(
    "after prove before sign",
    provedUnsignedTransactionJson,
  );
  logExpectedSignerCoverage(
    "after prove before sign",
    provedUnsignedTransactionJson,
    [constructed.proposalPrivateKey.toPublicKey().toBase58()],
  );
  assertProofsPresent("after prove before sign", provedUnsignedTransactionJson);
  console.info("[proposal-prover][create] sign begin", {
    proposalPublicKey: constructed.preparedTransaction.proposalPublicKey,
  });
  constructed.transaction.sign([constructed.proposalPrivateKey]);
  const signedAt = Date.now();
  const provedTransactionJson = normalizeSerializedTransactionJson(
    constructed.transaction.toJSON(),
  );
  logTransactionAuthorizationSummary(
    "after combined sign",
    provedTransactionJson,
  );
  logExpectedSignerCoverage("after combined sign", provedTransactionJson, [
    constructed.proposalPrivateKey.toPublicKey().toBase58(),
  ]);
  console.info("[proposal-prover][create] buildAndProve complete", {
    proposalPublicKey: constructed.preparedTransaction.proposalPublicKey,
    signElapsedMs: signedAt - provedAt,
    totalElapsedMs: signedAt - startedAt,
    transactionJsonLength: provedTransactionJson.length,
  });
  return {
    preparedTransaction: {
      ...constructed.preparedTransaction,
      transactionJson: provedTransactionJson,
    },
    provedTransactionJson,
  };
}

async function constructCreateProposalTransactionInCurrentThread(
  input: PrepareCreateProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<ConstructedCreateProposalTransaction> {
  const startedAt = Date.now();
  if (options?.compileArtifacts) {
    console.info("[proposal-prover][create] applying cached compile artifacts");
    await applySerializedProposalCompileArtifactsInCurrentThread(
      options.compileArtifacts,
    );
  } else {
    console.info(
      "[proposal-prover][create] compile artifacts missing, compiling in current thread",
    );
    await compileProposalContractsInCurrentThread({
      proofsEnabled: options?.proofsEnabled,
    });
  }
  const modulesReadyAt = Date.now();
  console.info("[proposal-prover][create] prover modules ready", {
    elapsedMs: modulesReadyAt - startedAt,
  });

  const { o1js, TreasuryOwnerSmartContract } = await getProposalModules();
  const {
    AccountUpdate,
    Mina,
    PrivateKey,
    PublicKey,
    UInt32,
    UInt64,
    ZkappUri,
    fetchAccount,
  } = o1js;

  const senderPublicKey = PublicKey.fromBase58(input.senderAddress);
  const senderPublicKeyBase58 = senderPublicKey.toBase58();
  const recipientPublicKey = PublicKey.fromBase58(input.recipient);
  const treasuryOwnerPublicKey = PublicKey.fromBase58(
    input.treasuryOwnerContractAddress,
  );
  const proposalPrivateKey = PrivateKey.random();
  const proposalPublicKey = proposalPrivateKey.toPublicKey();
  const proposalAmount = UInt64.from(
    parseProposalAmountMinaToNanomina(input.amount),
  );
  const bondAmount = proposalAmount.div(10);
  const feeNanomina = Number(parseDecimalMinaToNanomina(input.fee));
  const lifecycleId = UInt32.from(input.lifecycleId);
  console.info("[proposal-prover][create] deriving proposal zkApp URI");
  const proposalArtifacts = await createProposalZkAppUriArtifacts(
    input.contents,
  );
  const artifactsReadyAt = Date.now();
  console.info("[proposal-prover][create] proposal artifacts ready", {
    proposalPublicKey: proposalPublicKey.toBase58(),
    zkAppUriHash: proposalArtifacts.zkAppUriHash,
    elapsedMs: artifactsReadyAt - startedAt,
  });

  Mina.setActiveInstance(
    Mina.Network(resolveProverEndpointUrl(input.minaNodeUrl)),
  );

  console.info("[proposal-prover][create] fetch sender account start", {
    senderAddress: senderPublicKeyBase58,
  });
  const { error: senderFetchError } = await fetchAccount({
    publicKey: senderPublicKey,
  });
  if (senderFetchError) {
    throw new Error(
      `Fee payer account ${senderPublicKeyBase58} was not found on the Mina node. Connect a funded wallet on this network.`,
    );
  }
  console.info("[proposal-prover][create] fetch sender account complete", {
    elapsedMs: Date.now() - artifactsReadyAt,
  });

  const treasuryFetchStartedAt = Date.now();
  console.info("[proposal-prover][create] fetch treasury owner account start", {
    treasuryOwnerContractAddress: input.treasuryOwnerContractAddress,
  });
  const { error: treasuryOwnerFetchError } = await fetchAccount({
    publicKey: treasuryOwnerPublicKey,
  });
  if (treasuryOwnerFetchError) {
    throw new Error(
      `Treasury owner account ${input.treasuryOwnerContractAddress} was not found on the Mina node.`,
    );
  }
  console.info(
    "[proposal-prover][create] fetch treasury owner account complete",
    {
      elapsedMs: Date.now() - treasuryFetchStartedAt,
    },
  );

  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const pauseControllerFetchStartedAt = Date.now();
  console.info(
    "[proposal-prover][create] fetch pause controller public key start",
  );
  const pauseControllerPublicKey =
    await treasuryOwner.pauseControllerPublicKey.fetch();
  if (!pauseControllerPublicKey) {
    throw new Error("Treasury owner pause controller public key is not set.");
  }
  console.info(
    "[proposal-prover][create] fetch pause controller public key complete",
    {
      pauseControllerPublicKey: pauseControllerPublicKey.toBase58(),
      elapsedMs: Date.now() - pauseControllerFetchStartedAt,
    },
  );

  const transactionBuildStartedAt = Date.now();
  console.info("[proposal-prover][create] Mina.transaction start", {
    proposalPublicKey: proposalPublicKey.toBase58(),
    bondAmount: bondAmount.toString(),
    feeNanomina,
  });

  const transaction = await Mina.transaction(
    {
      sender: senderPublicKey,
      fee: feeNanomina,
      // nonce: input.nonce,
      // memo: input.memo,
    },
    async () => {
      AccountUpdate.fundNewAccount(senderPublicKey, 1);
      const bondPayerAccountUpdate = AccountUpdate.create(senderPublicKey);
      bondPayerAccountUpdate.requireSignature();
      bondPayerAccountUpdate.balance.subInPlace(bondAmount);
      await treasuryOwner.createProposal(
        proposalPublicKey,
        {
          amount: proposalAmount,
          recipient: recipientPublicKey,
          zkAppUri: ZkappUri.from(proposalArtifacts.proposalZkAppUri),
        },
        lifecycleId,
      );
    },
  );
  const transactionBuiltAt = Date.now();
  console.info("[proposal-prover][create] Mina.transaction complete", {
    proposalPublicKey: proposalPublicKey.toBase58(),
    buildElapsedMs: transactionBuiltAt - transactionBuildStartedAt,
    totalElapsedMs: transactionBuiltAt - startedAt,
  });
  return {
    transaction,
    proposalPrivateKey,
    preparedTransaction: {
      proposalPublicKey: proposalPublicKey.toBase58(),
      proposalZkAppUri: proposalArtifacts.proposalZkAppUri,
      zkAppUriHash: proposalArtifacts.zkAppUriHash,
    },
  };
}

export async function buildVoteProposalTransactionInCurrentThread(
  input: PrepareVoteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<PreparedVoteProposalTransaction> {
  const constructed = await constructVoteProposalTransactionInCurrentThread(
    input,
    options,
  );
  return {
    ...constructed.preparedTransaction,
    transactionJson: normalizeSerializedTransactionJson(
      constructed.transaction.toJSON(),
    ),
  };
}

export async function buildAndProveVoteProposalTransactionInCurrentThread(
  input: PrepareVoteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<{
  preparedTransaction: PreparedVoteProposalTransaction;
  provedTransactionJson: string;
}> {
  const constructed = await constructVoteProposalTransactionInCurrentThread(
    input,
    options,
  );
  await constructed.transaction.prove();
  const provedUnsignedTransactionJson = normalizeSerializedTransactionJson(
    constructed.transaction.toJSON(),
  );
  logTransactionAuthorizationSummary(
    "vote after prove before sign",
    provedUnsignedTransactionJson,
  );
  logExpectedSignerCoverage(
    "vote after prove before sign",
    provedUnsignedTransactionJson,
    [],
  );
  assertProofsPresent(
    "vote after prove before sign",
    provedUnsignedTransactionJson,
  );
  return {
    preparedTransaction: {
      ...constructed.preparedTransaction,
      transactionJson: provedUnsignedTransactionJson,
    },
    provedTransactionJson: provedUnsignedTransactionJson,
  };
}

async function constructVoteProposalTransactionInCurrentThread(
  input: PrepareVoteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<ConstructedVoteProposalTransaction> {
  if (options?.compileArtifacts) {
    await applySerializedProposalCompileArtifactsInCurrentThread(
      options.compileArtifacts,
    );
  } else {
    await compileProposalContractsInCurrentThread({
      proofsEnabled: options?.proofsEnabled,
    });
  }

  const { o1js, TreasuryOwnerSmartContract, Vote } = await getProposalModules();
  const { Mina, PublicKey, fetchAccount } = o1js;
  const senderPublicKey = PublicKey.fromBase58(input.senderAddress);
  const treasuryOwnerPublicKey = PublicKey.fromBase58(
    input.treasuryOwnerContractAddress,
  );
  const proposalPublicKey = PublicKey.fromBase58(input.proposalPublicKey);
  const feeNanomina = Number(parseDecimalMinaToNanomina(input.fee));

  Mina.setActiveInstance(
    Mina.Network(resolveProverEndpointUrl(input.minaNodeUrl)),
  );

  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const proposalTokenId = treasuryOwner.deriveTokenId();

  const { error: senderFetchError } = await fetchAccount({
    publicKey: senderPublicKey,
  });
  if (senderFetchError) {
    throw new Error(
      `Fee payer account ${input.senderAddress} was not found on the Mina node. Connect a funded wallet/account on this network before voting.`,
    );
  }

  const { error: treasuryOwnerFetchError } = await fetchAccount({
    publicKey: treasuryOwnerPublicKey,
  });
  if (treasuryOwnerFetchError) {
    throw new Error(
      `Treasury owner account ${input.treasuryOwnerContractAddress} was not found on the Mina node.`,
    );
  }

  const { error: proposalFetchError } = await fetchAccount({
    publicKey: proposalPublicKey,
    tokenId: proposalTokenId,
  });
  if (proposalFetchError) {
    throw new Error(
      `Proposal account ${input.proposalPublicKey} was not found on the Mina node for treasury token ${proposalTokenId.toString()}.`,
    );
  }

  const pauseControllerPublicKey =
    await treasuryOwner.pauseControllerPublicKey.fetch();
  if (!pauseControllerPublicKey) {
    throw new Error("Treasury owner pause controller public key is not set.");
  }

  const transaction = await Mina.transaction(
    {
      sender: senderPublicKey,
      fee: feeNanomina,
      nonce: input.nonce,
      memo: input.memo,
    },
    async () => {
      await treasuryOwner.vote(
        proposalPublicKey,
        senderPublicKey,
        resolveProposalVoteValue(Vote, input.vote),
      );
    },
  );

  return {
    transaction,
    preparedTransaction: {
      proposalPublicKey: input.proposalPublicKey,
      vote: input.vote,
    },
  };
}

export async function buildExecuteProposalTransactionInCurrentThread(
  input: PrepareExecuteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<PreparedExecuteProposalTransaction> {
  const constructed = await constructExecuteProposalTransactionInCurrentThread(
    input,
    options,
  );
  return {
    ...constructed.preparedTransaction,
    transactionJson: normalizeSerializedTransactionJson(
      constructed.transaction.toJSON(),
    ),
  };
}

export async function buildAndProveExecuteProposalTransactionInCurrentThread(
  input: PrepareExecuteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<{
  preparedTransaction: PreparedExecuteProposalTransaction;
  provedTransactionJson: string;
}> {
  const constructed = await constructExecuteProposalTransactionInCurrentThread(
    input,
    options,
  );
  await constructed.transaction.prove();
  const provedUnsignedTransactionJson = normalizeSerializedTransactionJson(
    constructed.transaction.toJSON(),
  );
  logTransactionAuthorizationSummary(
    "execute after prove before sign",
    provedUnsignedTransactionJson,
  );
  logExpectedSignerCoverage(
    "execute after prove before sign",
    provedUnsignedTransactionJson,
    [],
  );
  assertProofsPresent(
    "execute after prove before sign",
    provedUnsignedTransactionJson,
  );
  return {
    preparedTransaction: {
      ...constructed.preparedTransaction,
      transactionJson: provedUnsignedTransactionJson,
    },
    provedTransactionJson: provedUnsignedTransactionJson,
  };
}

async function constructExecuteProposalTransactionInCurrentThread(
  input: PrepareExecuteProposalTransactionInput,
  options?: ProposalProverOptions & {
    compileArtifacts?: SerializedProposalCompileArtifacts;
  },
): Promise<ConstructedExecuteProposalTransaction> {
  if (options?.compileArtifacts) {
    await applySerializedProposalCompileArtifactsInCurrentThread(
      options.compileArtifacts,
    );
  } else {
    await compileProposalContractsInCurrentThread({
      proofsEnabled: options?.proofsEnabled,
    });
  }

  const { o1js, TreasuryOwnerSmartContract } = await getProposalModules();
  const { AccountUpdate, Mina, PublicKey, UInt64, fetchAccount } = o1js;

  const senderPublicKey = PublicKey.fromBase58(input.senderAddress);
  const treasuryOwnerPublicKey = PublicKey.fromBase58(
    input.treasuryOwnerContractAddress,
  );
  const proposalPublicKey = PublicKey.fromBase58(input.proposalPublicKey);
  const recipientPublicKey = PublicKey.fromBase58(input.recipient);
  const amountToPayOut = UInt64.from(
    parseProposalAmountMinaToNanomina(input.amount),
  );
  const feeNanomina = Number(parseDecimalMinaToNanomina(input.fee));

  Mina.setActiveInstance(
    Mina.Network(resolveProverEndpointUrl(input.minaNodeUrl)),
  );

  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const proposalTokenId = treasuryOwner.deriveTokenId();

  const { error: senderFetchError } = await fetchAccount({
    publicKey: senderPublicKey,
  });
  if (senderFetchError) {
    throw new Error(
      `Fee payer account ${input.senderAddress} was not found on the Mina node. Connect a funded wallet/account on this network before executing a proposal.`,
    );
  }

  const { error: treasuryOwnerFetchError } = await fetchAccount({
    publicKey: treasuryOwnerPublicKey,
  });
  if (treasuryOwnerFetchError) {
    throw new Error(
      `Treasury owner account ${input.treasuryOwnerContractAddress} was not found on the Mina node.`,
    );
  }

  const { error: proposalFetchError } = await fetchAccount({
    publicKey: proposalPublicKey,
    tokenId: proposalTokenId,
  });
  if (proposalFetchError) {
    throw new Error(
      `Proposal account ${input.proposalPublicKey} was not found on the Mina node for treasury token ${proposalTokenId.toString()}.`,
    );
  }

  const pauseControllerPublicKey =
    await treasuryOwner.pauseControllerPublicKey.fetch();
  if (!pauseControllerPublicKey) {
    throw new Error("Treasury owner pause controller public key is not set.");
  }

  const { error: recipientFetchError } = await fetchAccount({
    publicKey: recipientPublicKey,
  });

  const transaction = await Mina.transaction(
    {
      sender: senderPublicKey,
      fee: feeNanomina,
      nonce: input.nonce,
      memo: input.memo,
    },
    async () => {
      if (recipientFetchError) {
        AccountUpdate.fundNewAccount(senderPublicKey, 1);
      }
      await treasuryOwner.executeProposal(
        proposalPublicKey,
        recipientPublicKey,
        amountToPayOut,
      );
    },
  );

  return {
    transaction,
    preparedTransaction: {
      proposalPublicKey: input.proposalPublicKey,
      recipient: input.recipient,
      amount: input.amount,
    },
  };
}

export async function proveTransactionJsonInCurrentThread(
  transactionJson: string,
  options?: ProposalProverOptions,
): Promise<string> {
  void options;
  const proofsEnabled = true;
  console.info("[proposal-prover][config] runtime prove proofs flag", {
    rawValue: getRuntimeConfig().proofsEnabled,
    resolved: proofsEnabled,
  });
  await compileProposalContractsInCurrentThread({ proofsEnabled });
  try {
    const { o1js } = await getProposalModules();
    const transaction = await o1js.Mina.Transaction.fromJSON(transactionJson);
    logTransactionAuthorizationSummary("before prove", transactionJson);
    await transaction.prove();
    const provedTransactionJson = normalizeSerializedTransactionJson(
      transaction.toJSON(),
    );
    logTransactionAuthorizationSummary("after prove", provedTransactionJson);
    assertProofsPresent("after prove", provedTransactionJson);
    return provedTransactionJson;
  } catch (error) {
    console.error("[proposal-prover][runtime] prove failed", {
      error,
      transactionJsonLength: transactionJson.length,
    });
    const message =
      error instanceof Error
        ? error.message.trim() ||
          error.stack?.split("\n")[0] ||
          "Unknown prover error."
        : typeof error === "string"
          ? error.trim() || "Unknown prover error."
          : "Unknown prover error.";
    throw new Error(`Failed to prove transaction: ${message}`);
  }
}

function parseDecimalMinaToNanomina(value: string): bigint {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Transaction fee must be a positive MINA value.");
  }

  const [wholePart = "0", fractionalPart = ""] = normalized.split(".");
  const paddedFractional = `${fractionalPart}000000000`.slice(0, 9);
  return BigInt(wholePart) * MINA_DECIMALS + BigInt(paddedFractional);
}

function parseProposalAmountMinaToNanomina(value: string): bigint {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Proposal amount must be a positive MINA value.");
  }

  const [wholePart = "0", fractionalPart = ""] = normalized.split(".");
  const paddedFractional = `${fractionalPart}000000000`.slice(0, 9);
  return BigInt(wholePart) * MINA_DECIMALS + BigInt(paddedFractional);
}

function resolveProposalVoteValue(
  Vote: {
    YAY: unknown;
    NAY: unknown;
    ABSTRAIN: unknown;
  },
  vote: ProposalVoteChoice,
): unknown {
  if (vote === "yay") {
    return Vote.YAY;
  }
  if (vote === "nay") {
    return Vote.NAY;
  }
  return Vote.ABSTRAIN;
}

function normalizeSerializedTransactionJson(value: unknown): string {
  const normalized = typeof value === "string" ? value : JSON.stringify(value);
  console.info("[proposal-prover][runtime] normalized transaction json", {
    originalType: typeof value,
    normalizedType: typeof normalized,
    normalizedLength: normalized.length,
    originalKeys:
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value as Record<string, unknown>).slice(0, 10)
        : undefined,
  });
  return normalized;
}
