import { Field, Mina, PublicKey, Reducer, TokenId, UInt32, UInt64 } from "../o1js.js";
import { appendActionToHashList } from "../../../sdk/src/provable/hashing-helpers.js";
import { Types } from "../../../sdk/node_modules/o1js/dist/node/bindings/mina-transaction/v1/types.js";
import {
  EpochSeed,
  LedgerHash,
  ReceiptChainHash,
  StateHash,
} from "../../../sdk/node_modules/o1js/dist/node/lib/mina/v1/base58-encodings.js";

export interface LocalBlockchainRuntimeOptions {
  proofsEnabled?: boolean;
}

export interface LocalBlockchainAccountSnapshot {
  publicKey: string;
  privateKey: string;
  balance: string;
}

export interface SubmittedTransactionReceipt {
  hash: string;
  status: "pending" | "included";
  slotBefore: number;
  slotAfter: number;
  label: string | null;
}

export interface SubmitTransactionInput {
  transactionJson: string;
  waitForInclusion?: boolean;
  label?: string | null;
}

export interface SlotMutationResult {
  slotBefore: number;
  slotAfter: number;
}

export interface NetworkStateSummary {
  currentSlot: number;
  blockchainLength: number;
  totalCurrency: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
}

export interface UpdateNetworkStateInput {
  stakingEpochDataLedgerHash?: string;
  stakingEpochDataLedgerTotalCurrency?: string;
}

export interface RuntimeArchiveEvent {
  address: string;
  tokenId: string;
  status: "PENDING" | "CANONICAL";
  blockInfo: {
    height: number;
    timestamp: string;
  };
  eventData: {
    accountUpdateId: string;
    data: string[];
    transactionInfo: {
      hash: string;
      zkappAccountUpdateIds: number[];
    };
  };
}

export interface RuntimeArchiveAction {
  address: string;
  tokenId: string;
  actionState: {
    actionStateOne: string;
    actionStateTwo: string;
    actionStateThree: string;
    actionStateFour: string;
    actionStateFive: string;
  };
  actionData: Array<{
    accountUpdateId: string;
    data: string[];
    transactionInfo: {
      sequenceNumber: number;
      zkappAccountUpdateIds: number[];
    };
  }>;
}

export interface ArchiveFetchOptions {
  address?: string;
  tokenId?: string;
  status: "PENDING" | "CANONICAL";
  from: number;
  to: number;
}

export interface ArchiveActionsFetchOptions {
  address?: string;
  tokenId?: string;
}

export interface SendZkappResult {
  hash: string;
  id: string;
  failureReason: null;
  zkappCommand: {
    memo: string;
    feePayer: {
      body: {
        publicKey: string;
      };
    };
    accountUpdates: Array<{
      body: {
        publicKey: string;
        useFullCommitment: boolean;
        incrementNonce: boolean;
      };
    }>;
  };
}

export type GraphqlTransactionStatus = "INCLUDED" | "PENDING" | "UNKNOWN";

interface RuntimeBlockTransaction {
  hash: string;
  memo: string;
  failureReason: null;
}

interface RuntimeBlock {
  blockHeight: number;
  globalSlotSinceGenesis: number;
  stateHash: string;
  parentHash: string;
  timestamp: string;
  transactions: RuntimeBlockTransaction[];
}

type LocalBlockchainInstance = Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

const DEFAULT_TOKEN_ID_BASE58 = TokenId.toBase58(TokenId.default);
const ZERO_FIELD = Field(0);
const ZERO_LEDGER_HASH = LedgerHash.toBase58(ZERO_FIELD);
const ZERO_EPOCH_SEED = EpochSeed.toBase58(ZERO_FIELD);
const ZERO_STATE_HASH = StateHash.toBase58(ZERO_FIELD);

function toSlotNumber(slot: unknown): number {
  if (typeof slot === "number") {
    return slot;
  }
  if (slot && typeof slot === "object" && "toString" in slot) {
    return Number.parseInt(String(slot.toString()), 10);
  }
  throw new Error("Unable to convert global slot to number");
}

