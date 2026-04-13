import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Field, Reducer, TokenId, type Proof } from "o1js";
import { InMemoryVotingLedger } from "../../ledgers/voting-ledger/in-memory-voting-ledger.js";
import { InMemoryNullifierLedger } from "../../ledgers/nullifier-ledger/in-memory-nullifier-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import { ReplayableNullifierLedger } from "../../ledgers/nullifier-ledger/replayable-nullifier-ledger.js";
import {
  type SideLoadedVoteReducerProof,
  VoteAction,
  VoteReducer,
  type VoteReducerPublicInput,
  type VoteReducerPublicOutput,
  voteReducerContext,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import {
  VoteReducerProver,
  type VoteReducerTaskQueue,
} from "../../proving/prover/vote-reducer-prover.js";
import {
  VoteReducerTracer,
  type VoteReducerRunBatchTrace,
} from "../../proving/tracing/vote-reducer-tracer.js";
import { TaskQueue } from "../../proving/task-queue.js";
import { tasks } from "../../proving/tasks/index.js";
import { createInMemoryVotingLedgerStorage } from "../../storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { createInMemoryNullifierLedgerStorage } from "../../storage/in-memory/factory/in-memory-nullifier-ledger-storage.js";
import { createSqliteBatchWriter } from "../../storage/sqlite/factory/sqlite-batch-writer.js";
import { createSqliteNullifierLedgerStorage } from "../../storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVoteReducerProofStorage } from "../../storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "../../storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import { createSqliteVotingLedgerStorage } from "../../storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { getSqliteDbPath } from "../../storage/sqlite/sqlite-db-path.js";
import {
  type CompileVoteReducerOptions,
  type VoteReducerService,
  type VoteReducerServiceOptions,
} from "../vote-reducer-service.js";
import type {
  FetchProposalActionsResult,
  VoteReducerActionStateHistoryTargetSnapshot,
} from "../vote-reducer-types.js";

export class SqliteVoteReducerService implements VoteReducerService {
  private tracer?: VoteReducerTracer;
  private prover?: VoteReducerProver;
  private sqliteStore?: KeyvSqlite;
  private votingLedger?: InMemoryVotingLedger;
  private nullifierLedger?: InMemoryNullifierLedger;
  private traceStorage?: ReturnType<
    typeof createSqliteVoteReducerRunBatchTraceStorage
  >;
  private proofStorage?: ReturnType<typeof createSqliteVoteReducerProofStorage>;
  private traceBatchWriter?: ReturnType<typeof createSqliteBatchWriter>;
  private proofBatchWriter?: ReturnType<typeof createSqliteBatchWriter>;
  private taskQueue?: VoteReducerTaskQueue;

  public constructor(private readonly options: VoteReducerServiceOptions) {}

  public async start(): Promise<void> {
    const { lifecycleId } = this.options;
    const sqlitePath = getSqliteDbPath(lifecycleId);
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.sqliteStore = new KeyvSqlite({ uri: sqlitePath });

    const votingLedgerStorage = createInMemoryVotingLedgerStorage(
      createSqliteVotingLedgerStorage(lifecycleId, this.sqliteStore),
    );
    this.votingLedger = new InMemoryVotingLedger(
      votingLedgerStorage.votingAccountStorage,
      votingLedgerStorage.merkleTreeStorage,
    );

    const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
      createSqliteNullifierLedgerStorage(lifecycleId, this.sqliteStore),
    );
    this.nullifierLedger = new InMemoryNullifierLedger(
      nullifierLedgerStorage.nullifierStorage,
      nullifierLedgerStorage.merkleTreeStorage,
    );

    this.traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
      lifecycleId,
      this.sqliteStore,
    );
    this.proofStorage = createSqliteVoteReducerProofStorage(
      lifecycleId,
      this.sqliteStore,
    );
    this.traceBatchWriter = createSqliteBatchWriter(this.sqliteStore);
    this.proofBatchWriter = createSqliteBatchWriter(this.sqliteStore);

    this.tracer = new VoteReducerTracer(
      this.votingLedger,
      this.nullifierLedger,
      this.traceStorage,
      this.traceBatchWriter,
      {
        archiveNodeUrl: this.options.archiveNodeUrl,
        proposalPublicKey: this.options.proposalPublicKey,
        proposalTokenId: this.options.proposalTokenId,
        actionStateHistoryTarget: this.options.actionStateHistoryTarget,
      },
    );
  }

  public async clearPersistentState(): Promise<void> {
    const { lifecycleId } = this.options;
    const sqliteStore = this.sqliteStore ?? new KeyvSqlite({ uri: getSqliteDbPath(lifecycleId) });
    const shouldDisconnectStore = !this.sqliteStore;
    const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
      lifecycleId,
      sqliteStore,
    );
    const proofStorage = createSqliteVoteReducerProofStorage(
      lifecycleId,
      sqliteStore,
    );
    const nullifierLedgerStorage = createSqliteNullifierLedgerStorage(
      lifecycleId,
      sqliteStore,
    );

    try {
      await traceStorage.clear();
      await proofStorage.clear();
      await nullifierLedgerStorage.nullifierStorage.clear();
      await nullifierLedgerStorage.merkleTreeStorage.clear();
    } finally {
      await traceStorage.close();
      await proofStorage.close();
      await nullifierLedgerStorage.nullifierStorage.close();
      await nullifierLedgerStorage.merkleTreeStorage.close();
      if (shouldDisconnectStore) {
        await sqliteStore.disconnect();
      }
    }
  }

  public async getVoteWeight(voterPublicKey: string): Promise<bigint> {
    if (!this.votingLedger) {
      throw new Error(
        "SqliteVoteReducerService.start() must be called before getVoteWeight()",
      );
    }
    const votingAccount = await this.votingLedger.getVotingAccount(voterPublicKey);
    return votingAccount.balance.toBigInt();
  }

  public async compile(options: CompileVoteReducerOptions = {}): Promise<void> {
    const proofsEnabled =
      options.proofsEnabled ?? process.env.PROOFS_ENABLED === "true";
    voteReducerContext.set({
      votingLedger: new ReplayableVotingLedger({}, {}),
      nullifierLedger: new ReplayableNullifierLedger({}, {}),
    });
    await VoteReducer.compile({ proofsEnabled });
  }

  public async fetchProposalActions(): Promise<FetchProposalActionsResult> {
    const { archiveNodeUrl, proposalPublicKey, proposalTokenId } = this.options;
    if (!archiveNodeUrl || !proposalPublicKey || !proposalTokenId) {
      throw new Error(
        "SqliteVoteReducerService.fetchProposalActions() requires archiveNodeUrl, proposalPublicKey, and proposalTokenId",
      );
    }

    const archiveTokenId = normalizeArchiveTokenId(proposalTokenId);
    const response = await fetch(archiveNodeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operationName: null,
        query: `{
  actions(input: { address: "${proposalPublicKey}", tokenId: "${archiveTokenId}" }) {
    actionState {
      actionStateOne
      actionStateTwo
      actionStateThree
      actionStateFour
      actionStateFive
    }
    actionData {
      accountUpdateId
      data
      transactionInfo {
        sequenceNumber
        zkappAccountUpdateIds
      }
    }
  }
}`,
        variables: {},
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch proposal actions from archive node: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      data?: {
        actions?: ArchiveActionBlock[];
      };
      errors?: { message?: string }[];
    };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) => error.message)
          .filter((message): message is string => Boolean(message))
          .join("; ") || "Failed to fetch proposal actions from archive node",
      );
    }

    const actionBlocks = payload.data?.actions ?? [];
    const voteActions = actionBlocks
      .flatMap((actionBlock) => normalizeArchiveActionBlock(actionBlock.actionData))
      .map((actionFields) => actionFields.map((field) => Field(field)))
      .map((actionFields) => {
        const isDummyAction = actionFields.every((field) =>
          field.equals(Field(0)).toBoolean(),
        );
        return isDummyAction
          ? VoteAction.dummy()
          : VoteAction.fromFields(actionFields);
      });

    return {
      proposalPublicKey,
      proposalTokenId: archiveTokenId,
      voteActions,
      actionStateHistoryTarget: getActionStateHistoryTargetSnapshot(
        actionBlocks.at(-1)?.actionState,
      ),
    };
  }

  public async traceRunBatch(
    voteActions: VoteAction[],
    onTraceComplete?: (index: number, trace: VoteReducerRunBatchTrace) => void,
  ): Promise<void> {
    const tracer = this.getTracer();
    await tracer.runBatch(voteActions, onTraceComplete);
  }

  public async proveRunBatch(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onRunBatchComplete?: (
      index: number,
      proof: Proof<VoteReducerPublicInput, VoteReducerPublicOutput>,
    ) => void,
  ): Promise<void> {
    const prover = this.getOrCreateProver();
    await prover.runBatch(startIndex, endIndex, onRunBatchComplete);
  }

  public async proveMerge(
    onMergeComplete?: (index: number, proof: SideLoadedVoteReducerProof) => void,
  ): Promise<SideLoadedVoteReducerProof> {
    const prover = this.getOrCreateProver();
    return await prover.merge(onMergeComplete);
  }

  private getTracer(): VoteReducerTracer {
    if (!this.tracer) {
      throw new Error(
        "SqliteVoteReducerService requires a tracer instance for traceRunBatch()",
      );
    }
    return this.tracer;
  }

  private getOrCreateProver(): VoteReducerProver {
    if (this.prover) {
      return this.prover;
    }

    if (!this.traceStorage || !this.proofStorage || !this.proofBatchWriter) {
      throw new Error(
        "SqliteVoteReducerService.start() must be called before proving",
      );
    }

    const { lifecycleId, redisConnection, queueName } = this.options;
    if (!redisConnection) {
      throw new Error(
        "SqliteVoteReducerService requires redisConnection for proveRunBatch()/proveMerge()",
      );
    }

    if (!this.taskQueue) {
      this.taskQueue = new TaskQueue(
        queueName ?? `vote-reducer-${lifecycleId}`,
        tasks,
        redisConnection,
      ) as VoteReducerTaskQueue;
    }

    this.prover = new VoteReducerProver(
      this.traceStorage,
      this.proofStorage,
      this.proofBatchWriter,
      this.taskQueue,
    );

    return this.prover;
  }

  public async close(): Promise<void> {
    await this.votingLedger?.close();
    await this.nullifierLedger?.close();
    await this.traceStorage?.close();
    await this.traceBatchWriter?.close();
    await this.proofStorage?.close();
    await this.proofBatchWriter?.close();
    this.votingLedger = undefined;
    this.nullifierLedger = undefined;
    this.traceStorage = undefined;
    this.traceBatchWriter = undefined;
    this.proofStorage = undefined;
    this.proofBatchWriter = undefined;
    this.tracer = undefined;
    this.prover = undefined;
    await this.taskQueue?.close();
    this.taskQueue = undefined;
    await this.sqliteStore?.disconnect();
    this.sqliteStore = undefined;
  }
}

