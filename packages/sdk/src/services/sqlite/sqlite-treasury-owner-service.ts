import {
  AccountUpdate,
  Cache,
  fetchAccount,
  fetchLastBlock,
  Mina,
  type PrivateKey,
  type PublicKey,
  UInt32,
  UInt64,
  ZkappUri,
} from "o1js";
import {
  type CompileTreasuryOwnerOptions,
  type CompileTreasuryOwnerResult,
  type CreateTreasuryProposalOptions,
  type CreateTreasuryProposalResult,
  type DeployTreasuryOwnerOptions,
  type DeployTreasuryOwnerResult,
  type ExecuteTreasuryProposalOptions,
  type ExecuteTreasuryProposalResult,
  type GetCurrentLifecyclePeriodOptions,
  type GetCurrentLifecyclePeriodResult,
  type LifecyclePeriodName,
  type GetTreasuryOwnerStateOptions,
  type GetTreasuryOwnerStateResult,
  type GetTreasuryProposalStateOptions,
  type GetTreasuryProposalStateResult,
  type ProposalVote,
  type TallyVotesTreasuryProposalOptions,
  type TallyVotesTreasuryProposalResult,
  type TransferToTreasuryOptions,
  type TransferToTreasuryResult,
  type TreasuryOwnerService,
  type VoteTreasuryProposalOptions,
  type VoteTreasuryProposalResult,
} from "../treasury-owner-service.js";
import {
  VoteReducer,
  voteReducerContext,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import {
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import { ReplayableNullifierLedger } from "../../ledgers/nullifier-ledger/replayable-nullifier-ledger.js";
import { ReplayableStakingLedger } from "../../ledgers/staking-ledger/replayable-staking-ledger.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  LifecyclePeriod,
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "../../provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { BOND_AMOUNT_DIVISOR } from "../../provable/contracts/treasury-constants.js";
import { KeyvSqlite } from "@keyv/sqlite";
import { createSqliteVotingLedgerStorage } from "../../storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createSqliteNullifierLedgerStorage } from "../../storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteStakingLedgerStorage } from "../../storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { getSqliteDbPath } from "../../storage/sqlite/sqlite-db-path.js";
import { PersistentVotingLedger } from "../../ledgers/voting-ledger/persistent-voting-ledger.js";
import { PersistentNullifierLedger } from "../../ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { PersistentStakingLedger } from "../../ledgers/staking-ledger/persistent-staking-ledger.js";
import { Account } from "../../provable/account.js";
import { PrefixedMerkleWitness36 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { Vote } from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { logger } from "../../index.js";

export class SqliteTreasuryOwnerService implements TreasuryOwnerService {
  public async compile(
    options: CompileTreasuryOwnerOptions = {},
  ): Promise<CompileTreasuryOwnerResult> {
    const startedAt = Date.now();
    const proofsEnabled =
      options.proofsEnabled ?? process.env.PROOFS_ENABLED === "true";
    const lifecyclePeriodDuration =
      options.lifecyclePeriodDuration ?? LIFECYCLE_PERIOD_DURATION;
    const cachePath = options.cachePath ?? `${process.cwd()}/cache`;
    const cache = Cache.FileSystem(cachePath);

    logger.info(
      `[treasury-owner-service:compile] starting (proofsEnabled=${String(proofsEnabled)}, lifecyclePeriodDuration=${lifecyclePeriodDuration.toString()}, cachePath=${cachePath})`,
    );

    logger.info(
      "[treasury-owner-service:compile] configuring replayable vote reducer and staking-ledger contexts",
    );
    voteReducerContext.set({
      votingLedger: new ReplayableVotingLedger({}, {}),
      nullifierLedger: new ReplayableNullifierLedger({}, {}),
    });

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: new ReplayableStakingLedger({}),
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    const voteReducerStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] compiling VoteReducer program",
    );
    const { verificationKey: voteReducerVerificationKey } =
      await VoteReducer.compile({
        proofsEnabled,
        cache,
      });
    logger.info(
      `[treasury-owner-service:compile] compiled VoteReducer program (elapsedMs=${Date.now() - voteReducerStartedAt})`,
    );

    const stakingLedgerStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] compiling StakingLedgerToVotingLedger program",
    );
    const { verificationKey: stakingLedgerToVotingLedgerVerificationKey } =
      await StakingLedgerToVotingLedger.compile({
        proofsEnabled,
        cache,
      });
    logger.info(
      `[treasury-owner-service:compile] compiled StakingLedgerToVotingLedger program (elapsedMs=${Date.now() - stakingLedgerStartedAt})`,
    );

    TreasuryProposalSmartContract.voteReducerVerificationKey =
      voteReducerVerificationKey;
    TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
      stakingLedgerToVotingLedgerVerificationKey;

    const emptyRootsStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] creating empty voting/nullifier ledger roots",
    );
    const { emptyVotingLedgerRoot, emptyNullifierRoot } =
      await this.createEmptyLedgerRoots();
    logger.info(
      `[treasury-owner-service:compile] created empty voting/nullifier ledger roots (elapsedMs=${Date.now() - emptyRootsStartedAt})`,
    );
    TreasuryProposalSmartContract.emptyVotingLedgerRoot = emptyVotingLedgerRoot;
    TreasuryProposalSmartContract.emptyNullifierRoot = emptyNullifierRoot;

    const treasuryProposalStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] compiling TreasuryProposalSmartContract",
    );
    const { verificationKey: treasuryProposalVerificationKey } =
      await TreasuryProposalSmartContract.compile({
        cache,
      });
    logger.info(
      `[treasury-owner-service:compile] compiled TreasuryProposalSmartContract (elapsedMs=${Date.now() - treasuryProposalStartedAt})`,
    );

    TreasuryOwnerSmartContract.proposalContractVerificationKey =
      treasuryProposalVerificationKey;
    TreasuryOwnerSmartContract.lifecyclePeriodDuration =
      lifecyclePeriodDuration;

    const treasuryPauseControllerStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] compiling TreasuryPauseControllerSmartContract",
    );
    const { verificationKey: treasuryPauseControllerVerificationKey } =
      await TreasuryPauseControllerSmartContract.compile({
        cache,
      });
    logger.info(
      `[treasury-owner-service:compile] compiled TreasuryPauseControllerSmartContract (elapsedMs=${Date.now() - treasuryPauseControllerStartedAt})`,
    );

    const treasuryOwnerStartedAt = Date.now();
    logger.info(
      "[treasury-owner-service:compile] compiling TreasuryOwnerSmartContract",
    );
    const { verificationKey: treasuryOwnerVerificationKey } =
      await TreasuryOwnerSmartContract.compile({
        cache,
      });
    logger.info(
      `[treasury-owner-service:compile] compiled TreasuryOwnerSmartContract (elapsedMs=${Date.now() - treasuryOwnerStartedAt})`,
    );

    logger.info(
      `[treasury-owner-service:compile] done (elapsedMs=${Date.now() - startedAt})`,
    );

    return {
      voteReducerVerificationKey,
      stakingLedgerToVotingLedgerVerificationKey,
      treasuryProposalVerificationKey,
      treasuryPauseControllerVerificationKey,
      treasuryOwnerVerificationKey,
    };
  }

  public async deploy(
    options: DeployTreasuryOwnerOptions,
  ): Promise<DeployTreasuryOwnerResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPrivateKey,
      pauseControllerPrivateKey,
      treasuryDeployedAtSlot,
      multisigParticipantsPublicKeys,
      allowDeployToExistingAccount,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;

    const senderPublicKey = senderPrivateKey.toPublicKey();
    const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
    const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();

    TreasuryPauseControllerSmartContract.multisigParticipants =
      multisigParticipantsPublicKeys;
    TreasuryOwnerSmartContract.treasuryDeployedAtSlot = treasuryDeployedAtSlot;
    TreasuryOwnerSmartContract.pauseControllerPublicKey =
      pauseControllerPublicKey;

    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerPublicKey,
    );
    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );

    const pauseControllerTx = await Mina.transaction(
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
    pauseControllerTx.sign([senderPrivateKey, pauseControllerPrivateKey]);
    await pauseControllerTx.prove();
    const pauseControllerPendingTx = await this.sendTransaction(
      pauseControllerTx,
      {
        wait,
      },
    );

    const treasuryOwnerTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce: nonce !== undefined ? nonce + 1 : undefined,
        memo,
      },
      async () => {
        if (!allowDeployToExistingAccount) {
          AccountUpdate.fundNewAccount(senderPublicKey, 1);
        }
        await treasuryOwner.deploy();
        if (allowDeployToExistingAccount) {
          treasuryOwner.account.isNew.requireNothing();
        }
      },
    );
    treasuryOwnerTx.sign([senderPrivateKey, treasuryOwnerPrivateKey]);
    await treasuryOwnerTx.prove();
    const treasuryOwnerPendingTx = await this.sendTransaction(treasuryOwnerTx, {
      wait,
    });

    return {
      pauseControllerAddress: pauseControllerPublicKey.toBase58(),
      treasuryOwnerAddress: treasuryOwnerPublicKey.toBase58(),
      pauseControllerTxHash: pauseControllerPendingTx.hash,
      treasuryOwnerTxHash: treasuryOwnerPendingTx.hash,
    };
  }

  public async createProposal(
    options: CreateTreasuryProposalOptions,
  ): Promise<CreateTreasuryProposalResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPublicKey,
      proposalPrivateKey,
      proposalLifecycleId,
      recipientPublicKey,
      amount,
      proposalZkappUri,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;

    const senderPublicKey = senderPrivateKey.toPublicKey();
    const proposalPublicKey = proposalPrivateKey.toPublicKey();

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const pauseControllerPublicKey =
      await treasuryOwner.pauseControllerPublicKey.fetch();
    if (!pauseControllerPublicKey) {
      throw new Error("Treasury owner pause controller public key is not set");
    }

    const proposalTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        AccountUpdate.fundNewAccount(senderPublicKey, 1);
        const bondPayerAccountUpdate =
          AccountUpdate.createSigned(senderPublicKey);
        bondPayerAccountUpdate.balance.subInPlace(
          amount.div(BOND_AMOUNT_DIVISOR),
        );
        await treasuryOwner.createProposal(
          proposalPublicKey,
          {
            amount,
            recipient: recipientPublicKey,
            zkAppUri: ZkappUri.from(proposalZkappUri),
          },
          proposalLifecycleId,
        );
      },
    );
    proposalTx.sign([senderPrivateKey, proposalPrivateKey]);
    await proposalTx.prove();
    const proposalPendingTx = await this.sendTransaction(proposalTx, {
      wait,
    });

    return {
      proposalAddress: proposalPublicKey.toBase58(),
      proposalTokenId: treasuryOwner.deriveTokenId().toString(),
      proposalTxHash: proposalPendingTx.hash,
    };
  }

  public async voteProposal(
    options: VoteTreasuryProposalOptions,
  ): Promise<VoteTreasuryProposalResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPublicKey,
      proposalPublicKey,
      voterPrivateKey,
      vote,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;

    const senderPublicKey = senderPrivateKey.toPublicKey();
    const voterPublicKey = voterPrivateKey.toPublicKey();

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const pauseControllerPublicKey =
      await treasuryOwner.pauseControllerPublicKey.fetch();
    if (!pauseControllerPublicKey) {
      throw new Error("Treasury owner pause controller public key is not set");
    }

    const voteTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await treasuryOwner.vote(
          proposalPublicKey,
          voterPublicKey,
          this.toVote(vote),
        );
      },
    );
    voteTx.sign([senderPrivateKey, voterPrivateKey]);
    await voteTx.prove();
    const votePendingTx = await this.sendTransaction(voteTx, {
      wait,
    });

    return {
      proposalAddress: proposalPublicKey.toBase58(),
      voteTxHash: votePendingTx.hash,
    };
  }

  public async tallyVotes(
    options: TallyVotesTreasuryProposalOptions,
  ): Promise<TallyVotesTreasuryProposalResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPublicKey,
      proposalPublicKey,
      voteReducerProof,
      stakingLedgerToVotingLedgerProof,
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;

    const senderPublicKey = senderPrivateKey.toPublicKey();
    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const proposalTokenId = treasuryOwner.deriveTokenId();

    const { error: treasuryOwnerFetchError } = await fetchAccount({
      publicKey: treasuryOwnerPublicKey,
    });

    const { error: proposalFetchError } = await fetchAccount({
      publicKey: proposalPublicKey,
      tokenId: proposalTokenId,
    });

    const tallyTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        await treasuryOwner.tallyVotes(
          proposalPublicKey,
          voteReducerProof,
          stakingLedgerToVotingLedgerProof,
          treasuryOwnerAccount,
          treasuryOwnerAccountWitness,
        );
      },
    );
    tallyTx.sign([senderPrivateKey]);
    await tallyTx.prove();
    const tallyPendingTx = await this.sendTransaction(tallyTx, {
      wait,
    });

    return {
      proposalAddress: proposalPublicKey.toBase58(),
      tallyTxHash: tallyPendingTx.hash,
    };
  }

  public async transferToTreasury(
    options: TransferToTreasuryOptions,
  ): Promise<TransferToTreasuryResult> {
    const {
      senderPrivateKey,
      fundingPrivateKey: maybeFundingPrivateKey,
      treasuryOwnerPublicKey,
      amount,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    const fundingPrivateKey = maybeFundingPrivateKey ?? senderPrivateKey;
    const senderPublicKey = senderPrivateKey.toPublicKey();
    const fundingPublicKey = fundingPrivateKey.toPublicKey();

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const transferTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        const fundingAccountUpdate =
          AccountUpdate.createSigned(fundingPublicKey);
        fundingAccountUpdate.balance.subInPlace(amount);
        await treasuryOwner.receive(amount);
      },
    );
    const signers: PrivateKey[] = [senderPrivateKey];
    if (!senderPublicKey.equals(fundingPublicKey).toBoolean()) {
      signers.push(fundingPrivateKey);
    }
    transferTx.sign(signers);
    await transferTx.prove();
    const transferPendingTx = await this.sendTransaction(transferTx, {
      wait,
    });

    return {
      sender: senderPublicKey.toBase58(),
      fundingAccount: fundingPublicKey.toBase58(),
      from: fundingPublicKey.toBase58(),
      to: treasuryOwnerPublicKey.toBase58(),
      amount: amount.toString(),
      transferTxHash: transferPendingTx.hash,
    };
  }

  public async executeProposal(
    options: ExecuteTreasuryProposalOptions,
  ): Promise<ExecuteTreasuryProposalResult> {
    const {
      senderPrivateKey,
      treasuryOwnerPublicKey,
      proposalPublicKey,
      recipientPublicKey,
      amountToPayOut,
      fee,
      nonce,
      memo,
      wait = true,
    } = options;
    const senderPublicKey = senderPrivateKey.toPublicKey();
    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const proposalTokenId = treasuryOwner.deriveTokenId();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      proposalTokenId,
    );

    const { error: treasuryOwnerFetchError } = await fetchAccount({
      publicKey: treasuryOwnerPublicKey,
    });

    const { error: proposalFetchError } = await fetchAccount({
      publicKey: proposalPublicKey,
      tokenId: proposalTokenId,
    });
    if (treasuryOwnerFetchError || proposalFetchError) {
      logger.info(
        `[treasury-owner-service:execute-proposal] continuing despite prefetch errors (treasuryOwner=${String(treasuryOwnerFetchError)}, proposal=${String(proposalFetchError)})`,
      );
    }

    const proposalAmount = await proposal.amount.fetch();
    if (!proposalAmount) {
      throw new Error(
        `Proposal amount is not set for ${proposalPublicKey.toBase58()}`,
      );
    }
    const paidOutAmount =
      (await proposal.paidOutAmount.fetch()) ?? UInt64.from(0);
    const fullAmountWithBond = proposalAmount.add(
      proposalAmount.div(BOND_AMOUNT_DIVISOR),
    );
    const remainingAmount = fullAmountWithBond.sub(paidOutAmount);
    const resolvedAmountToPayOut = amountToPayOut ?? remainingAmount;

    const { error: recipientFetchError } = await fetchAccount({
      publicKey: recipientPublicKey,
    });

    const executeTx = await Mina.transaction(
      {
        sender: senderPublicKey,
        fee,
        nonce,
        memo,
      },
      async () => {
        if (recipientFetchError) {
          AccountUpdate.fundNewAccount(senderPublicKey, 1);
        }
        await treasuryOwner.executeProposal(
          proposalPublicKey,
          recipientPublicKey,
          resolvedAmountToPayOut,
        );
      },
    );
    executeTx.sign([senderPrivateKey]);
    await executeTx.prove();
    const executePendingTx = await this.sendTransaction(executeTx, {
      wait,
    });

    return {
      proposalAddress: proposalPublicKey.toBase58(),
      recipientPublicKey: recipientPublicKey.toBase58(),
      amountToPayOut: resolvedAmountToPayOut.toString(),
      executeTxHash: executePendingTx.hash,
    };
  }

  public async getTreasuryOwnerState(
    options: GetTreasuryOwnerStateOptions,
  ): Promise<GetTreasuryOwnerStateResult> {
    const { treasuryOwnerPublicKey } = options;
    const { error } = await fetchAccount({
      publicKey: treasuryOwnerPublicKey,
    });
    if (error) {
      throw new Error(
        `Failed to fetch treasury owner account ${treasuryOwnerPublicKey.toBase58()}: ${String(error)}`,
      );
    }

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const [treasuryDeployedAtSlot, pauseControllerPublicKey] =
      await Promise.all([
        treasuryOwner.treasuryDeployedAtSlot.fetch(),
        treasuryOwner.pauseControllerPublicKey.fetch(),
      ]);

    if (!treasuryDeployedAtSlot) {
      throw new Error(
        `Treasury owner treasuryDeployedAtSlot is not set for ${treasuryOwnerPublicKey.toBase58()}`,
      );
    }
    if (!pauseControllerPublicKey) {
      throw new Error(
        `Treasury owner pauseControllerPublicKey is not set for ${treasuryOwnerPublicKey.toBase58()}`,
      );
    }

    return {
      treasuryOwnerAddress: treasuryOwnerPublicKey.toBase58(),
      treasuryOwnerTokenId: treasuryOwner.deriveTokenId().toString(),
      treasuryDeployedAtSlot: treasuryDeployedAtSlot.toString(),
      pauseControllerPublicKey: pauseControllerPublicKey.toBase58(),
    };
  }

  public async getProposalState(
    options: GetTreasuryProposalStateOptions,
  ): Promise<GetTreasuryProposalStateResult> {
    const { treasuryOwnerPublicKey, proposalPublicKey } = options;
    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const proposalTokenId = treasuryOwner.deriveTokenId();

    const [{ error: treasuryOwnerFetchError }, { error: proposalFetchError }] =
      await Promise.all([
        fetchAccount({
          publicKey: treasuryOwnerPublicKey,
        }),
        fetchAccount({
          publicKey: proposalPublicKey,
          tokenId: proposalTokenId,
        }),
      ]);

    if (treasuryOwnerFetchError) {
      throw new Error(
        `Failed to fetch treasury owner account ${treasuryOwnerPublicKey.toBase58()}: ${String(treasuryOwnerFetchError)}`,
      );
    }
    if (proposalFetchError) {
      throw new Error(
        `Failed to fetch proposal account ${proposalPublicKey.toBase58()} (tokenId=${proposalTokenId.toString()}): ${String(proposalFetchError)}`,
      );
    }

    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      proposalTokenId,
    );
    const [
      recipientHash,
      amount,
      lifecycleId,
      stakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency,
      statusField,
      paidOutAmount,
    ] = await Promise.all([
      proposal.recipientHash.fetch(),
      proposal.amount.fetch(),
      proposal.lifecycleId.fetch(),
      proposal.stakingEpochDataLedgerHash.fetch(),
      proposal.stakingEpochDataLedgerTotalCurrency.fetch(),
      proposal.status.fetch(),
      proposal.paidOutAmount.fetch(),
    ]);

    if (
      !recipientHash ||
      !amount ||
      !lifecycleId ||
      !stakingEpochDataLedgerHash ||
      !stakingEpochDataLedgerTotalCurrency ||
      !statusField ||
      !paidOutAmount
    ) {
      throw new Error(
        `Proposal state is incomplete for ${proposalPublicKey.toBase58()} (tokenId=${proposalTokenId.toString()})`,
      );
    }

    return {
      proposalAddress: proposalPublicKey.toBase58(),
      recipientHash: recipientHash.toString(),
      amount: amount.toString(),
      lifecycleId: lifecycleId.toString(),
      stakingEpochDataLedgerHash: stakingEpochDataLedgerHash.toString(),
      stakingEpochDataLedgerTotalCurrency:
        stakingEpochDataLedgerTotalCurrency.toString(),
      status: this.toProposalStatusName(statusField),
      statusField: statusField.toString(),
      paidOutAmount: paidOutAmount.toString(),
    };
  }

  public async getCurrentLifecyclePeriod(
    options: GetCurrentLifecyclePeriodOptions,
  ): Promise<GetCurrentLifecyclePeriodResult> {
    const { treasuryOwnerPublicKey, minaNodeUrl, lifecyclePeriodDuration } =
      options;

    if (lifecyclePeriodDuration) {
      TreasuryOwnerSmartContract.lifecyclePeriodDuration =
        lifecyclePeriodDuration;
    }

    await this.ensureAccountIsAvailable(treasuryOwnerPublicKey);

    const treasuryOwner = new TreasuryOwnerSmartContract(
      treasuryOwnerPublicKey,
    );
    const treasuryDeployedAtSlot =
      await treasuryOwner.treasuryDeployedAtSlot.fetch();
    if (!treasuryDeployedAtSlot) {
      throw new Error(
        `Treasury owner treasuryDeployedAtSlot is not set for ${treasuryOwnerPublicKey.toBase58()}`,
      );
    }

    const currentGlobalSlot = await this.getCurrentGlobalSlot(minaNodeUrl);
    const lifecyclePeriodDurationResolved =
      TreasuryOwnerSmartContract.lifecyclePeriodDuration;
    const lifecyclePeriodDurationAsBigInt =
      lifecyclePeriodDurationResolved.toBigint();
    if (lifecyclePeriodDurationAsBigInt <= 0n) {
      throw new Error("lifecyclePeriodDuration must be greater than zero");
    }
    const numberOfPeriods = LifecyclePeriod.NUMBER_OF_PERIODS.toBigint();
    const currentGlobalSlotAsBigInt = currentGlobalSlot.toBigint();
    const treasuryDeployedAtSlotAsBigInt = treasuryDeployedAtSlot.toBigint();
    const lifecycleStarted =
      currentGlobalSlotAsBigInt >= treasuryDeployedAtSlotAsBigInt;

    let lifecycleId = UInt32.from(0);
    let periodName: LifecyclePeriodName = "proposal";
    let period = LifecyclePeriod.PROPOSAL;

    if (lifecycleStarted) {
      const elapsedSlots =
        currentGlobalSlotAsBigInt - treasuryDeployedAtSlotAsBigInt;
      const elapsedPeriods = elapsedSlots / lifecyclePeriodDurationAsBigInt;
      lifecycleId = UInt32.from(elapsedPeriods / numberOfPeriods);

      const periodIndex = Number(elapsedPeriods % numberOfPeriods);
      ({ period, periodName } = this.toLifecyclePeriod(periodIndex));
    }

    const { fromSlot, toSlot } =
      await treasuryOwner.getLifecyclePeriodSlotRange(period, lifecycleId);

    return {
      treasuryOwnerAddress: treasuryOwnerPublicKey.toBase58(),
      currentGlobalSlot: currentGlobalSlot.toString(),
      treasuryDeployedAtSlot: treasuryDeployedAtSlot.toString(),
      lifecyclePeriodDuration: lifecyclePeriodDurationResolved.toString(),
      lifecycleStarted,
      lifecycleId: lifecycleId.toString(),
      period: periodName,
      periodStartSlot: fromSlot.toString(),
      periodEndSlot: toSlot.toString(),
    };
  }

  private async createEmptyLedgerRoots(): Promise<{
    emptyVotingLedgerRoot: Awaited<
      ReturnType<PersistentVotingLedger["getRoot"]>
    >;
    emptyNullifierRoot: Awaited<
      ReturnType<PersistentNullifierLedger["getRoot"]>
    >;
  }> {
    const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
    const lifecycleId = "treasury-owner-compile";
    const votingLedgerStorage = createSqliteVotingLedgerStorage(
      lifecycleId,
      sqlite,
    );
    const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(
      lifecycleId,
      sqlite,
    );
    const votingLedger = new PersistentVotingLedger(
      votingLedgerStorage.votingAccountStorage,
      votingLedgerStorage.merkleTreeStorage,
    );
    const nullifierLedger = new PersistentNullifierLedger(
      nullifierLedgerStorage.nullifierStorage,
      nullifierLedgerStorage.merkleTreeStorage,
    );

    try {
      return {
        emptyVotingLedgerRoot: await votingLedger.getRoot(),
        emptyNullifierRoot: await nullifierLedger.getRoot(),
      };
    } finally {
      await votingLedger.close();
      await nullifierLedger.close();
      await sqlite.disconnect();
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

  public async getTreasuryOwnerProofInputsFromSqliteStakingLedger(
    lifecycleId: string | undefined,
    treasuryOwnerPublicKey: PublicKey,
  ): Promise<{
    treasuryOwnerAccount: Account;
    treasuryOwnerAccountWitness: PrefixedMerkleWitness36;
  }> {
    if (!lifecycleId) {
      throw new Error(
        "Missing lifecycleId or explicit treasuryOwnerAccount + treasuryOwnerAccountWitness for tallyVotes().",
      );
    }

    const sqlite = new KeyvSqlite({ uri: getSqliteDbPath(lifecycleId) });
    const stakingLedgerStorage = createSqliteStakingLedgerStorage(
      lifecycleId,
      sqlite,
    );
    const stakingLedger = new PersistentStakingLedger(
      stakingLedgerStorage.accountStorage,
      stakingLedgerStorage.merkleTreeStorage,
    );

    try {
      const stakingAccounts = await stakingLedger.getAllAccounts();
      const treasuryOwnerIndex = stakingAccounts.findIndex((account) =>
        account.pk.equals(treasuryOwnerPublicKey).toBoolean(),
      );
      if (treasuryOwnerIndex < 0) {
        throw new Error(
          `Treasury owner public key ${treasuryOwnerPublicKey.toBase58()} was not found in sqlite staking ledger lifecycle ${lifecycleId}.`,
        );
      }

      const index = BigInt(treasuryOwnerIndex);
      return {
        treasuryOwnerAccount: await stakingLedger.getAccount(index),
        treasuryOwnerAccountWitness: await stakingLedger.getWitness(index),
      };
    } finally {
      await stakingLedger.close();
      await sqlite.disconnect();
    }
  }

  private async getCurrentGlobalSlot(minaNodeUrl: string): Promise<UInt32> {
    try {
      return Mina.getNetworkState().globalSlotSinceGenesis;
    } catch {
      await fetchLastBlock(minaNodeUrl);
      return Mina.getNetworkState().globalSlotSinceGenesis;
    }
  }

  private async ensureAccountIsAvailable(publicKey: PublicKey): Promise<void> {
    try {
      Mina.getAccount(publicKey);
      return;
    } catch {
      // Fall through to fetchAccount for remote Mina instances.
    }

    const { error } = await fetchAccount({
      publicKey,
    });
    if (error) {
      throw new Error(
        `Failed to fetch treasury owner account ${publicKey.toBase58()}: ${String(error)}`,
      );
    }
  }

  private toLifecyclePeriod(periodIndex: number): {
    period: LifecyclePeriod;
    periodName: LifecyclePeriodName;
  } {
    if (periodIndex === 0) {
      return { period: LifecyclePeriod.PROPOSAL, periodName: "proposal" };
    }
    if (periodIndex === 1) {
      return { period: LifecyclePeriod.EXPLORATION, periodName: "exploration" };
    }
    if (periodIndex === 2) {
      return { period: LifecyclePeriod.VOTING, periodName: "voting" };
    }
    return { period: LifecyclePeriod.COOLDOWN, periodName: "cooldown" };
  }

  private toVote(value: ProposalVote): Vote {
    if (value === "yay") return Vote.YAY;
    if (value === "nay") return Vote.NAY;
    return Vote.ABSTRAIN;
  }

  private toProposalStatusName(status: ProposalStatus): string {
    if (status.equals(ProposalStatus.UNKNOWN).toBoolean()) return "unknown";
    if (status.equals(ProposalStatus.APPROVED).toBoolean()) return "approved";
    if (status.equals(ProposalStatus.REJECTED).toBoolean()) return "rejected";
    if (status.equals(ProposalStatus.PAUSED).toBoolean()) return "paused";
    return "unknown-status";
  }
}
