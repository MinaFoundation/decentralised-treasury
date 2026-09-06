import type { OperationPackage } from "./operations";
import type { BackofficeRuntimeConfig } from "./runtime-config";

let pauseCompilePromise: Promise<void> | null = null;
let fullCompilePromise: Promise<void> | null = null;

function parseJsonValue(value: string | undefined, name: string): unknown {
  if (!value?.trim()) throw new Error(`${name} is required for proposal toggling.`);
  const candidates = [value, value.replace(/\\"/g, '"')];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch {
      // Try the next serialized form.
    }
  }
  throw new Error(`${name} is not valid JSON.`);
}

function endpoint(value: string): string {
  const origin = typeof globalThis.location?.origin === "string"
    ? globalThis.location.origin
    : undefined;
  if (!origin && !/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    throw new Error(`Relative Mina node URL requires a browser origin: ${value}`);
  }
  return new URL(value, origin).toString();
}

function minaToNanomina(value: string): number {
  if (!/^\d+(?:\.\d{0,9})?$/.test(value.trim())) {
    throw new Error("The fee must be a positive MINA value with at most nine decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const nanomina = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (nanomina <= 0n || nanomina > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The fee is outside the supported range.");
  }
  return Number(nanomina);
}

async function modules() {
  const [o1js, owner, controller, proposal, multisig] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-owner.js"),
    import(
      "@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js"
    ),
    import("@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js"),
    import(
      "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js"
    ),
  ]);
  return { o1js, owner, controller, proposal, multisig };
}

export async function compileBreakGlassContracts(
  config: BackofficeRuntimeConfig,
  includeProposalContracts: boolean,
): Promise<void> {
  const loaded = await modules();
  const { PublicKey, Field, UInt32, VerificationKey } = loaded.o1js;
  loaded.controller.TreasuryPauseControllerSmartContract.multisigParticipants =
    Array.from({ length: 5 }, () => PublicKey.empty());
  pauseCompilePromise ??=
    loaded.controller.TreasuryPauseControllerSmartContract.compile().then(() => undefined);
  await pauseCompilePromise;
  if (!includeProposalContracts) return;
  fullCompilePromise ??= (async () => {
    const configuredProposalVerificationKey = VerificationKey.fromJSON(
      parseJsonValue(
        config.treasuryProposalVerificationKeyJson,
        "NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON",
      ) as { data: string; hash: string },
    );
    loaded.proposal.TreasuryProposalSmartContract.voteReducerVerificationKey =
      VerificationKey.fromJSON(
        parseJsonValue(
          config.voteReducerVerificationKeyJson,
          "NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON",
        ) as { data: string; hash: string },
      );
    loaded.proposal.TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
      VerificationKey.fromJSON(
        parseJsonValue(
          config.stakingLedgerToVotingLedgerVerificationKeyJson,
          "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON",
        ) as { data: string; hash: string },
      );
    if (!config.emptyVotingLedgerRoot || !config.emptyNullifierRoot) {
      throw new Error("Empty voting and nullifier roots are required for proposal toggling.");
    }
    loaded.proposal.TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(
      config.emptyVotingLedgerRoot,
    );
    loaded.proposal.TreasuryProposalSmartContract.emptyNullifierRoot = Field(
      config.emptyNullifierRoot,
    );
    const { verificationKey } =
      await loaded.proposal.TreasuryProposalSmartContract.compile();
    if (
      verificationKey.hash.toString() !==
      configuredProposalVerificationKey.hash.toString()
    ) {
      throw new Error(
        "The configured treasury proposal verification key does not match this build.",
      );
    }
    loaded.owner.TreasuryOwnerSmartContract.proposalContractVerificationKey =
      verificationKey;
    if (!config.lifecyclePeriodDuration) {
      throw new Error("NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION is required for proposal toggling.");
    }
    loaded.owner.TreasuryOwnerSmartContract.lifecyclePeriodDuration = UInt32.from(
      config.lifecyclePeriodDuration,
    );
    await loaded.owner.TreasuryOwnerSmartContract.compile();
  })();
  await fullCompilePromise;
}

function createSignatureSet(loaded: Awaited<ReturnType<typeof modules>>, operation: OperationPackage) {
  const signatures = operation.signatures.map((signature) =>
    signature
      ? loaded.multisig.MultisigSignature.fromBase58(signature)
      : loaded.multisig.MultisigSignature.empty(),
  );
  return new loaded.multisig.MultisigSignatures({ signatures });
}