export class LocalBlockchainRuntime {
  private readonly receipts: SubmittedTransactionReceipt[] = [];
  private readonly archiveEvents: RuntimeArchiveEvent[] = [];
  private readonly blocks: RuntimeBlock[] = [];
  private readonly archiveActions = new Map<
    string,
    Array<{
      accountUpdateId: string;
      data: string[];
      txHash: string;
      sequenceNumber: number;
      zkappAccountUpdateIds: number[];
      hash: string;
    }>
  >();
  private nextTransactionSequence = 1;

  private constructor(
    public readonly blockchain: LocalBlockchainInstance,
    public readonly proofsEnabled: boolean,
  ) {
    Mina.setActiveInstance(blockchain);
  }

  public static async create(
    options: LocalBlockchainRuntimeOptions = {},
  ): Promise<LocalBlockchainRuntime> {
    const proofsEnabled = options.proofsEnabled ?? false;
    const blockchain = await Mina.LocalBlockchain({ proofsEnabled });
    return new LocalBlockchainRuntime(blockchain, proofsEnabled);
  }

  public getCurrentSlot(): number {
    Mina.setActiveInstance(this.blockchain);
    return toSlotNumber(Mina.getNetworkState().globalSlotSinceGenesis);
  }

  public getCurrentBlockHeight(): number {
    Mina.setActiveInstance(this.blockchain);
    return toSlotNumber(this.blockchain.getNetworkState().blockchainLength);
  }

  public getNetworkStateSummary(): NetworkStateSummary {
    Mina.setActiveInstance(this.blockchain);
    const networkState = this.blockchain.getNetworkState();
    return {
      currentSlot: this.getCurrentSlot(),
      blockchainLength: toSlotNumber(networkState.blockchainLength),
      totalCurrency: networkState.totalCurrency.toString(),
      stakingEpochDataLedgerHash: networkState.stakingEpochData.ledger.hash.toString(),
      stakingEpochDataLedgerTotalCurrency:
        networkState.stakingEpochData.ledger.totalCurrency.toString(),
    };
  }

  public getNetworkId(): string {
    Mina.setActiveInstance(this.blockchain);
    return String(this.blockchain.getNetworkId());
  }

