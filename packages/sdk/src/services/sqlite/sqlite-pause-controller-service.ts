import {
  AccountUpdate,
  Cache,
  fetchAccount,
  Mina,
  type PrivateKey,
  type PublicKey,
  UInt32,
} from "o1js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignatures,
} from "../../provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { TreasuryPauseControllerSmartContract } from "../../provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
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
  public async compile(
    options: CompilePauseControllerOptions = {},
  ): Promise<CompilePauseControllerResult> {
    const cachePath = options.cachePath ?? `${process.cwd()}/cache`;
    const cache = Cache.FileSystem(cachePath);
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

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const resolvedNonce = await this.resolvePauseControllerNonce(
      pauseControllerPublicKey,
      nonce,
    );
    const senderPublicKey = senderPrivateKey.toPublicKey();

    const togglePauseProposalTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await pauseController.togglePauseProposal(
          proposalPublicKey,
          signatures,
          resolvedNonce,
        );
      },
    );
    togglePauseProposalTx.sign([senderPrivateKey]);
    await togglePauseProposalTx.prove();
    const togglePendingTx = await this.sendTransaction(togglePauseProposalTx, {
      wait,
    });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
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
        cause instanceof Error ? cause.message : `Unknown cause: ${String(cause)}`;
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

