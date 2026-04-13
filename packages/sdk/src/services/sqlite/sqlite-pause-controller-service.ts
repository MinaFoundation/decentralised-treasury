import {
  AccountUpdate,
  Bool,
  Cache,
  fetchAccount,
  Mina,
  type PrivateKey,
  PublicKey,
  UInt32,
} from "o1js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignatures,
} from "../../provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { TreasuryPauseControllerSmartContract } from "../../provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { TreasuryOwnerSmartContract } from "../../provable/contracts/treasury-owner.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  type CompilePauseControllerOptions,
  type CompilePauseControllerResult,
  type DeployPauseControllerOptions,
  type DeployPauseControllerResult,
  type GetPauseControllerStateOptions,
  type GetPauseControllerStateResult,
  type PauseControllerService,
  type PauseTreasuryOptions,
  type PauseTreasuryResult,
  type RotateMultisigKeysOptions,
  type RotateMultisigKeysResult,
  type TogglePauseProposalOptions,
  type TogglePauseProposalResult,
  type UnpauseTreasuryOptions,
  type UnpauseTreasuryResult,
} from "../pause-controller-service.js";
import { logger } from "../../index.js";

export class SqlitePauseControllerService implements PauseControllerService {
  private seedParticipantsForCompile() {
    if (
      TreasuryPauseControllerSmartContract.multisigParticipants.length ===
      MULTISIG_PARTICIPANTS_COUNT
    ) {
      return;
    }
    TreasuryPauseControllerSmartContract.multisigParticipants = Array.from(
      { length: MULTISIG_PARTICIPANTS_COUNT },
      () => PublicKey.empty(),
    );
  }

  public async compile(
    options: CompilePauseControllerOptions = {},
  ): Promise<CompilePauseControllerResult> {
    const cachePath = options.cachePath ?? `${process.cwd()}/cache`;
    const cache = Cache.FileSystem(cachePath);
    this.seedParticipantsForCompile();
    const { verificationKey: pauseControllerVerificationKey } =
      await TreasuryPauseControllerSmartContract.compile({
        cache,
      });
    return {
      pauseControllerVerificationKey,
    };
  }

