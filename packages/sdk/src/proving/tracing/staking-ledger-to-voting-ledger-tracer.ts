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
  PrefixedMerkleWitness256,
  PrefixedMerkleWitness36,
} from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../provable/voting-account.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { VotingLedger } from "../../ledgers/voting-ledger/voting-ledger.js";
import { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";

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
    ReturnType<typeof PrefixedMerkleWitness256.toJSON>[]
  >;
}

export class StakingLedgerToVotingLedgerDigestTrace {
  public publicInput: StakingLedgerToVotingLedgerProgramInput;
  public privateInput: {
    accounts: Account[];
  };
  public stakingLedgerWitnesses: Record<string, PrefixedMerkleWitness36[]>;
  public votingAccounts: Record<string, VotingAccount[]>;
  public votingLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;

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
    votingLedgerWitnesses: Record<string, PrefixedMerkleWitness256[]>;
  }) {
    this.publicInput = publicInput;
    this.privateInput = privateInput;
    this.stakingLedgerWitnesses = stakingLedgerWitnesses;
    this.votingAccounts = votingAccounts;
    this.votingLedgerWitnesses = votingLedgerWitnesses;
  }

  public static toJSON(
    trace: StakingLedgerToVotingLedgerDigestTrace
  ): StakingLedgerToVotingLedgerDigestTraceJSON {
    return {
      publicInput: StakingLedgerToVotingLedgerProgramInput.toJSON(
        trace.publicInput
      ),
      privateInput: {
        accounts: trace.privateInput.accounts.map((account) =>
          Account.toJSON(account)
        ),
      },
      stakingLedgerWitnesses: Object.entries(
        trace.stakingLedgerWitnesses
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) => witness.toJSON());
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness36.toJSON>[]
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
    };
  }

  public static fromJSON(
    json: StakingLedgerToVotingLedgerDigestTraceJSON
  ): StakingLedgerToVotingLedgerDigestTrace {
    return new StakingLedgerToVotingLedgerDigestTrace({
      publicInput: StakingLedgerToVotingLedgerProgramInput.fromJSON(
        json.publicInput
      ),
      privateInput: {
        accounts: json.privateInput.accounts.map(Account.fromJSON),
      },
      stakingLedgerWitnesses: Object.entries(
        json.stakingLedgerWitnesses
      ).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness36.fromJSON(witness)
          );
          return acc;
        },
        {} as Record<string, PrefixedMerkleWitness36[]>
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
      votingLedgerWitnesses: Object.entries(json.votingLedgerWitnesses).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((witness) =>
            PrefixedMerkleWitness256.fromJSON(witness)
          );
          return acc;
        },
        {} as Record<
          string,
          ReturnType<typeof PrefixedMerkleWitness256.fromJSON>[]
        >
      ),
    });
  }
}

export class StakingLedgerToVotingLedgerTracer {
  constructor(
    public stakingLedger: StakingLedger,
    public votingLedger: VotingLedger,
    public traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage
  ) {}

  public async close(): Promise<void> {
    await this.stakingLedger.close();
    await this.votingLedger.close();
    await this.traceStorage.close();
  }

  public async digest(
    startIndex: number = 0,
    endIndex?: number,
    onTraceComplete?: (
      index: number,
      trace: StakingLedgerToVotingLedgerDigestTrace
    ) => void
  ) {
    const recordingStakingLedger = new RecordingStakingLedger(
      this.stakingLedger
    );

    const recordingVotingLedger = new RecordingVotingLedger(this.votingLedger);

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: recordingStakingLedger,
      votingLedger: recordingVotingLedger,
    });

    let publicOutput: StakingLedgerToVotingLedgerProgramOutput;

    const stakingLedgerRoot = await this.stakingLedger.getRoot();
    let votingLedgerRoot = await this.votingLedger.getRoot();

    for (let i = startIndex; i < endIndex; i++) {
      const accountsSlice = [];
      const sliceStartIndex = i * ACCOUNT_BATCH_SIZE;
      for (let j = 0; j < ACCOUNT_BATCH_SIZE; j++) {
        const accountIndex = sliceStartIndex + j;
        const account = await this.stakingLedger.getAccount(
          BigInt(accountIndex)
        );

        accountsSlice.push(account);
      }

      const publicInput: StakingLedgerToVotingLedgerProgramInput = {
        index: UInt32.from(i * ACCOUNT_BATCH_SIZE),
        stakingLedgerRoot,
        votingLedgerRoot,
        totalCurrency: publicOutput?.totalCurrency ?? UInt64.from(0),
      };

      let { publicOutput: currentPublicOutput } =
        await StakingLedgerToVotingLedger.rawMethods.digest(
          publicInput,
          accountsSlice
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

      // TODO: introduce transactional storage operations for everything tracing related (tree operations etc.)
      await this.traceStorage.setTrace(i, trace);
      onTraceComplete?.(i, trace);
    }

    console.timeEnd("trace");
  }
}