  public setCurrentSlot(slot: number): SlotMutationResult {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new Error("slot must be a non-negative integer");
    }
    Mina.setActiveInstance(this.blockchain);
    const slotBefore = this.getCurrentSlot();
    this.blockchain.setGlobalSlot(UInt32.from(slot));
    return {
      slotBefore,
      slotAfter: this.getCurrentSlot(),
    };
  }

  public incrementCurrentSlot(by: number): SlotMutationResult {
    if (!Number.isInteger(by) || by <= 0) {
      throw new Error("by must be a positive integer");
    }
    Mina.setActiveInstance(this.blockchain);
    const slotBefore = this.getCurrentSlot();
    this.blockchain.incrementGlobalSlot(UInt32.from(by));
    return {
      slotBefore,
      slotAfter: this.getCurrentSlot(),
    };
  }

  public updateNetworkState(input: UpdateNetworkStateInput): NetworkStateSummary {
    Mina.setActiveInstance(this.blockchain);
    const current = this.blockchain.getNetworkState();
    const nextStakingEpochLedgerHash =
      input.stakingEpochDataLedgerHash !== undefined
        ? Field(input.stakingEpochDataLedgerHash)
        : current.stakingEpochData.ledger.hash;
    const nextStakingEpochLedgerTotalCurrency =
      input.stakingEpochDataLedgerTotalCurrency !== undefined
        ? UInt64.from(input.stakingEpochDataLedgerTotalCurrency)
        : current.stakingEpochData.ledger.totalCurrency;

    this.blockchain.setNetworkState({
      ...current,
      stakingEpochData: {
        ...current.stakingEpochData,
        ledger: {
          ...current.stakingEpochData.ledger,
          hash: nextStakingEpochLedgerHash,
          totalCurrency: nextStakingEpochLedgerTotalCurrency,
        },
      },
    });

    return this.getNetworkStateSummary();
  }

  public getTestAccounts(
    limit = this.blockchain.testAccounts.length,
  ): LocalBlockchainAccountSnapshot[] {
    Mina.setActiveInstance(this.blockchain);
    return this.blockchain.testAccounts.slice(0, limit).map((account) => ({
      publicKey: account.key.toPublicKey().toBase58(),
      privateKey: account.key.toBase58(),
      balance: this.blockchain.getAccount(account.key.toPublicKey()).balance.toString(),
    }));
  }

  public getReceipts(): SubmittedTransactionReceipt[] {
    return [...this.receipts];
  }

  public getArchiveMaxHeights(): {
    canonicalMaxBlockHeight: number;
    pendingMaxBlockHeight: number;
  } {
    const head = this.getCurrentBlockHeight();
    return {
      canonicalMaxBlockHeight: head,
      pendingMaxBlockHeight: head,
    };
  }

  public fetchArchiveEvents(options: ArchiveFetchOptions): RuntimeArchiveEvent[] {
    return this.archiveEvents.filter((event) => {
      if (event.status !== options.status) {
        return false;
      }
      if (event.blockInfo.height < options.from || event.blockInfo.height > options.to) {
        return false;
      }
      if (options.address && event.address !== options.address) {
        return false;
      }
      if (options.tokenId && event.tokenId !== options.tokenId) {
        return false;
      }
      return true;
    });
  }

  public fetchArchiveActions(options: ArchiveActionsFetchOptions): RuntimeArchiveAction[] {
    if (!options.address) {
      return [];
    }
    const tokenId = options.tokenId ?? "1";
    const key = this.getArchiveActionsKey(options.address, tokenId);
    const entries = this.archiveActions.get(key) ?? [];
    if (entries.length === 0) {
      return [];
    }
    const fallback = Reducer.initialActionState.toString();
    const latestHashes = entries
      .map((entry) => entry.hash)
      .slice(-5)
      .reverse();
    while (latestHashes.length < 5) {
      latestHashes.push(fallback);
    }
    return [
      {
        address: options.address,
        tokenId,
        actionState: {
          actionStateOne: latestHashes[0] ?? fallback,
          actionStateTwo: latestHashes[1] ?? fallback,
          actionStateThree: latestHashes[2] ?? fallback,
          actionStateFour: latestHashes[3] ?? fallback,
          actionStateFive: latestHashes[4] ?? fallback,
        },
        actionData: entries.map((entry) => ({
          accountUpdateId: entry.accountUpdateId,
          data: entry.data,
          transactionInfo: {
            sequenceNumber: entry.sequenceNumber,
            zkappAccountUpdateIds: entry.zkappAccountUpdateIds,
          },
        })),
      },
    ];
  }

  public getAccount(publicKeyBase58: string, tokenIdBase58 = "1"): Record<string, unknown> | null {
    Mina.setActiveInstance(this.blockchain);
    try {
      const publicKey = PublicKey.fromBase58(publicKeyBase58);
      const tokenId = tokenIdBase58 === "1" ? TokenId.default : TokenId.fromBase58(tokenIdBase58);
      const normalizedTokenIdBase58 = TokenId.toBase58(tokenId);
      const account = this.blockchain.getAccount(
        publicKey,
        tokenId,
      ) as Record<string, any>;
      const typedAccount = account as Parameters<typeof Types.Account.toJSON>[0];
      const jsonAccount = Types.Account.toJSON(typedAccount) as {
        balance?: string;
        nonce?: string;
        tokenSymbol?: string | null;
        delegate?: string | null;
        votingFor?: string | null;
        permissions?: Record<string, unknown> | null;
        timing?: {
          isTimed?: boolean;
          initialMinimumBalance?: string | null;
          cliffTime?: string | null;
          cliffAmount?: string | null;
          vestingPeriod?: string | null;
          vestingIncrement?: string | null;
        } | null;
      };
      const isTimed = jsonAccount.timing?.isTimed === true;
      const verificationKey = account.zkapp?.verificationKey ?? account.verificationKey ?? null;
      return {
        publicKey: publicKeyBase58,
        token: normalizedTokenIdBase58,
        nonce: jsonAccount.nonce ?? account.nonce?.toString?.() ?? "0",
        balance: {
          total: jsonAccount.balance ?? account.balance?.toString?.() ?? "0",
        },
        tokenSymbol:
          typeof jsonAccount.tokenSymbol === "string" && jsonAccount.tokenSymbol.length > 0
            ? jsonAccount.tokenSymbol
            : null,
        receiptChainHash: account.receiptChainHash
          ? ReceiptChainHash.toBase58(account.receiptChainHash)
          : null,
        timing: {
          initialMinimumBalance: isTimed
            ? jsonAccount.timing?.initialMinimumBalance ?? null
            : null,
          cliffTime: isTimed ? jsonAccount.timing?.cliffTime ?? null : null,
          cliffAmount: isTimed ? jsonAccount.timing?.cliffAmount ?? null : null,
          vestingPeriod: isTimed ? jsonAccount.timing?.vestingPeriod ?? null : null,
          vestingIncrement: isTimed ? jsonAccount.timing?.vestingIncrement ?? null : null,
        },
        permissions: jsonAccount.permissions ?? null,
        delegateAccount: jsonAccount.delegate
          ? {
              publicKey: jsonAccount.delegate,
            }
          : null,
        votingFor: jsonAccount.votingFor ?? null,
        zkappState: account.zkapp?.appState?.map?.((field: { toString(): string }) =>
          field.toString(),
        ) ?? null,
        verificationKey: verificationKey
          ? {
              verificationKey:
                verificationKey.data ?? verificationKey.verificationKey ?? null,
              hash: verificationKey.hash?.toString?.() ?? null,
            }
          : null,
        actionState:
          account.zkapp?.actionState?.map?.((field: { toString(): string }) =>
            field.toString(),
          ) ?? null,
        provedState: account.zkapp ? Boolean(account.zkapp.provedState) : null,
        zkappUri: account.zkapp?.zkappUri ?? null,
      };
    } catch {
      return null;
    }
  }

  public getTransactionStatus(txHash: string): GraphqlTransactionStatus {
    for (let index = this.receipts.length - 1; index >= 0; index -= 1) {
      const receipt = this.receipts[index];
      if (receipt?.hash !== txHash) {
        continue;
      }
      return receipt.status === "included" ? "INCLUDED" : "PENDING";
    }
    return "UNKNOWN";
  }

  public getGenesisConstants(): {
    genesisConstants: {
      genesisTimestamp: string;
      coinbase: string;
      accountCreationFee: string;
    };
    daemonStatus: {
      consensusConfiguration: {
        epochDuration: string;
        k: string;
        slotDuration: string;
        slotsPerEpoch: string;
      };
    };
  } {
    return {
      genesisConstants: {
        genesisTimestamp: "0",
        coinbase: "720000000000",
        accountCreationFee: "1000000000",
      },
      daemonStatus: {
        consensusConfiguration: {
          epochDuration: "7140",
          k: "290",
          slotDuration: "180000",
          slotsPerEpoch: "7140",
        },
      },
    };
  }

  public getBestChain(maxLength: number): Array<{
    stateHash: string;
    transactions: {
      zkappCommands: Array<{
        hash: string;
        failureReason: null;
      }>;
    };
    protocolState: {
      blockchainState: {
        snarkedLedgerHash: string;
        stagedLedgerHash: string;
        date: string;
        utcDate: string;
        stagedLedgerProofEmitted: boolean;
      };
      previousStateHash: string;
      consensusState: {
        blockHeight: string;
        slotSinceGenesis: string;
        slot: string;
        nextEpochData: {
          ledger: {
            hash: string;
            totalCurrency: string;
          };
          seed: string;
          startCheckpoint: string;
          lockCheckpoint: string;
          epochLength: string;
        };
        stakingEpochData: {
          ledger: {
            hash: string;
            totalCurrency: string;
          };
          seed: string;
          startCheckpoint: string;
          lockCheckpoint: string;
          epochLength: string;
        };
        epochCount: string;
        minWindowDensity: string;
        totalCurrency: string;
        epoch: string;
      };
    };
  }> {
    Mina.setActiveInstance(this.blockchain);
    const safeMaxLength = Math.max(1, Math.floor(maxLength));
    const currentNetworkState = this.blockchain.getNetworkState();
    const currentBlockHeight = this.getCurrentBlockHeight();
    const currentSlot = this.getCurrentSlot();
    const bestChain: ReturnType<LocalBlockchainRuntime["getBestChain"]> = [];

    for (
      let blockHeight = currentBlockHeight;
      blockHeight >= Math.max(0, currentBlockHeight - safeMaxLength + 1);
      blockHeight -= 1
    ) {
      const block = this.blocks.find((candidate) => candidate.blockHeight === blockHeight);
      const stateHash = block?.stateHash ?? this.buildStateHash(blockHeight);
      const parentHash =
        block?.parentHash ??
        (blockHeight > 0 ? this.buildStateHash(blockHeight - 1) : ZERO_STATE_HASH);
      const slot =
        blockHeight === currentBlockHeight
          ? currentSlot
          : block?.globalSlotSinceGenesis ?? blockHeight;
      const timestamp = block?.timestamp ?? new Date(0).toISOString();
      const epochData = {
        nextEpochData: this.serializeEpochDataForGraphql(currentNetworkState.nextEpochData),
        stakingEpochData: this.serializeEpochDataForGraphql(
          currentNetworkState.stakingEpochData,
        ),
      };

      bestChain.push({
        stateHash,
        transactions: {
          zkappCommands:
            block?.transactions.map((transaction) => ({
              hash: transaction.hash,
              failureReason: transaction.failureReason,
            })) ?? [],
        },
        protocolState: {
          blockchainState: {
            snarkedLedgerHash: ZERO_LEDGER_HASH,
            stagedLedgerHash: ZERO_LEDGER_HASH,
            date: String(Date.parse(timestamp) || Date.now()),
            utcDate: timestamp,
            stagedLedgerProofEmitted: false,
          },
          previousStateHash: parentHash,
          consensusState: {
            blockHeight: String(blockHeight),
            slotSinceGenesis: String(slot),
            slot: String(slot),
            nextEpochData: epochData.nextEpochData,
            stakingEpochData: epochData.stakingEpochData,
            epochCount: "0",
            minWindowDensity: currentNetworkState.minWindowDensity.toString(),
            totalCurrency: currentNetworkState.totalCurrency.toString(),
            epoch: "0",
          },
        },
      });
    }

    return bestChain;
  }

  public async submitTransaction(
    input: SubmitTransactionInput,
  ): Promise<{ receipt: SubmittedTransactionReceipt; sendZkapp: SendZkappResult }> {
    Mina.setActiveInstance(this.blockchain);
    const slotBefore = this.getCurrentSlot();
    const nextBlockHeight = this.getCurrentBlockHeight() + 1;
    const transaction = Mina.Transaction.fromJSON(input.transactionJson);
    const sequenceNumber = this.nextTransactionSequence;
    this.nextTransactionSequence += 1;
    const pendingTransaction = await transaction.send();
    if (input.waitForInclusion !== false && pendingTransaction.wait) {
      await pendingTransaction.wait();
    }
    this.blockchain.setBlockchainLength(UInt32.from(nextBlockHeight));
    const { slotAfter } = this.incrementCurrentSlot(1);
    const stateHash = this.buildStateHash(nextBlockHeight);
    const parentHash =
      nextBlockHeight > 0 ? this.buildStateHash(nextBlockHeight - 1) : ZERO_STATE_HASH;
    const timestamp = new Date().toISOString();
    this.captureArchiveEvents(
      transaction,
      pendingTransaction.hash,
      nextBlockHeight,
      sequenceNumber,
      timestamp,
    );
    const receipt: SubmittedTransactionReceipt = {
      hash: pendingTransaction.hash,
      status: input.waitForInclusion === false ? "pending" : "included",
      slotBefore,
      slotAfter,
      label: input.label ?? null,
    };
    this.receipts.push(receipt);
    this.blocks.push({
      blockHeight: nextBlockHeight,
      globalSlotSinceGenesis: slotAfter,
      stateHash,
      parentHash,
      timestamp,
      transactions: [
        {
          hash: pendingTransaction.hash,
          memo: transaction.transaction.memo,
          failureReason: null,
        },
      ],
    });
    return {
      receipt,
      sendZkapp: {
        hash: pendingTransaction.hash,
        id: pendingTransaction.hash,
        failureReason: null,
        zkappCommand: {
          memo: transaction.transaction.memo,
          feePayer: {
            body: {
              publicKey:
                transaction.transaction.feePayer.body.publicKey.toBase58?.() ??
                String(transaction.transaction.feePayer.body.publicKey),
            },
          },
          accountUpdates: transaction.transaction.accountUpdates.map((accountUpdate) => ({
            body: {
              publicKey:
                accountUpdate.body.publicKey.toBase58?.() ??
                String(accountUpdate.body.publicKey),
              useFullCommitment: Boolean(accountUpdate.body.useFullCommitment),
              incrementNonce: Boolean(accountUpdate.body.incrementNonce),
            },
          })),
        },
      },
    };
  }

  private captureArchiveEvents(
    transaction: Awaited<ReturnType<typeof Mina.Transaction.fromJSON>>,
    txHash: string,
    blockHeight: number,
    sequenceNumber: number,
    timestamp: string,
  ): void {
    const zkappAccountUpdateIds = transaction.transaction.accountUpdates.map(
      (_accountUpdate, index) => index + 1,
    );
    transaction.transaction.accountUpdates.forEach((accountUpdate, index) => {
      const events = accountUpdate.body.events.data;
      const address =
        accountUpdate.body.publicKey.toBase58?.() ?? String(accountUpdate.body.publicKey);
      const tokenId = TokenId.toBase58(accountUpdate.body.tokenId);
      if (Array.isArray(events) && events.length > 0) {
        events.forEach((eventFields, eventIndex) => {
          this.archiveEvents.push({
            address,
            tokenId,
            status: "CANONICAL",
            blockInfo: {
              height: blockHeight,
              timestamp,
            },
            eventData: {
              accountUpdateId: String(index + 1),
              data: eventFields.map((field) => field.toString()),
              transactionInfo: {
                hash: txHash,
                zkappAccountUpdateIds,
              },
            },
          });
        });
      }
      const actions = accountUpdate.body.actions.data;
      if (!Array.isArray(actions) || actions.length === 0) {
        return;
      }
      const actionKey = this.getArchiveActionsKey(address, tokenId);
      const existingEntries = this.archiveActions.get(actionKey) ?? [];
      let previousHash = existingEntries.at(-1)?.hash ?? Reducer.initialActionState.toString();
      const nextEntries = [...existingEntries];
      for (const actionFields of actions) {
        const nextHash = appendActionToHashList(
          Field(previousHash),
          actionFields,
        ).toString();
        nextEntries.push({
          accountUpdateId: String(index + 1),
          data: actionFields.map((field) => field.toString()),
          txHash,
          sequenceNumber,
          zkappAccountUpdateIds,
          hash: nextHash,
        });
        previousHash = nextHash;
      }
      this.archiveActions.set(actionKey, nextEntries);
    });
  }

  private getArchiveActionsKey(address: string, tokenId: string): string {
    return `${address}:${tokenId}`;
  }

  private serializeEpochDataForGraphql(epochData: {
    ledger: { hash: Field; totalCurrency: { toString(): string } };
    seed: Field;
    startCheckpoint: Field;
    lockCheckpoint: Field;
    epochLength: { toString(): string };
  }): {
    ledger: {
      hash: string;
      totalCurrency: string;
    };
    seed: string;
    startCheckpoint: string;
    lockCheckpoint: string;
    epochLength: string;
  } {
    return {
      ledger: {
        hash: LedgerHash.toBase58(epochData.ledger.hash),
        totalCurrency: epochData.ledger.totalCurrency.toString(),
      },
      seed: EpochSeed.toBase58(epochData.seed),
      startCheckpoint: StateHash.toBase58(epochData.startCheckpoint),
      lockCheckpoint: StateHash.toBase58(epochData.lockCheckpoint),
      epochLength: epochData.epochLength.toString(),
    };
  }

  private buildStateHash(blockHeight: number): string {
    return StateHash.toBase58(Field(blockHeight));
  }
}
