import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  Bool,
  Field,
  LedgerHashBase58,
  PrivateKey,
  PublicKey,
  TokenId,
} from "o1js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { downloadTallyInputs } from "../src/commands/proposal-tally-download.js";

test("downloads complete tally inputs and refuses incomplete or mismatched data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tally-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/staking-epoch-ledger-lightnet.json", import.meta.url),
      "utf8",
    ),
  );
  const owner = PublicKey.fromBase58(fixture[0].pk);
  const createSnapshot = async (accounts: unknown[], name: string) => {
    const snapshotPath = join(root, `${name}.json`);
    const dbPath = join(root, `${name}.sqlite`);
    await writeFile(snapshotPath, JSON.stringify(accounts));
    const source = new SqliteStakingLedgerService({
      lifecycleId: "21",
      dbPath,
    });
    await source.start();
    try {
      await source.hydrateAccounts({
        stakingLedgerPath: snapshotPath,
        startIndex: 0,
        endIndex: accounts.length - 1,
      });
      await source.hydrateMerkleTree({
        startIndex: 0,
        endIndex: accounts.length - 1,
      });
      return { root: await source.getRootHash(), dbPath };
    } finally {
      await source.close();
    }
  };
  // The native Owner must be selected even when a zero-balance custom token comes first.
  const customOwner = {
    ...fixture[0],
    token: TokenId.toBase58(Field(2)),
    balance: "0",
  };
  const snapshot = await createSnapshot([customOwner, fixture[0]], "source");
  const ledgerRoot = snapshot.root;
  let database = await readFile(snapshot.dbPath);
  let expectedRoot = ledgerRoot;
  let exhausted = true;
  let proofRoot = ledgerRoot;
  let badMarker = false;
  let corruptDatabase = false;
  let missingPath = "";
  let truncated = false;
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === missingPath) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.url!.endsWith(".done")) {
      res.end(
        JSON.stringify({
          lifecycleId: badMarker ? "99" : "21",
          ledgerHash: LedgerHashBase58.toBase58(expectedRoot),
        }),
      );
    } else if (req.url!.endsWith(".proven")) {
      res.end(
        JSON.stringify({
          lifecycleId: "21",
          exhaustedProofPath: "/backend/path/not-a-local-path",
        }),
      );
    } else if (req.url!.endsWith("-exhausted.json")) {
      res.end(JSON.stringify({ proof: "test-proof" }));
    } else if (req.url!.endsWith(".sqlite")) {
      if (truncated) {
        res.writeHead(200, { "content-length": database.length + 100 });
        res.write(database.subarray(0, 10));
        res.destroy();
      } else {
        res.end(corruptDatabase ? Buffer.from("not a database") : database);
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  // No network transaction or proof generation: only Proposal state and proof decoding are stubbed.
  t.mock.method(
    SqliteTreasuryOwnerService.prototype,
    "getProposalState",
    async () => ({
      lifecycleId: "21",
      stakingEpochDataLedgerHash: expectedRoot.toString(),
    }),
  );
  t.mock.method(
    SideLoadedStakingLedgerToVotingLedgerProof,
    "fromJSON",
    async () => ({
      publicInput: { stakingLedgerRoot: proofRoot },
      publicOutput: { exhausted: Bool(exhausted) },
    }),
  );
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const options = {
    backendUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/treasury/`,
    minaNodeUrl: "http://127.0.0.1:1/graphql",
    network: "devnet" as const,
    treasuryOwnerPublicKey: owner,
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    outputDirectory: join(root, "download # $(echo unsafe) $HOME"),
  };

  await t.test(
    "streams SQLite, preserves URL prefix, and writes safe absolute settings",
    async () => {
      const result = await downloadTallyInputs(options);
      assert.equal(result.lifecycleId, "21");
      assert.deepEqual(requests, [
        "/treasury/sqlite/21.sqlite.done",
        "/treasury/sqlite/21.sqlite.proven",
        "/treasury/proofs/21-exhausted.json",
        "/treasury/sqlite/21.sqlite",
      ]);
      assert.equal(
        (await readFile(result.sqlitePath)).subarray(0, 16).toString(),
        "SQLite format 3\0",
      );
      const loaded = JSON.parse(
        execFileSync(
          "dotenvx",
          [
            "run",
            "--quiet",
            "--strict",
            "-f",
            result.settingsPath,
            "--",
            "node",
            "-e",
            "console.log(JSON.stringify(process.env))",
          ],
          {
            encoding: "utf8",
            env: { ...process.env, PROOFS_ENABLED: undefined },
          },
        ),
      );
      assert.equal(loaded.SQLITE_DATA_DIRECTORY, options.outputDirectory);
      assert.equal(loaded.LIFECYCLE_ID, "21");
      assert.equal(
        loaded.STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH,
        result.stakingProofPath,
      );
      assert.equal(loaded.PROOFS_ENABLED, "true");
      assert.equal(
        loaded.PROPOSAL_PUBLIC_KEY,
        options.proposalPublicKey.toBase58(),
      );
      assert.equal(
        loaded.VOTE_ACTIONS_PATH,
        join(options.outputDirectory, "vote-actions.json"),
      );
      assert.equal(
        (await readdir(options.outputDirectory)).includes(
          "vote-reducer-merge.json",
        ),
        false,
      );
    },
  );
  await t.test("never overwrites existing inputs", async () => {
    const settings = await readFile(join(options.outputDirectory, ".env"));
    await assert.rejects(downloadTallyInputs(options), /EEXIST/);
    assert.deepEqual(
      await readFile(join(options.outputDirectory, ".env")),
      settings,
    );
  });

  const failure = async (name: string, pattern?: RegExp) => {
    const outputDirectory = join(root, name);
    await assert.rejects(
      downloadTallyInputs({ ...options, outputDirectory }),
      pattern,
    );
    await assert.rejects(readFile(join(outputDirectory, ".env")), /ENOENT/);
    assert.equal((await readdir(root)).includes(name), false);
  };
  await t.test(
    "missing publication, wrong markers, and non-exhausted proofs fail closed",
    async () => {
      missingPath = "/treasury/sqlite/21.sqlite.proven";
      await failure("missing", /HTTP 404/);
      missingPath = "";
      badMarker = true;
      await failure("marker", /Lifecycle mismatch/);
      badMarker = false;
      exhausted = false;
      await failure("not-exhausted", /must be exhausted/);
      exhausted = true;
      proofRoot = Field(1);
      await failure("wrong-proof-root", /match the Proposal snapshot/);
      proofRoot = ledgerRoot;
    },
  );
  await t.test(
    "corrupt, truncated, or mismatched databases leave no usable output",
    async () => {
      corruptDatabase = true;
      await failure("corrupt");
      corruptDatabase = false;
      truncated = true;
      await failure("truncated");
      truncated = false;
      expectedRoot = proofRoot = Field(1);
      await failure("wrong-database-root", /database does not match/);
      expectedRoot = proofRoot = ledgerRoot;
    },
  );
  await t.test(
    "values that cannot be stored literally in dotenv fail closed",
    async () => {
      await failure("single'quote", /Dotenv settings cannot contain/);
      await failure("line\nbreak", /Dotenv settings cannot contain/);
    },
  );
  await t.test("a missing historical Owner is rejected", async () => {
    await assert.rejects(
      downloadTallyInputs({
        ...options,
        outputDirectory: join(root, "missing-owner"),
        treasuryOwnerPublicKey: PrivateKey.random().toPublicKey(),
      }),
      /Treasury Owner account with a nonzero balance/,
    );
  });
  await t.test("a positive custom-token Owner alone is rejected", async () => {
    const customOnly = await createSnapshot(
      [{ ...customOwner, balance: "1" }],
      "custom-only-source",
    );
    database = await readFile(customOnly.dbPath);
    expectedRoot = proofRoot = customOnly.root;
    try {
      await failure("custom-only", /default-token Treasury Owner account/);
    } finally {
      database = await readFile(snapshot.dbPath);
      expectedRoot = proofRoot = ledgerRoot;
    }
  });
  await t.test("unsupported URLs are rejected before downloading", async () => {
    await assert.rejects(
      downloadTallyInputs({ ...options, backendUrl: "file:///tmp" }),
      /HTTP or HTTPS/,
    );
  });
});
