import { Bool, Reducer } from "o1js";
import {
  VOTE_ACTION_BATCH_SIZE,
  VoteAction,
  VoteReducer,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
  voteReducerContext,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingLedger } from "../../ledgers/voting-ledger/voting-ledger.js";
import { NullifierLedger } from "../../ledgers/nullifier-ledger/nullifier-ledger.js";
import { RecordingVotingLedger } from "../../ledgers/voting-ledger/recording-voting-ledger.js";
import { RecordingNullifierLedger } from "../../ledgers/nullifier-ledger/recording-nullifier-ledger.js";
import { VotingAccount } from "../../provable/voting-account.js";
import { PrefixedMerkleWitness256 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { VoteReducerRunBatchTraceStorage } from "../../storage/vote-reducer-run-batch-trace-storage.js";

export interface VoteReducerRunBatchTraceJSON {
  publicInput: ReturnType<typeof VoteReducerPublicInput.toJSON>;
  privateInput: {
    voteActions: ReturnType<typeof VoteAction.toJSON>[];
  };
  votingLedgerWitnesses: Record<
    string,
    ReturnType<typeof PrefixedMerkleWitness256.toJSON>[]
  >;
  votingAccounts: Record<string, ReturnType<typeof VotingAccount.toJSON>[]>;
  nullifierLedgerWitnesses: Record<
    string,
    ReturnType<typeof PrefixedMerkleWitness256.toJSON>[]
  >;
  nullifiers: Record<string, boolean[]>;
}

export class VoteReducerRunBatchTrace {
  public publicInput: VoteReducerPublicInput;
  public privateInput: {
    voteActions: VoteAction[];
  };
  public votingLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;
  public votingAccounts: Record<string, VotingAccount[]>;
  public nullifierLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;
  public nullifiers: Record<string, Bool[]>;

  public constructor({
    publicInput,
    privateInput,
    votingLedgerWitnesses,
    votingAccounts,
    nullifierLedgerWitnesses,
    nullifiers,
  }: {
    publicInput: VoteReducerPublicInput;
    privateInput: {
      voteActions: VoteAction[];
    };
    votingLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;
    votingAccounts: Record<string, VotingAccount[]>;
    nullifierLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;
    nullifiers: Record<string, Bool[]>;
  }) {
    this.publicInput = publicInput;
    this.privateInput = privateInput;
    this.votingLedgerWitnesses = votingLedgerWitnesses;
    this.votingAccounts = votingAccounts;
    this.nullifierLedgerWitnesses = nullifierLedgerWitnesses;
    this.nullifiers = nullifiers;
  }

  public static toJSON(
    trace: VoteReducerRunBatchTrace
  ): VoteReducerRunBatchTraceJSON {
    return {
      publicInput: VoteReducerPublicInput.toJSON(trace.publicInput),
      privateInput: {
        voteActions: trace.privateInput.voteActions.map((voteAction) =>
          VoteAction.toJSON(voteAction)
        ),
      },
      votingLedgerWitnesses: Object.entries(trace.votingLedgerWitnesses).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) => witness.toJSON());
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness256.toJSON>[]
        >
      ),
      votingAccounts: Object.entries(trace.votingAccounts).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((votingAccount) =>
            VotingAccount.toJSON(votingAccount)
          );
          return acc;
        },
        {} as Record<string, ReturnType<typeof VotingAccount.toJSON>[]>
      ),
      nullifierLedgerWitnesses: Object.entries(
        trace.nullifierLedgerWitnesses
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) => witness.toJSON());
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness256.toJSON>[]
        >
      ),
      nullifiers: Object.entries(trace.nullifiers).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((nullifier) => nullifier.toBoolean());
          return acc;
        },
        {} as Record<string, boolean[]>
      ),
    };
  }

  public static fromJSON(
    json: VoteReducerRunBatchTraceJSON
  ): VoteReducerRunBatchTrace {
    return new VoteReducerRunBatchTrace({
      publicInput: VoteReducerPublicInput.fromJSON(json.publicInput),
      privateInput: {
        voteActions: json.privateInput.voteActions.map((voteAction) =>
          VoteAction.fromJSON(voteAction)
        ),
      },
      votingLedgerWitnesses: Object.entries(json.votingLedgerWitnesses).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness256.fromJSON(witness)
          );
          return acc;
        },
        {} as Record<string, PrefixedMerkleWitness256[]>
      ),
      votingAccounts: Object.entries(json.votingAccounts).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((votingAccount) =>
            VotingAccount.fromJSON(votingAccount)
          );
          return acc;
        },
        {} as Record<string, ReturnType<typeof VotingAccount.fromJSON>[]>
      ),
      nullifierLedgerWitnesses: Object.entries(
        json.nullifierLedgerWitnesses
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness256.fromJSON(witness)
          );
          return acc;
        },
        {} as Record<string, PrefixedMerkleWitness256[]>
      ),
      nullifiers: Object.entries(json.nullifiers).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((nullifier) => Bool(nullifier));
          return acc;
        },
        {} as Record<string, Bool[]>
      ),
    });
  }
}