  public async deploy(
    options: DeployPauseControllerOptions,
  ): Promise<DeployPauseControllerResult> {
    const {
      senderPrivateKey,
      pauseControllerPrivateKey,
      multisigParticipantsPublicKeys,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    this.assertParticipantsCount(
      multisigParticipantsPublicKeys,
      "multisigParticipantsPublicKeys",
    );

    TreasuryPauseControllerSmartContract.multisigParticipants =
      multisigParticipantsPublicKeys;

    const senderPublicKey = senderPrivateKey.toPublicKey();
    const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();
    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );

    const deployTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        AccountUpdate.fundNewAccount(senderPublicKey, 1);
        await pauseController.deploy();
      },
    );
    deployTx.sign([senderPrivateKey, pauseControllerPrivateKey]);
    await deployTx.prove();
    const deployPendingTx = await this.sendTransaction(deployTx, { wait });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      pauseControllerTxHash: deployPendingTx.hash,
    };
  }

  public async pauseTreasury(
    options: PauseTreasuryOptions,
  ): Promise<PauseTreasuryResult> {
    const {
      senderPrivateKey,
      pauseControllerPublicKey,
      multisigParticipantsPublicKeys,
      signatures,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    this.assertParticipantsCount(
      multisigParticipantsPublicKeys,
      "multisigParticipantsPublicKeys",
    );
    TreasuryPauseControllerSmartContract.multisigParticipants =
      multisigParticipantsPublicKeys;

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const resolvedNonce = await this.resolvePauseControllerNonce(
      pauseControllerPublicKey,
      nonce,
    );
    const senderPublicKey = senderPrivateKey.toPublicKey();

    const pauseTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await pauseController.pauseTreasury(signatures, resolvedNonce);
      },
    );
    pauseTx.sign([senderPrivateKey]);
    await pauseTx.prove();
    const pausePendingTx = await this.sendTransaction(pauseTx, { wait });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      paused: true,
      nonce: resolvedNonce.toString(),
      pauseTxHash: pausePendingTx.hash,
    };
  }

  public async unpauseTreasury(
    options: UnpauseTreasuryOptions,
  ): Promise<UnpauseTreasuryResult> {
    const {
      senderPrivateKey,
      pauseControllerPublicKey,
      multisigParticipantsPublicKeys,
      signatures,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    this.assertParticipantsCount(
      multisigParticipantsPublicKeys,
      "multisigParticipantsPublicKeys",
    );
    TreasuryPauseControllerSmartContract.multisigParticipants =
      multisigParticipantsPublicKeys;

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const resolvedNonce = await this.resolvePauseControllerNonce(
      pauseControllerPublicKey,
      nonce,
    );
    const senderPublicKey = senderPrivateKey.toPublicKey();

    const unpauseTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await pauseController.unpauseTreasury(signatures, resolvedNonce);
      },
    );
    unpauseTx.sign([senderPrivateKey]);
    await unpauseTx.prove();
    const unpausePendingTx = await this.sendTransaction(unpauseTx, { wait });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      paused: false,
      nonce: resolvedNonce.toString(),
      unpauseTxHash: unpausePendingTx.hash,
    };
  }

  public async togglePauseProposal(
    options: TogglePauseProposalOptions,
  ): Promise<TogglePauseProposalResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPublicKey,
      pauseControllerPublicKey,
      proposalPublicKey,
      multisigParticipantsPublicKeys,
      signatures,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    this.assertParticipantsCount(
      multisigParticipantsPublicKeys,
      "multisigParticipantsPublicKeys",
    );
    TreasuryPauseControllerSmartContract.multisigParticipants =
      multisigParticipantsPublicKeys;

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const { error: treasuryOwnerFetchError } = await fetchAccount({
      publicKey: treasuryOwnerPublicKey,
    });
    if (treasuryOwnerFetchError) {
      logger.info(
        `[pause-controller-service] continuing despite treasury owner prefetch error while toggling proposal pause: ${String(treasuryOwnerFetchError)}`,
      );
    }

    const configuredPauseControllerPublicKey =
      await treasuryOwner.pauseControllerPublicKey.fetch();
    if (!configuredPauseControllerPublicKey) {
      throw new Error(
        `Treasury owner pauseControllerPublicKey is not set for ${treasuryOwnerPublicKey.toBase58()}`,
      );
    }
    if (
      !configuredPauseControllerPublicKey
        .equals(pauseControllerPublicKey)
        .toBoolean()
    ) {
      throw new Error(
        `Pause controller public key mismatch: provided ${pauseControllerPublicKey.toBase58()} but treasury owner ${treasuryOwnerPublicKey.toBase58()} is configured with ${configuredPauseControllerPublicKey.toBase58()}`,
      );
    }

    const pauseController = new TreasuryPauseControllerSmartContract(
      configuredPauseControllerPublicKey,
    );
    const proposalTokenId = treasuryOwner.deriveTokenId();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      proposalTokenId,
    );
    const [
      { error: pauseControllerFetchError },
      { error: proposalFetchError },
    ] = await Promise.all([
      fetchAccount({
        publicKey: configuredPauseControllerPublicKey,
      }),
      fetchAccount({
        publicKey: proposalPublicKey,
        tokenId: proposalTokenId,
      }),
    ]);
    if (pauseControllerFetchError || proposalFetchError) {
      logger.info(
        `[pause-controller-service] continuing despite prefetch errors while toggling proposal pause (pauseController=${String(pauseControllerFetchError)}, proposal=${String(proposalFetchError)})`,
      );
    }
    const onChainMultisigCommitment =
      await pauseController.multisigCommitment.fetch();
    if (!onChainMultisigCommitment) {
      throw new Error(
        `Pause controller multisig commitment is not set for ${configuredPauseControllerPublicKey.toBase58()}`,
      );
    }
    const providedMultisigCommitment = MultisigSignatures.createCommitment(
      multisigParticipantsPublicKeys,
    );
    if (
      !providedMultisigCommitment.equals(onChainMultisigCommitment).toBoolean()
    ) {
      throw new Error(
        `Provided multisig participants commitment ${providedMultisigCommitment.toString()} does not match on-chain commitment ${onChainMultisigCommitment.toString()} for ${configuredPauseControllerPublicKey.toBase58()}`,
      );
    }

    const resolvedNonce = await this.resolvePauseControllerNonce(
      configuredPauseControllerPublicKey,
      nonce,
    );
    // const currentProposalStatus = await proposal.status.fetch();
    // if (!currentProposalStatus) {
    //   throw new Error(
    //     `Proposal status is not set for ${proposalPublicKey.toBase58()}`,
    //   );
    // }
    // const pausedAfterToggle = !currentProposalStatus
    //   .equals(ProposalStatus.PAUSED)
    //   .toBoolean();
    const senderPublicKey = senderPrivateKey.toPublicKey();

    const togglePauseProposalTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await treasuryOwner.togglePauseProposal(
          proposalPublicKey,
          signatures,
          resolvedNonce,
          Bool(true),
        );
      },
    );
    togglePauseProposalTx.sign([senderPrivateKey]);
    await togglePauseProposalTx.prove();
    const togglePendingTx = await this.sendTransaction(togglePauseProposalTx, {
      wait,
    });

    return {
      treasuryOwnerAddress: treasuryOwnerPublicKey.toBase58(),
      pauseControllerAddress: configuredPauseControllerPublicKey.toBase58(),
      proposalPublicKey: proposalPublicKey.toBase58(),
      nonce: resolvedNonce.toString(),
      togglePauseProposalTxHash: togglePendingTx.hash,
    };
  }

  public async rotateMultisigKeys(
    options: RotateMultisigKeysOptions,
  ): Promise<RotateMultisigKeysResult> {
    const {
      senderPrivateKey,
      pauseControllerPublicKey,
      currentMultisigParticipantsPublicKeys,
      signatures,
      newMultisigParticipantsPublicKeys,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;

    this.assertParticipantsCount(
      currentMultisigParticipantsPublicKeys,
      "currentMultisigParticipantsPublicKeys",
    );
    this.assertParticipantsCount(
      newMultisigParticipantsPublicKeys,
      "newMultisigParticipantsPublicKeys",
    );

    TreasuryPauseControllerSmartContract.multisigParticipants =
      currentMultisigParticipantsPublicKeys;

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const resolvedNonce = await this.resolvePauseControllerNonce(
      pauseControllerPublicKey,
      nonce,
    );

    const previousMultisigCommitment = MultisigSignatures.createCommitment(
      currentMultisigParticipantsPublicKeys,
    );
    const newMultisigCommitment = MultisigSignatures.createCommitment(
      newMultisigParticipantsPublicKeys,
    );
    const senderPublicKey = senderPrivateKey.toPublicKey();

    const rotateMultisigKeysTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await pauseController.rotateMultisigKeys(
          newMultisigCommitment,
          resolvedNonce,
          signatures,
        );
      },
    );
    rotateMultisigKeysTx.sign([senderPrivateKey]);
    await rotateMultisigKeysTx.prove();
    const rotatePendingTx = await this.sendTransaction(rotateMultisigKeysTx, {
      wait,
    });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      nonce: resolvedNonce.toString(),
      previousMultisigCommitment: previousMultisigCommitment.toString(),
      newMultisigCommitment: newMultisigCommitment.toString(),
      rotateMultisigKeysTxHash: rotatePendingTx.hash,
    };
  }

  public async getPauseControllerState(
    options: GetPauseControllerStateOptions,
  ): Promise<GetPauseControllerStateResult> {
    const { pauseControllerPublicKey } = options;
    const { error } = await fetchAccount({
      publicKey: pauseControllerPublicKey,
    });
    if (error) {
      throw new Error(
        `Failed to fetch pause controller account ${pauseControllerPublicKey.toBase58()}: ${String(error)}`,
      );
    }

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const [multisigCommitment, paused] = await Promise.all([
      pauseController.multisigCommitment.fetch(),
      pauseController.paused.fetch(),
    ]);

    if (!multisigCommitment || !paused) {
      throw new Error(
        `Pause controller state is incomplete for ${pauseControllerPublicKey.toBase58()}`,
      );
    }

    const nonce = Mina.getAccount(pauseControllerPublicKey).nonce;
    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      multisigCommitment: multisigCommitment.toString(),
      paused: paused.toBoolean(),
      nonce: nonce.toString(),
    };
  }

  private assertParticipantsCount(
    participants: PublicKey[],
    label: string,
  ): void {
    if (participants.length !== MULTISIG_PARTICIPANTS_COUNT) {
      throw new Error(
        `${label} must contain exactly ${MULTISIG_PARTICIPANTS_COUNT} entries, got ${participants.length}`,
      );
    }
  }

  private async resolvePauseControllerNonce(
    pauseControllerPublicKey: PublicKey,
    nonce: number | undefined,
  ): Promise<UInt32> {
    if (nonce !== undefined) {
      return UInt32.from(nonce);
    }

    const { error } = await fetchAccount({
      publicKey: pauseControllerPublicKey,
    });
    if (error) {
      logger.info(
        `[pause-controller-service] continuing despite prefetch error while resolving nonce: ${String(error)}`,
      );
    }

    try {
      return Mina.getAccount(pauseControllerPublicKey).nonce;
    } catch (cause) {
      const reason =
        cause instanceof Error
          ? cause.message
          : `Unknown cause: ${String(cause)}`;
      throw new Error(
        `Unable to resolve nonce for pause controller account ${pauseControllerPublicKey.toBase58()}: ${reason}`,
      );
    }
  }

  private async sendTransaction(
    transaction: {
      send: () => Promise<{ hash?: string; wait?: () => Promise<unknown> }>;
    },
    options: { wait: boolean },
  ): Promise<{ hash?: string; wait?: () => Promise<unknown> }> {
    const pendingTx = await transaction.send();
    if (options.wait && pendingTx.wait) {
      await pendingTx.wait();
    }
    return pendingTx;
  }
}