export async function buildAndProveBreakGlassTransaction(input: {
  config: BackofficeRuntimeConfig;
  operation: OperationPackage;
  senderAddress: string;
  fee: string;
  memo: string;
}): Promise<string> {
  const includeProposalContracts = input.operation.kind === "toggleProposal";
  await compileBreakGlassContracts(input.config, includeProposalContracts);
  const loaded = await modules();
  const { Bool, Field, Mina, PublicKey, UInt32, fetchAccount } = loaded.o1js;
  const operation = input.operation;
  const sender = PublicKey.fromBase58(input.senderAddress);
  const controllerKey = PublicKey.fromBase58(operation.pauseControllerAddress);
  Mina.setActiveInstance(
    Mina.Network({
      mina: endpoint(input.config.minaNodeUrl),
      networkId: input.config.networkId.toLowerCase() as
        | "mainnet"
        | "testnet"
        | "devnet",
    }),
  );
  const [senderFetch, controllerFetch] = await Promise.all([
    fetchAccount({ publicKey: sender }),
    fetchAccount({ publicKey: controllerKey }),
  ]);
  if (senderFetch.error) throw new Error(`Fee payer account was not found: ${String(senderFetch.error)}`);
  if (controllerFetch.error) throw new Error(`Pause controller account was not found: ${String(controllerFetch.error)}`);
  const controllerAccount = Mina.getAccount(controllerKey);
  if (controllerAccount.nonce.toString() !== operation.controllerNonce) {
    throw new Error("The pause controller nonce changed. Create a new operation.");
  }
  loaded.controller.TreasuryPauseControllerSmartContract.multisigParticipants =
    operation.participants.map((key) => PublicKey.fromBase58(key));
  const controller = new loaded.controller.TreasuryPauseControllerSmartContract(
    controllerKey,
  );
  const [onChainCommitment, pausedState] = await Promise.all([
    controller.multisigCommitment.fetch(),
    controller.paused.fetch(),
  ]);
  if (!onChainCommitment || onChainCommitment.toString() !== operation.multisigCommitment) {
    throw new Error("The on-chain multisig commitment changed. Create a new operation.");
  }
  if (operation.kind === "pauseTreasury" && pausedState?.toBoolean()) {
    throw new Error("The treasury is already paused.");
  }
  if (operation.kind === "unpauseTreasury" && pausedState && !pausedState.toBoolean()) {
    throw new Error("The treasury is already active.");
  }
  const signatureSet = createSignatureSet(loaded, operation);
  const controllerNonce = UInt32.from(operation.controllerNonce);
  let toggleOwner: any;
  let toggleProposalKey: any;
  let expectedProposalPaused: boolean | undefined;
  if (operation.kind === "toggleProposal") {
    if (!operation.proposalAddress || operation.expectedProposalPaused === undefined) {
      throw new Error("The proposal-toggle operation is incomplete.");
    }
    const ownerKey = PublicKey.fromBase58(operation.treasuryOwnerAddress);
    const ownerFetch = await fetchAccount({ publicKey: ownerKey });
    if (ownerFetch.error) {
      throw new Error(`Treasury owner account was not found: ${String(ownerFetch.error)}`);
    }
    toggleOwner = new loaded.owner.TreasuryOwnerSmartContract(ownerKey);
    const configuredController = await toggleOwner.pauseControllerPublicKey.fetch();
    if (!configuredController?.equals(controllerKey).toBoolean()) {
      throw new Error("The treasury owner references another pause controller.");
    }
    toggleProposalKey = PublicKey.fromBase58(operation.proposalAddress);
    const proposalTokenId = toggleOwner.deriveTokenId();
    const proposalFetch = await fetchAccount({
      publicKey: toggleProposalKey,
      tokenId: proposalTokenId,
    });
    if (proposalFetch.error) {
      throw new Error(`Proposal account was not found: ${String(proposalFetch.error)}`);
    }
    const proposalContract = new loaded.proposal.TreasuryProposalSmartContract(
      toggleProposalKey,
      proposalTokenId,
    );
    const proposalStatus = await proposalContract.status.fetch();
    const expectedStatusBefore = ({
      "0": "UNKNOWN",
      "1": "APPROVED",
      "2": "REJECTED",
      "3": "PAUSED",
    } as Record<string, string>)[proposalStatus?.toString() ?? ""];
    if (!expectedStatusBefore || expectedStatusBefore !== operation.proposalStatusBefore) {
      throw new Error("The proposal status changed. Create a new operation.");
    }
    expectedProposalPaused = operation.expectedProposalPaused;
  }
  const transaction = await Mina.transaction(
    {
      sender,
      fee: minaToNanomina(input.fee),
      memo: input.memo,
    },
    async () => {
      if (operation.kind === "pauseTreasury") {
        await controller.pauseTreasury(signatureSet, controllerNonce);
      } else if (operation.kind === "unpauseTreasury") {
        await controller.unpauseTreasury(signatureSet, controllerNonce);
      } else if (operation.kind === "rotateMultisig") {
        if (!operation.nextMultisigCommitment) {
          throw new Error("The rotation operation does not contain a new commitment.");
        }
        await controller.rotateMultisigKeys(
          Field(operation.nextMultisigCommitment),
          controllerNonce,
          signatureSet,
        );
      } else {
        await toggleOwner.togglePauseProposal(
          toggleProposalKey,
          signatureSet,
          controllerNonce,
          Bool(expectedProposalPaused!),
        );
      }
    },
  );
  await transaction.prove();
  return transaction.toJSON();
}
