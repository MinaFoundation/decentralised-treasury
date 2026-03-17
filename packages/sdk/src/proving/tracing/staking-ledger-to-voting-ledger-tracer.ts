import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Account } from "../../provable/account.js";
import { Provable, UInt32, UInt64 } from "o1js";
import { RecordingStakingLedger } from "../../ledgers/staking-ledger/recording-staking-ledger.js";
import { RecordingVotingLedger } from "../../ledgers/voting-ledger/recording-voting-ledger.js";
import {
  PrefixedMerkleWitness255,
  PrefixedMerkleWitness36,
} from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../provable/voting-account.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { VotingLedger } from "../../ledgers/voting-ledger/voting-ledger.js";
import { StakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../../storage/staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { PersistentStakingLedger } from "../../ledgers/staking-ledger/persistent-staking-ledger.js";
import { PersistentVotingLedger } from "../../ledgers/voting-ledger/persistent-voting-ledger.js";
import { InMemoryVotingAccountStorage } from "../../storage/in-memory/in-memory-voting-account-storage.js";
import { InMemoryVotingLedger } from "../../ledgers/voting-ledger/in-memory-voting-ledger.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";

export interface StakingLedgerToVotingLedgerDigestTraceJSON {
  publicInput: ReturnType<
    typeof StakingLedgerToVotingLedgerProgramInput.toJSON
  >;
  privateInput: {
    accounts: ReturnType<typeof Account.toJSON>[];
  };
  stakingLedgerWitnesses: Record<
    string,
    ReturnType<typeof PrefixedMerkleWitness36.toJSON>[]
  >;
  votingAccounts: Record<string, ReturnType<typeof VotingAccount.toJSON>[]>;
  votingLedgerWitnesses: Record<
    string,
    ReturnType<typeof PrefixedMerkleWitness255.toJSON>[]
  >;
}

export class StakingLedgerToVotingLedgerDigestTrace {
  public publicInput: StakingLedgerToVotingLedgerProgramInput;
  public privateInput: {
    accounts: Account[];
  };
  public stakingLedgerWitnesses: Record<string, PrefixedMerkleWitness36[]>;
  public votingAccounts: Record<string, VotingAccount[]>;
  public votingLedgerWitnesses: Record<string, PrefixedMerkleWitness255[]>;

  public constructor({
    publicInput,
    privateInput,
    stakingLedgerWitnesses,
    votingAccounts,
    votingLedgerWitnesses,
  }: {
    publicInput: StakingLedgerToVotingLedgerProgramInput;
    privateInput: {
      accounts: Account[];
    };
    stakingLedgerWitnesses: Record<string, PrefixedMerkleWitness36[]>;
    votingAccounts: Record<string, VotingAccount[]>;
    votingLedgerWitnesses: Record<string, PrefixedMerkleWitness255[]>;
  }) {
    this.publicInput = publicInput;
    this.privateInput = privateInput;
    this.stakingLedgerWitnesses = stakingLedgerWitnesses;
    this.votingAccounts = votingAccounts;
    this.votingLedgerWitnesses = votingLedgerWitnesses;
  }

  public static toJSON(
    trace: StakingLedgerToVotingLedgerDigestTrace,
  ): StakingLedgerToVotingLedgerDigestTraceJSON {
    return {
      publicInput: StakingLedgerToVotingLedgerProgramInput.toJSON(
        trace.publicInput,
      ),
      privateInput: {
        accounts: trace.privateInput.accounts.map((account) =>
          Account.toJSON(account),
        ),
      },
      stakingLedgerWitnesses: Object.entries(
        trace.stakingLedgerWitnesses,
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) => witness.toJSON());
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness36.toJSON>[]
        >,
      ),
      votingAccounts: Object.entries(trace.votingAccounts).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((votingAccount) =>
            VotingAccount.toJSON(votingAccount),
          );
          return acc;
        },
        {} as Record<string, ReturnType<typeof VotingAccount.toJSON>[]>,
      ),
      votingLedgerWitnesses: Object.entries(trace.votingLedgerWitnesses).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) => witness.toJSON());
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness255.toJSON>[]
        >,
      ),
    };
  }

  public static fromJSON(
    json: StakingLedgerToVotingLedgerDigestTraceJSON,
  ): StakingLedgerToVotingLedgerDigestTrace {
    return new StakingLedgerToVotingLedgerDigestTrace({
      publicInput: StakingLedgerToVotingLedgerProgramInput.fromJSON(
        json.publicInput,
      ),
      privateInput: {
        accounts: json.privateInput.accounts.map((account) =>
          Account.fromJSON(account),
        ),
      },
      stakingLedgerWitnesses: Object.entries(
        json.stakingLedgerWitnesses,
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness36.fromJSON(witness),
          );
          return acc;
        },
        {} as Record<string, PrefixedMerkleWitness36[]>,
      ),
      votingAccounts: Object.entries(json.votingAccounts).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((votingAccount) =>
            VotingAccount.fromJSON(votingAccount),
          );
          return acc;
        },
        {} as Record<string, ReturnType<typeof VotingAccount.fromJSON>[]>,
      ),
      votingLedgerWitnesses: Object.entries(json.votingLedgerWitnesses).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness255.fromJSON(witness),
          );
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness255.fromJSON>[]
        >,
      ),
    });
  }
}