interface ArchiveActionBlock {
  actionState?: Partial<VoteReducerActionStateHistoryTargetSnapshot> | null;
  actionData?: ArchiveActionData[];
}

interface ArchiveActionData {
  accountUpdateId: string;
  data: string[];
  transactionInfo?: {
    sequenceNumber: number;
    zkappAccountUpdateIds: number[];
  } | null;
}

function normalizeArchiveActionBlock(actionData: ArchiveActionData[] = []): string[][] {
  const sortedActionData = [...actionData];

  if (!sortedActionData[0]?.transactionInfo) {
    sortedActionData.sort(
      (action1, action2) =>
        Number(action1.accountUpdateId) - Number(action2.accountUpdateId),
    );
  } else {
    sortedActionData.sort((action1, action2) => {
      const action1TxSequence = action1.transactionInfo?.sequenceNumber ?? 0;
      const action2TxSequence = action2.transactionInfo?.sequenceNumber ?? 0;

      if (action1TxSequence === action2TxSequence) {
        const action1UpdateSequence =
          action1.transactionInfo?.zkappAccountUpdateIds.indexOf(
            Number(action1.accountUpdateId),
          ) ?? 0;
        const action2UpdateSequence =
          action2.transactionInfo?.zkappAccountUpdateIds.indexOf(
            Number(action2.accountUpdateId),
          ) ?? 0;
        return action1UpdateSequence - action2UpdateSequence;
      }

      return action1TxSequence - action2TxSequence;
    });
  }

  const groupedActions: string[][] = [];
  let currentAccountUpdateId: string | undefined;
  for (const action of sortedActionData) {
    if (action.accountUpdateId !== currentAccountUpdateId) {
      currentAccountUpdateId = action.accountUpdateId;
    }
    groupedActions.push(action.data);
  }

  return groupedActions;
}

function getActionStateHistoryTargetSnapshot(
  actionState?: Partial<VoteReducerActionStateHistoryTargetSnapshot> | null,
): VoteReducerActionStateHistoryTargetSnapshot {
  const fallback = Reducer.initialActionState.toString();
  return {
    actionStateOne: actionState?.actionStateOne ?? fallback,
    actionStateTwo: actionState?.actionStateTwo ?? fallback,
    actionStateThree: actionState?.actionStateThree ?? fallback,
    actionStateFour: actionState?.actionStateFour ?? fallback,
    actionStateFive: actionState?.actionStateFive ?? fallback,
  };
}

function normalizeArchiveTokenId(tokenId: string): string {
  try {
    return TokenId.toBase58(Field(tokenId));
  } catch {
    return tokenId;
  }
}