export class VoteReducerTracer {
  constructor(
    public votingLedger: VotingLedger,
    public nullifierLedger: NullifierLedger,
    public traceStorage: VoteReducerRunBatchTraceStorage
  ) {}

  public async close(): Promise<void> {
    await this.votingLedger.close();
    await this.nullifierLedger.close();
    await this.traceStorage.close();
  }

  /**
   * Traces the execution of the `reduceBatch` method of the `VoteReducer` program.
   * @param voteActions - The vote actions to reduce (will be chunked into batches)
   * @param startIndex - The index of the first trace to start tracing at
   * @param endIndex - The index of the last trace to end tracing at
   * @param onTraceComplete - A callback function that is called when a trace is complete, used to track progress
   */
  public async runBatch(
    voteActions: VoteAction[],
    startIndex: number = 0,
    endIndex: number = Infinity,
    onTraceComplete?: (index: number, trace: VoteReducerRunBatchTrace) => void
  ) {
    const recordingVotingLedger = new RecordingVotingLedger(this.votingLedger);
    const recordingNullifierLedger = new RecordingNullifierLedger(
      this.nullifierLedger
    );

    voteReducerContext.set({
      votingLedger: recordingVotingLedger,
      nullifierLedger: recordingNullifierLedger,
    });

    const totalBatches = Math.ceil(voteActions.length / VOTE_ACTION_BATCH_SIZE);
    if (totalBatches === 0) {
      return;
    }

    const lastIndex = Math.min(endIndex, totalBatches - 1);
    let currentPublicInput: VoteReducerPublicInput = {
      fromActionsHash: Reducer.initialActionState,
      votingLedgerRoot: await this.votingLedger.getRoot(),
      fromNullifierRoot: await this.nullifierLedger.getRoot(),
    };
    let publicOutput: VoteReducerPublicOutput | undefined;

    console.time("trace");
    for (let i = startIndex; i <= lastIndex; i++) {
      const batchStart = i * VOTE_ACTION_BATCH_SIZE;
      const batch = voteActions.slice(
        batchStart,
        batchStart + VOTE_ACTION_BATCH_SIZE
      );

      if (batch.length === 0) {
        break;
      }

      if (batch.length < VOTE_ACTION_BATCH_SIZE) {
        const missing = VOTE_ACTION_BATCH_SIZE - batch.length;
        for (let j = 0; j < missing; j++) {
          batch.push(VoteAction.dummy());
        }
      }

      let { publicOutput: currentPublicOutput } =
        await VoteReducer.rawMethods.reduceBatch(currentPublicInput, batch);
      publicOutput = currentPublicOutput;

      const votingLedgerWitnesses =
        recordingVotingLedger.recorder.recordings.witnesses;
      const votingAccounts =
        recordingVotingLedger.recorder.recordings.votingAccounts;
      const nullifierLedgerWitnesses =
        recordingNullifierLedger.recorder.recordings.witnesses;
      const nullifiers =
        recordingNullifierLedger.recorder.recordings.nullifiers;

      const trace = new VoteReducerRunBatchTrace({
        publicInput: currentPublicInput,
        privateInput: { voteActions: batch },
        votingLedgerWitnesses,
        votingAccounts,
        nullifierLedgerWitnesses,
        nullifiers,
      });

      await this.traceStorage.setTrace(i, trace);
      onTraceComplete?.(i, trace);

      currentPublicInput = {
        fromActionsHash: publicOutput.toActionsHash,
        votingLedgerRoot: currentPublicInput.votingLedgerRoot,
        fromNullifierRoot: publicOutput.toNullifierRoot,
      };
    }
    console.timeEnd("trace");
  }
}
