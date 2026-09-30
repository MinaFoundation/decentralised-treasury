import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { KeyvSqlite } from "@keyv/sqlite";
import { Bool, Field, PrivateKey, TokenId, UInt64 } from "o1js";
import {
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProof,
} from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import {
  SqliteVoteReducerService,
  getVoteReducerScope,
} from "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
import { VotingAccount } from "@repo/sdk/src/provable/voting-account.js";
import { PersistentVotingLedger } from "@repo/sdk/src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { createSqliteVotingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import voteReducerCommandFactory, {
  traceRunBatch,
} from "../src/commands/vote-reducer.js";

test("validates the remote staking proof before CLI tracing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "vote-proof-input-"));
  const environment = { ...process.env };
  t.after(async () => {
    for (const name of Object.keys(process.env)) {
      if (!(name in environment)) delete process.env[name];
    }
    Object.assign(process.env, environment);
    await rm(directory, { recursive: true, force: true });
  });
  process.env.SQLITE_DATA_DIRECTORY = directory;
  delete process.env.PROOFS_ENABLED; // Verification must default to enabled.
  const lifecycleId = "21";
  const owner = PrivateKey.random().toPublicKey();
  const actions = JSON.parse(
    await readFile(
      new URL("./fixtures/vote-reducer-lightnet-actions.json", import.meta.url),
      "utf8",
    ),
  );
  actions.proposalTokenId = TokenId.toBase58(
    new TreasuryOwnerSmartContract(owner).deriveTokenId(),
  );
  const voteActionsPath = join(directory, "actions.json");
  await writeFile(voteActionsPath, JSON.stringify(actions));
  const stakingLedgerToVotingLedgerProofPath = join(
    directory,
    "staking-proof.json",
  );
  // Decode a real serialized proof, then vary its public fields for guard tests.
  const proofJson = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/staking-ledger-to-voting-ledger-proof-mini-exhaust.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const proof = await StakingLedgerToVotingLedgerProof.fromJSON(proofJson);
  const sqlite = new KeyvSqlite({
    uri: join(directory, `${lifecycleId}.sqlite`),
  });
  const storage = createSqliteVotingLedgerStorage(lifecycleId, sqlite);
  const ledger = new PersistentVotingLedger(
    storage.votingAccountStorage,
    storage.merkleTreeStorage,
  );
  const emptyRoot = await ledger.getRoot();
  const voter = actions.voteActions[0].publicKey;
  const votingAccount = new VotingAccount({ balance: UInt64.from(42) });
  await ledger.setVotingAccount(voter, votingAccount);
  await ledger.setLeaf(voter, votingAccount);
  const votingRoot = await ledger.getRoot();
  assert.notEqual(votingRoot.toString(), emptyRoot.toString());
  await ledger.close();
  await sqlite.disconnect();
  proof.publicInput.index = UInt64.zero;
  proof.publicInput.votingLedgerRoot = emptyRoot;
  proof.publicInput.stakingLedgerRoot = Field(123);
  proof.publicOutput.votingLedgerRoot = votingRoot;
  proof.publicOutput.exhausted = Bool(true);
  const save = () =>
    writeFile(
      stakingLedgerToVotingLedgerProofPath,
      JSON.stringify(proof.toJSON()),
    );
  await save();
  const options = {
    lifecycleId,
    voteActionsPath,
    stakingLedgerToVotingLedgerProofPath,
    treasuryOwnerPublicKey: owner,
    minaNodeUrl: "http://127.0.0.1:1/graphql",
    network: "devnet" as const,
  };
  let proposalLifecycle = lifecycleId;
  let snapshot = "123";
  const proposalRead = t.mock.method(
    SqliteTreasuryOwnerService.prototype,
    "getProposalState",
    async () => ({
      lifecycleId: proposalLifecycle,
      stakingEpochDataLedgerHash: snapshot,
    }),
  );
  const calls: string[] = [];
  // Keep actual decoding, SQLite, root checks and command handling. Stub only
  // the live chain read, expensive cryptography, and final tracing operation.
  const compile = t.mock.method(
    StakingLedgerToVotingLedger,
    "compile",
    async (args) => {
      assert.equal(args.proofsEnabled, true);
      calls.push("compile");
    },
  );
  let valid = true;
  const verify = t.mock.method(
    StakingLedgerToVotingLedger,
    "verify",
    async (input) => {
      assert.equal(input.publicInput.stakingLedgerRoot.toString(), "123");
      calls.push("verify");
      return valid;
    },
  );
  const trace = t.mock.method(
    SqliteVoteReducerService.prototype,
    "traceRunBatch",
    async () => {
      calls.push("trace");
    },
  );
  const close = t.mock.method(SqliteVoteReducerService.prototype, "close");

  const rejectsBeforeTrace = async (pattern: RegExp) => {
    const before = trace.mock.callCount();
    await assert.rejects(traceRunBatch(options), pattern);
    assert.equal(trace.mock.callCount(), before);
    const db = new KeyvSqlite({
      uri: join(directory, `${lifecycleId}.sqlite`),
    });
    const traces = createSqliteVoteReducerRunBatchTraceStorage(
      getVoteReducerScope({ lifecycleId, ...actions }),
      db,
    );
    assert.equal(await traces.getTrace(0), undefined);
    await traces.close();
    await db.disconnect();
  };
  await t.test("verifies before tracing and closes the service", async () => {
    await traceRunBatch(options);
    assert.deepEqual(calls, ["compile", "verify", "trace"]);
    assert.equal(close.mock.callCount(), 1);
    assert.equal(
      proposalRead.mock.calls[0].arguments[0].proposalPublicKey.toBase58(),
      actions.proposalPublicKey,
    );
  });
  await t.test(
    "rejects partial proofs, wrong snapshots, and wrong voting roots",
    async () => {
      proof.publicOutput.exhausted = Bool(false);
      await save();
      await rejectsBeforeTrace(/must be exhausted/);
      proof.publicOutput.exhausted = Bool(true);
      proof.publicInput.index = UInt64.from(5);
      await save();
      await rejectsBeforeTrace(/start at index 0/);
      proof.publicInput.index = UInt64.zero;
      proof.publicInput.votingLedgerRoot = Field(1);
      await save();
      await rejectsBeforeTrace(/empty voting ledger/);
      proof.publicInput.votingLedgerRoot = emptyRoot;
      proof.publicOutput.votingLedgerRoot = Field(2);
      await save();
      await rejectsBeforeTrace(/local voting ledger root/);
      proof.publicOutput.votingLedgerRoot = votingRoot;
      await save();
      snapshot = "456";
      await rejectsBeforeTrace(/Proposal snapshot/);
      snapshot = "123";
      proposalLifecycle = "22";
      await rejectsBeforeTrace(/lifecycle does not match/);
      proposalLifecycle = lifecycleId;
      assert.equal(compile.mock.callCount(), 1);
    },
  );
  await t.test(
    "rejects failed cryptography and still closes the service",
    async () => {
      valid = false;
      const before = close.mock.callCount();
      await rejectsBeforeTrace(/cryptographic verification/);
      assert.equal(close.mock.callCount(), before + 1);
      valid = true;
    },
  );
  await t.test(
    "rejects absent, malformed, and undecodable proof files",
    async () => {
      await rm(stakingLedgerToVotingLedgerProofPath);
      await rejectsBeforeTrace(/ENOENT/);
      await writeFile(stakingLedgerToVotingLedgerProofPath, "{");
      await rejectsBeforeTrace(/JSON/);
      await writeFile(stakingLedgerToVotingLedgerProofPath, "{}");
      await rejectsBeforeTrace(/./);
      await save();
    },
  );
  await t.test(
    "rejects an actions file from a different Treasury Owner",
    async () => {
      await writeFile(
        voteActionsPath,
        JSON.stringify({ ...actions, proposalTokenId: "1" }),
      );
      await rejectsBeforeTrace(/token does not match/);
      await writeFile(voteActionsPath, JSON.stringify(actions));
    },
  );
  await t.test(
    "only explicit false skips cryptography, and retains root checks",
    async () => {
      process.env.PROOFS_ENABLED = "false";
      const before = verify.mock.callCount();
      await traceRunBatch(options);
      assert.equal(verify.mock.callCount(), before);
      proof.publicOutput.votingLedgerRoot = Field(3);
      await save();
      await rejectsBeforeTrace(/local voting ledger root/);
      proof.publicOutput.votingLedgerRoot = votingRoot;
      await save();
      delete process.env.PROOFS_ENABLED;
    },
  );
  await t.test(
    "requires a proof path and accepts the downloaded environment settings",
    async () => {
      const program = () => {
        const command = new Command()
          .exitOverride()
          .configureOutput({ writeErr: () => {} });
        voteReducerCommandFactory(command);
        return command;
      };
      delete process.env.STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH;
      const args = [
        "vote-reducer",
        "trace-run-batch",
        "--lifecycle-id",
        lifecycleId,
        "--vote-actions-path",
        voteActionsPath,
      ];
      await assert.rejects(
        program().parseAsync(args, { from: "user" }),
        /staking-ledger-to-voting-ledger-proof-path/,
      );
      Object.assign(process.env, {
        LIFECYCLE_ID: lifecycleId,
        VOTE_ACTIONS_PATH: voteActionsPath,
        STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH:
          stakingLedgerToVotingLedgerProofPath,
        TREASURY_OWNER_PUBLIC_KEY: owner.toBase58(),
        MINA_NODE_URL: options.minaNodeUrl,
        NETWORK: options.network,
      });
      const before = trace.mock.callCount();
      await program().parseAsync(["vote-reducer", "trace-run-batch"], {
        from: "user",
      });
      assert.equal(trace.mock.callCount(), before + 1);
      // The explicit option overrides the environment value.
      await assert.rejects(
        program().parseAsync(
          [
            "vote-reducer",
            "trace-run-batch",
            "--staking-ledger-to-voting-ledger-proof-path",
            join(directory, "absent.json"),
          ],
          { from: "user" },
        ),
        /ENOENT/,
      );
    },
  );
  await t.test("records traces with the validated voting root", async () => {
    trace.mock.restore();
    await traceRunBatch(options);
    const db = new KeyvSqlite({
      uri: join(directory, `${lifecycleId}.sqlite`),
    });
    const traces = createSqliteVoteReducerRunBatchTraceStorage(
      getVoteReducerScope({ lifecycleId, ...actions }),
      db,
    );
    const recorded = await traces.getTrace(0);
    assert(recorded);
    assert.equal(
      recorded.publicInput.votingLedgerRoot.toString(),
      votingRoot.toString(),
    );
    await traces.close();
    await db.disconnect();
  });
});
