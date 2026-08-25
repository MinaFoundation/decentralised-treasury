import { ReplayableStakingLedger } from "../../ledgers/staking-ledger/replayable-staking-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import {
  type SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  type StakingLedgerToVotingLedgerProgramInput,
  type StakingLedgerToVotingLedgerProgramOutput,
  stakingLedgerToVotingLedgerContext,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { type Proof } from "o1js";
import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PersistentStakingLedger } from "../../ledgers/staking-ledger/persistent-staking-ledger.js";
import { InMemoryVotingLedger } from "../../ledgers/voting-ledger/in-memory-voting-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createInMemoryVotingLedgerStorage } from "../../storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { createSqliteStakingLedgerToVotingLedgerDigestTraceStorage } from "../../storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { createSqliteStakingLedgerToVotingLedgerProofStorage } from "../../storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-proof-storage.js";
import { createSqliteBatchWriter } from "../../storage/sqlite/factory/sqlite-batch-writer.js";
import { getSqliteDbPath } from "../../storage/sqlite/sqlite-db-path.js";
import { applyFastSqlitePragmas } from "../../storage/sqlite/sqlite-fast-pragmas.js";
import {
  StakingLedgerToVotingLedgerProver,
  type StakingLedgerToVotingLedgerTaskQueue,
} from "../../proving/prover/staking-ledger-to-voting-ledger-prover.js";
import {
  StakingLedgerToVotingLedgerTracer,
  type StakingLedgerToVotingLedgerDigestTrace,
} from "../../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import {
  type CompileStakingLedgerToVotingLedgerOptions,
  type StakingLedgerToVotingLedgerServiceOptions,
  type StakingLedgerToVotingLedgerService,
} from "../staking-ledger-to-voting-ledger-service.js";
import { TaskQueue } from "../../proving/task-queue.js";
import { tasks } from "../../proving/tasks/index.js";