export class StakingLedgerToVotingLedgerTracer {
  constructor(
    public stakingLedger: StakingLedger,
    public votingLedger: InMemoryVotingLedger,
    public traceStorage: StakingLedgerToVotingLedgerDigestTraceBatchStorage,
    public batchWriter: KeyValueBatchStorage,
  ) {}

  public async close(): Promise<void> {
    await this.stakingLedger.close();
    await this.votingLedger.close();
    await this.traceStorage.close();
    await this.batchWriter.close();
  }

  /**
   * Traces the execution of the `digest` method of the `StakingLedgerToVotingLedger` program.
   * @param startIndex - The index of the first trace to start tracing at
   * @param endIndex - The index of the last trace to end tracing at
   * @param onTraceComplete - A callback function that is called when a trace is complete, used to track progress
   */
  public async digest(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onTraceComplete?: (
      index: number,
      trace: StakingLedgerToVotingLedgerDigestTrace,
      publicOutput: StakingLedgerToVotingLedgerProgramOutput,
    ) => void,
  ) {
    const recordingStakingLedger = new RecordingStakingLedger(
      this.stakingLedger,
    );

    const recordingVotingLedger = new RecordingVotingLedger(this.votingLedger);

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: recordingStakingLedger,
      votingLedger: recordingVotingLedger,
    });

    let publicOutput: StakingLedgerToVotingLedgerProgramOutput;

    const stakingLedgerRoot = await this.stakingLedger.getRoot();
    let votingLedgerRoot = await this.votingLedger.getRoot();

    console.time("trace-digest-complete");
    for (let i = startIndex; i <= endIndex; i++) {
      console.time("trace-digest");
      const accountsSlice: Account[] = [];
      const sliceStartIndex = i * ACCOUNT_BATCH_SIZE;

      for (let j = 0; j < ACCOUNT_BATCH_SIZE; j++) {
        const accountIndex = sliceStartIndex + j;
        const account = await this.stakingLedger.getAccount(
          BigInt(accountIndex),
        );

        accountsSlice.push(account);
      }

      // we're out of accounts to digest, stop tracing
      if (Account.isEmpty(accountsSlice[0]).toBoolean()) {
        break;
      }

      const publicInput: StakingLedgerToVotingLedgerProgramInput = {
        index: UInt64.from(i * ACCOUNT_BATCH_SIZE),
        stakingLedgerRoot,
        votingLedgerRoot,
      };

      let { publicOutput: currentPublicOutput } =
        await StakingLedgerToVotingLedger.rawMethods.digest(
          publicInput,
          accountsSlice,
        );

      publicOutput = currentPublicOutput;
      votingLedgerRoot = publicOutput.votingLedgerRoot;

      const stakingLedgerWitnesses =
        recordingStakingLedger.recorder.recordings.witnesses;
      const votingLedgerWitnesses =
        recordingVotingLedger.recorder.recordings.witnesses;
      const votingAccounts =
        recordingVotingLedger.recorder.recordings.votingAccounts;

      const trace = new StakingLedgerToVotingLedgerDigestTrace({
        publicInput,
        privateInput: {
          accounts: accountsSlice,
        },
        stakingLedgerWitnesses,
        votingLedgerWitnesses,
        votingAccounts,
      });

      await this.traceStorage.setTrace(i, trace);

      const batchStorages = [this.traceStorage, this.votingLedger];

      const entries = batchStorages.flatMap((storage) =>
        storage.collectEntries(),
      );

      await this.batchWriter.setMany(entries);
      batchStorages.forEach((storage) => storage.clearEntries());

      const recorders = [recordingStakingLedger, recordingVotingLedger];
      recorders.forEach((recorder) => recorder.clear());

      onTraceComplete?.(i, trace, publicOutput);
      console.timeEnd("trace-digest");
    }
    console.timeEnd("trace-digest-complete");
  }
}