export class SqliteStakingLedgerToVotingLedgerService
  implements StakingLedgerToVotingLedgerService
{
  private tracer?: StakingLedgerToVotingLedgerTracer;
  private prover?: StakingLedgerToVotingLedgerProver;
  private sqliteStore?: KeyvSqlite;
  private stakingLedger?: PersistentStakingLedger;
  private votingLedger?: InMemoryVotingLedger;
  private traceStorage?: ReturnType<
    typeof createSqliteStakingLedgerToVotingLedgerDigestTraceStorage
  >;
  private proofStorage?: ReturnType<
    typeof createSqliteStakingLedgerToVotingLedgerProofStorage
  >;
  private traceBatchWriter?: ReturnType<typeof createSqliteBatchWriter>;
  private proofBatchWriter?: ReturnType<typeof createSqliteBatchWriter>;
  private taskQueue?: StakingLedgerToVotingLedgerTaskQueue;

  public constructor(
    private readonly options: StakingLedgerToVotingLedgerServiceOptions,
  ) {}

  public async start(): Promise<void> {
    const { lifecycleId } = this.options;
    const sqlitePath = getSqliteDbPath(lifecycleId);
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.sqliteStore = new KeyvSqlite({ uri: sqlitePath });
    await applyFastSqlitePragmas(this.sqliteStore);

    const stakingLedgerStorage = createSqliteStakingLedgerStorage(
      lifecycleId,
      this.sqliteStore,
    );
    this.stakingLedger = new PersistentStakingLedger(
      stakingLedgerStorage.accountStorage,
      stakingLedgerStorage.merkleTreeStorage,
    );

    const votingLedgerStorage = createInMemoryVotingLedgerStorage(
      createSqliteVotingLedgerStorage(lifecycleId, this.sqliteStore),
    );
    this.votingLedger = new InMemoryVotingLedger(
      votingLedgerStorage.votingAccountStorage,
      votingLedgerStorage.merkleTreeStorage,
    );

    this.traceStorage = createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
      lifecycleId,
      this.sqliteStore,
    );
    this.proofStorage = createSqliteStakingLedgerToVotingLedgerProofStorage(
      lifecycleId,
      this.sqliteStore,
    );
    this.traceBatchWriter = createSqliteBatchWriter(this.sqliteStore);
    this.proofBatchWriter = createSqliteBatchWriter(this.sqliteStore);

    this.tracer = new StakingLedgerToVotingLedgerTracer(
      this.stakingLedger,
      this.votingLedger,
      this.traceStorage,
      this.traceBatchWriter,
    );
  }

  public async compile(
    options: CompileStakingLedgerToVotingLedgerOptions = {},
  ): Promise<void> {
    const proofsEnabled =
      options.proofsEnabled ?? process.env.PROOFS_ENABLED === "true";
    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: new ReplayableStakingLedger({}),
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    await StakingLedgerToVotingLedger.compile({
      proofsEnabled,
    });
  }

  public async traceDigest(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onTraceComplete?: (
      index: number,
      trace: StakingLedgerToVotingLedgerDigestTrace,
      publicOutput: StakingLedgerToVotingLedgerProgramOutput,
    ) => void,
  ): Promise<void> {
    const tracer = this.getTracer();
    await tracer.digest(startIndex, endIndex, onTraceComplete);
  }

  public async proveDigest(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onDigestComplete?: (
      index: number,
      proof: Proof<
        StakingLedgerToVotingLedgerProgramInput,
        StakingLedgerToVotingLedgerProgramOutput
      >,
    ) => void,
  ): Promise<void> {
    const prover = this.getOrCreateProver();
    await prover.digest(startIndex, endIndex, onDigestComplete);
  }

  public async proveMerge(
    onMergeComplete?: (
      index: number,
      proof: SideLoadedStakingLedgerToVotingLedgerProof,
    ) => void,
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof> {
    const prover = this.getOrCreateProver();
    return await prover.merge(onMergeComplete);
  }

  public async proveExhaust(): Promise<SideLoadedStakingLedgerToVotingLedgerProof> {
    if (!this.stakingLedger || !this.proofStorage) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService.start() must be called before proveExhaust()",
      );
    }
    return await StakingLedgerToVotingLedgerProver.proveExhaust({
      stakingLedger: this.stakingLedger,
      proofStorage: this.proofStorage,
    });
  }

  private getTracer(): StakingLedgerToVotingLedgerTracer {
    if (!this.tracer) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService requires a tracer instance for traceDigest()",
      );
    }
    return this.tracer;
  }

  private getOrCreateProver(): StakingLedgerToVotingLedgerProver {
    if (this.prover) {
      return this.prover;
    }

    if (!this.stakingLedger || !this.traceStorage || !this.proofStorage || !this.proofBatchWriter) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService.start() must be called before proving",
      );
    }

    const { lifecycleId, redisConnection, queueName } = this.options;
    if (!redisConnection) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService requires redisConnection for proveDigest()/proveMerge()",
      );
    }

    if (!this.taskQueue) {
      this.taskQueue = new TaskQueue(
        queueName ?? `staking-ledger-to-voting-ledger-${lifecycleId}`,
        tasks,
        redisConnection,
      ) as StakingLedgerToVotingLedgerTaskQueue;
    }

    this.prover = new StakingLedgerToVotingLedgerProver(
      this.stakingLedger,
      this.traceStorage,
      this.proofStorage,
      this.proofBatchWriter,
      this.taskQueue,
    );

    return this.prover;
  }

  // Number of trace rows written so far. Trace-digest writes exactly one row
  // per index, synchronously, before advancing - so this doubles as the next
  // unwritten index, which is what a checkpoint restore resumes from.
  public async getTracedIndexCount(): Promise<number> {
    if (!this.traceStorage) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService.start() must be called before getTracedIndexCount()",
      );
    }
    return this.traceStorage.count();
  }

  // Forces every WAL-resident commit into the main database file and empties
  // the WAL, so the .sqlite file alone (no accompanying -wal/-shm) is a
  // complete, self-consistent snapshot safe to copy or upload. Needed because
  // applyFastSqlitePragmas() runs in WAL mode: without this, a mid-run copy of
  // the plain .sqlite file can silently miss the most recently committed rows.
  public async checkpointWal(): Promise<void> {
    if (!this.sqliteStore) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService.start() must be called before checkpointWal()",
      );
    }
    await this.sqliteStore.query("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  // Tags the database with the ledger hash it was hydrated against, so a
  // later checkpoint restore can tell a compatible checkpoint from one left
  // over for a lifecycle that has since been re-pointed at a different ledger.
  public async writeCheckpointLedgerHash(ledgerHash: string): Promise<void> {
    await this.ensureCheckpointMetaTable();
    await this.sqliteStore!.query(
      `INSERT INTO checkpoint_meta (key, value) VALUES ('ledgerHash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ledgerHash,
    );
  }

  public async readCheckpointLedgerHash(): Promise<string | undefined> {
    await this.ensureCheckpointMetaTable();
    const rows = (await this.sqliteStore!.query(
      "SELECT value FROM checkpoint_meta WHERE key = 'ledgerHash'",
    )) as { value?: string }[];
    return rows[0]?.value;
  }

  private async ensureCheckpointMetaTable(): Promise<void> {
    if (!this.sqliteStore) {
      throw new Error(
        "SqliteStakingLedgerToVotingLedgerService.start() must be called before touching checkpoint_meta",
      );
    }
    await this.sqliteStore.query(
      "CREATE TABLE IF NOT EXISTS checkpoint_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }

  public async close(): Promise<void> {
    await this.stakingLedger?.close();
    await this.votingLedger?.close();
    await this.traceStorage?.close();
    await this.traceBatchWriter?.close();
    await this.proofStorage?.close();
    await this.proofBatchWriter?.close();
    this.stakingLedger = undefined;
    this.votingLedger = undefined;
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
