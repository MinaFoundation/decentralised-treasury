import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { KeyvSqlite } from "@keyv/sqlite";
import {
  Field,
  LedgerHashBase58,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  TokenId,
  TokenSymbol,
  ZkappUri,
} from "o1js";
import { Account, packToFields, Zkapp } from "../../../src/provable/account.js";
import { accountHashPrefix } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import { LedgerTokenSymbol } from "../../../src/provable/ledger-token-symbol.js";
import { hashLedgerZkappUri } from "../../../src/provable/ledger-zkapp-uri.js";
import {
  ledgerPublicKeyFromBase58,
  publicKeyBase58ToBigInt,
} from "../../../src/utils/public-key.js";
import { ledgerJsonByteStrings } from "../../../src/ledgers/staking-ledger/ledger-json-bytes.js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createInMemoryVotingLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { createSqliteStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { createSqliteBatchWriter } from "../../../src/storage/sqlite/factory/sqlite-batch-writer.js";
import {
  StakingLedgerToVotingLedgerDigestTrace,
  StakingLedgerToVotingLedgerTracer,
} from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { ReplayableStakingLedger } from "../../../src/ledgers/staking-ledger/replayable-staking-ledger.js";
import { ReplayableVotingLedger } from "../../../src/ledgers/voting-ledger/replayable-voting-ledger.js";
import {
  AccountBatch,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";

import { DeterministicByteGenerator } from "../../assurance/fixtures/deterministic.js";

const offCurveKeys = [
  "B62qpyhbvLobnd4Mb52vP7LPFAasb2S6Qphq8h5VV8Sq1m7VNK1VZcW",
  "B62qqdcf6K9HyBSaxqH5JVFJkc1SUEe1VzDc5kYZFQZXWSQyGHoino1",
];
const fixture = JSON.parse(
  await readFile(
    new URL("../../test-ledger-mini.json", import.meta.url),
    "utf8",
  ),
)[0];
const fields = (account: Account) => Account.toFields(account).map(String);
const nativeMina =
  process.env.MINA_BINARY ??
  fileURLToPath(
    new URL(
      "../../../../../../mina/single-node-devnet/bin/mina",
      import.meta.url,
    ),
  );

async function nativeRoot(path: string, directory: string): Promise<string> {
  // Mina's OCaml runtime requires regular files for redirected output on macOS.
  const stdoutPath = join(directory, "mina.stdout");
  const stderrPath = join(directory, "mina.stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(nativeMina, ["ledger", "hash", "--ledger-file", path], {
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  assert.equal(result.status, 0, await readFile(stderrPath, "utf8"));
  const stdout = await readFile(stdoutPath, "utf8");
  return stdout.trim();
}

function makeLedger(sqlite: KeyvSqlite, id = "decode") {
  const storage = createSqliteStakingLedgerStorage(id, sqlite);
  return new PersistentStakingLedger(
    storage.accountStorage,
    storage.merkleTreeStorage,
  );
}

function record(index: number, symbol: Buffer, uri?: Buffer) {
  const pk =
    offCurveKeys[index] ??
    PrivateKey.fromBigInt(BigInt(index + 1))
      .toPublicKey()
      .toBase58();
  const empty = Zkapp.empty();
  return {
    ...structuredClone(fixture),
    pk,
    delegate: pk,
    balance: "66000.000000001",
    token_symbol: symbol,
    ...(uri === undefined
      ? {}
      : {
          zkapp: {
            app_state: empty.appState.map(String),
            action_state: empty.actionState.map(String),
            zkapp_version: "0",
            last_action_slot: 0,
            proved_state: false,
            zkapp_uri: uri,
          },
        }),
  };
}

// Emit byte strings as Mina exports them. Escape JSON syntax and control bytes only.
function rawString(bytes: Buffer) {
  return (
    '"' +
    Array.from(bytes, (byte) =>
      byte < 32 || byte === 34 || byte === 92
        ? `\\u${byte.toString(16).padStart(4, "0")}`
        : String.fromCharCode(byte),
    ).join("") +
    '"'
  );
}
function exportRecords(records: any[]): Buffer {
  return Buffer.from(
    "[" +
      records
        .map((value) =>
          JSON.stringify({
            ...value,
            token_symbol: "SYMBOL_BYTES",
            ...(value.zkapp
              ? { zkapp: { ...value.zkapp, zkapp_uri: "URI_BYTES" } }
              : {}),
          })
            .replace('"SYMBOL_BYTES"', () => rawString(value.token_symbol))
            .replace('"URI_BYTES"', () => rawString(value.zkapp.zkapp_uri)),
        )
        .join(",") +
      "]",
    "latin1",
  );
}

test("compressed keys retain coordinates and reject corrupt encodings", () => {
  for (const key of [
    ...offCurveKeys,
    PublicKey.empty().toBase58(),
    fixture.pk,
  ]) {
    const decoded = ledgerPublicKeyFromBase58(key);
    assert.equal(decoded.toBase58(), key);
    assert.equal(
      publicKeyBase58ToBigInt(key),
      Poseidon.hash(decoded.toFields()).toBigInt(),
    );
  }
  for (const key of offCurveKeys)
    assert.throws(() => PublicKey.fromBase58(key), /group element/);
  for (const key of [
    "",
    "invalid",
    fixture.pk.slice(0, -1) + "0",
    fixture.pk.slice(0, -1) + "1",
  ]) {
    assert.throws(() => ledgerPublicKeyFromBase58(key));
  }
  for (const isOdd of [false, true]) {
    const key = PublicKey.from({ x: Field.ORDER - 1n, isOdd });
    assert.equal(
      ledgerPublicKeyFromBase58(key.toBase58()).x.toBigInt(),
      Field.ORDER - 1n,
    );
  }
});

test("token storage retains all six bytes, reads legacy text, and rejects malformed records", () => {
  for (const bytes of [
    ...Array.from({ length: 256 }, (_, byte) => Buffer.from([byte])),
    Buffer.alloc(0),
    Buffer.from("MINA12"),
    Buffer.from("é"),
    Buffer.from([0xff, 0, 0xed, 0xb0, 0x80, 0]),
  ]) {
    const account = Account.empty();
    account.pk = ledgerPublicKeyFromBase58(offCurveKeys[0]);
    account.delegate = ledgerPublicKeyFromBase58(offCurveKeys[1]);
    account.tokenSymbol = LedgerTokenSymbol.fromBytes(bytes);
    const json = Account.toJSON(account);
    const before = structuredClone(json);
    assert.deepEqual(fields(Account.fromJSON(json)), fields(account));
    assert.deepEqual(json, before);
  }
  for (const symbol of ["", "MINA12", "field:", "é"]) {
    const json = { ...Account.toJSON(Account.empty()), tokenSymbol: symbol };
    assert.equal(
      Account.fromJSON(json).tokenSymbol.field.toString(),
      LedgerTokenSymbol.fromBytes(Buffer.from(symbol)).field.toString(),
    );
  }
  for (const symbol of [
    "field:-1",
    `field:${1n << 48n}`,
    "field:01",
    "1234567",
  ]) {
    assert.throws(() =>
      Account.fromJSON({
        ...Account.toJSON(Account.empty()),
        tokenSymbol: symbol,
      }),
    );
  }
  assert.throws(() => LedgerTokenSymbol.fromBytes(Buffer.alloc(7)));
  assert.throws(() => hashLedgerZkappUri(Buffer.alloc(256)));
  assert.throws(() => LedgerTokenSymbol.fromBytes({} as Uint8Array));
  assert.throws(() => hashLedgerZkappUri({} as Uint8Array));
  const symbol = LedgerTokenSymbol.fromBytes(Buffer.from("MINA12"));
  assert.deepEqual(
    LedgerTokenSymbol.toFields(symbol),
    TokenSymbol.toFields(symbol),
  );
  assert.deepEqual(
    LedgerTokenSymbol.toInput(symbol),
    TokenSymbol.toInput(symbol),
  );
  assert.equal(LedgerTokenSymbol.sizeInFields(), TokenSymbol.sizeInFields());
  for (const mutation of [
    { pk: "invalid" },
    { delegate: "invalid" },
    { balance: (1n << 64n).toString() },
  ]) {
    assert.throws(() =>
      Account.fromJSON({ ...Account.toJSON(Account.empty()), ...mutation }),
    );
  }
  for (const uri of ["a", "https://example.com/é", "\0", "a".repeat(255)]) {
    assert.equal(
      hashLedgerZkappUri(Buffer.from(uri)).toString(),
      ZkappUri.from(uri).hash.toString(),
    );
  }
});

test("byte JSON decoding survives every chunk boundary and Unicode escape form", async () => {
  const input = Buffer.concat([
    Buffer.from('["é","\\u00e9","\\ud83d\\ude00","\\\\u00e9","\\u0000", "'),
    Buffer.from([0xed, 0xb0, 0x80, 0xff]),
    Buffer.from('"]'),
  ]);
  for (let size = 1; size <= input.length; size++) {
    async function* chunks() {
      for (let i = 0; i < input.length; i += size)
        yield input.subarray(i, i + size);
    }
    let output = "";
    for await (const chunk of ledgerJsonByteStrings(chunks())) output += chunk;
    assert.deepEqual(
      JSON.parse(output).map((s: string) => Buffer.from(s, "latin1")),
      [
        Buffer.from("é"),
        Buffer.from("é"),
        Buffer.from("😀"),
        Buffer.from("\\u00e9"),
        Buffer.from([0]),
        Buffer.from([0xed, 0xb0, 0x80, 0xff]),
      ],
    );
  }
  for (const invalid of [
    '"\\ud800"',
    '"\\udc80"',
    '"\\q"',
    '"open',
    '"raw\nline"',
  ]) {
    await assert.rejects(async () => {
      for await (const _ of ledgerJsonByteStrings(
        (async function* () {
          yield Buffer.from(invalid);
        })(),
      )) {
      }
    });
  }
});

test("raw byte accounts survive import, SQLite, trace storage, and constrained circuit replay", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "account-decoding-"));
  const sqlite = new KeyvSqlite({
    uri: `sqlite://${join(directory, "accounts.sqlite")}`,
  });
  const ledger = makeLedger(sqlite);
  const votingStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage("decode", sqlite),
  );
  const voting = new InMemoryVotingLedger(
    votingStorage.votingAccountStorage,
    votingStorage.merkleTreeStorage,
  );
  const traces = createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
    "decode",
    sqlite,
  );
  const batch = createSqliteBatchWriter(sqlite);
  const tracer = new StakingLedgerToVotingLedgerTracer(
    ledger,
    voting,
    traces,
    batch,
  );
  const uriCases = [
    Buffer.alloc(0),
    Buffer.from([0xed, 0xb0, 0x80]),
    Buffer.from([0xff]),
    Buffer.from("é😀"),
    Buffer.from([0]),
    Buffer.from([0xc0, 0x80]),
    Buffer.from("a".repeat(31)),
    Buffer.from("b".repeat(32)),
    Buffer.alloc(255, 0xff),
    Buffer.from('"\\\n'),
  ];
  const records = uriCases.map((uri, index) =>
    record(
      index,
      index % 2 ? Buffer.from([0xff, 0, 0x80, 1, 2, 0]) : Buffer.from("ééé"),
      uri,
    ),
  );
  records.push(record(10, Buffer.alloc(0)));
  records[2].delegate = offCurveKeys[0]; // A valid signer delegates to an off-curve key.
  records[3].token = TokenId.toBase58(Field(42));
  records[3].delegate = undefined;
  records[0].balance = records[1].balance = "66000";
  const bytes = new DeterministicByteGenerator("account-audit-v1", "ledger");
  const uriLengths = [0, 1, 2, 3, 4, 30, 31, 32, 33, 63, 127, 254, 255];
  const permissions = ["none", "either", "proof", "signature", "impossible"];
  for (let index = 11; index < 36; index++) {
    const value = record(
      index,
      Buffer.from(bytes.nextBytes(index % 7)),
      index % 4 === 0
        ? undefined
        : Buffer.from(bytes.nextBytes(uriLengths[index % uriLengths.length])),
    );
    value.balance = ["0", "0.000000001", "1", "1234567.890123456"][index % 4];
    value.nonce = index % 2 ? "4294967295" : String(index);
    if (index % 6 === 0) {
      value.token = TokenId.toBase58(Field(index));
      value.delegate = undefined;
    } else if (index % 3 === 0) {
      value.delegate = offCurveKeys[index % 2];
    }
    if (index % 5 === 0) {
      value.timing = {
        initial_minimum_balance: "0.000000001",
        cliff_time: "4294967295",
        cliff_amount: "0",
        vesting_period: "1",
        vesting_increment: "0.000000001",
      };
    }
    for (const name of Object.keys(value.permissions)) {
      if (name === "set_verification_key") {
        value.permissions[name].auth = permissions[index % permissions.length];
      } else {
        value.permissions[name] = permissions[index % permissions.length];
      }
    }
    if (value.zkapp) {
      value.zkapp.app_state = value.zkapp.app_state.map(
        (_: string, i: number) =>
          (i % 2 ? Field.ORDER - 1n : BigInt(index + i)).toString(),
      );
      value.zkapp.action_state = value.zkapp.action_state.map(
        (_: string, i: number) => BigInt(index + i).toString(),
      );
      value.zkapp.zkapp_version = "4294967295";
      value.zkapp.last_action_slot = 4294967295;
      value.zkapp.proved_state = index % 2 === 0;
    }
    records.push(value);
  }
  records[11].balance = "18446744073.709551615"; // UInt64 maximum; self-delegated.
  records[11].token_symbol = Buffer.alloc(6, 0xff);
  records[13].zkapp.zkapp_uri = Buffer.from(
    Array.from({ length: 255 }, (_, i) => i),
  );
  records[14].delegate = records[16].pk;
  records[16].delegate = records[14].pk; // Delegation cycles use direct targets.
  const path = join(directory, "ledger.json");
  try {
    const exported = exportRecords(records);
    await writeFile(path, exported);
    if (process.env.ACCOUNT_DECODING_ARTIFACT_DIR) {
      await mkdir(process.env.ACCOUNT_DECODING_ARTIFACT_DIR, {
        recursive: true,
      });
      await writeFile(
        join(process.env.ACCOUNT_DECODING_ARTIFACT_DIR, "dummy-ledger.json"),
        exported,
      );
      await writeFile(
        join(
          process.env.ACCOUNT_DECODING_ARTIFACT_DIR,
          "dummy-ledger-manifest.json",
        ),
        JSON.stringify(
          records.map((value, index) => ({
            index,
            ...value,
            token_symbol: { hex: value.token_symbol.toString("hex") },
            ...(value.zkapp
              ? {
                  zkapp: {
                    ...value.zkapp,
                    zkapp_uri: { hex: value.zkapp.zkapp_uri.toString("hex") },
                  },
                }
              : {}),
          })),
          null,
          2,
        ),
      );
    }
    const accounts = await ledger.readStakingLedger(path);
    assert.equal(accounts.length, records.length);
    for (const [index, account] of accounts.entries()) {
      const direct = await ledger.parseStakingLedgerAccount(records[index]);
      assert.deepEqual(fields(account), fields(direct));
      await ledger.setAccount(BigInt(index), account);
      await ledger.setLeaf(BigInt(index), account);
      assert.deepEqual(
        fields(await ledger.getAccount(BigInt(index))),
        fields(account),
      );
    }
    // Captured from native Mina, so CI also checks parity without the binary.
    assert.equal(
      LedgerHashBase58.toBase58(await ledger.getRoot()),
      "jwf6wMnmAYgDBAQNUfLtAGYPTvLLCFcRuMjuvQxgiGGuvxhE62d",
      "captured native root for the deterministic fixture",
    );
    if (existsSync(nativeMina)) {
      const root = await nativeRoot(path, directory);
      assert.equal(
        LedgerHashBase58.toBase58(await ledger.getRoot()),
        root,
        "Mina native ledger root",
      );
      t.diagnostic(`Mina native root: ${root}`);
    } else {
      t.diagnostic(
        "Native Mina root comparison unavailable; set MINA_BINARY to enable it.",
      );
    }
    const expectedOutputs: string[] = [];
    await tracer.digest(0, Infinity, (_index, _trace, output) =>
      expectedOutputs.push(output.votingLedgerRoot.toString()),
    );
    assert.equal(await traces.count(), Math.ceil(accounts.length / 5));
    for (let index = 0; index < expectedOutputs.length; index++) {
      const stored = await traces.getTrace(index);
      const trace = StakingLedgerToVotingLedgerDigestTrace.fromJSON(
        JSON.parse(
          JSON.stringify(StakingLedgerToVotingLedgerDigestTrace.toJSON(stored)),
        ),
      );
      const serialized = JSON.stringify(
        StakingLedgerToVotingLedgerDigestTrace.toJSON(trace),
      );
      const resetContext = () => {
        // Replay consumes witness queues. Each execution needs a fresh copy.
        const replay = StakingLedgerToVotingLedgerDigestTrace.fromJSON(
          JSON.parse(serialized),
        );
        stakingLedgerToVotingLedgerContext.set({
          stakingLedger: new ReplayableStakingLedger(
            replay.stakingLedgerWitnesses,
          ),
          votingLedger: new ReplayableVotingLedger(
            replay.votingLedgerWitnesses,
            replay.votingAccounts,
          ),
        });
      };
      resetContext();
      await Provable.runAndCheck(async () => {
        const witnessed = Provable.witness(
          AccountBatch,
          () => trace.privateInput.accounts,
        );
        const { publicOutput } =
          await StakingLedgerToVotingLedger.rawMethods.digest(
            trace.publicInput,
            witnessed,
          );
        publicOutput.votingLedgerRoot.assertEquals(
          Field(expectedOutputs[index]),
        );
      });
      // A genuine proof is opt-in, after the proof-disabled regression run.
      if (process.env.PROOFS_ENABLED === "true") {
        if (index === 0)
          await StakingLedgerToVotingLedger.compile({ proofsEnabled: true });
        resetContext();
        const { proof } = await StakingLedgerToVotingLedger.digest(
          trace.publicInput,
          trace.privateInput.accounts,
        );
        assert.equal(await StakingLedgerToVotingLedger.verify(proof), true);
        assert.equal(
          proof.publicOutput.votingLedgerRoot.toString(),
          expectedOutputs[index],
        );
      }
    }
    const expectedBalances = new Map<string, bigint>();
    for (const account of accounts) {
      const delegate = account.delegate.toBase58();
      const amount = account.tokenId.equals(TokenId.default).toBoolean()
        ? account.balance.toBigInt()
        : 0n;
      expectedBalances.set(
        delegate,
        (expectedBalances.get(delegate) ?? 0n) + amount,
      );
    }
    for (const [delegate, balance] of expectedBalances) {
      assert.equal(
        (await voting.getVotingAccount(delegate)).balance.toBigInt(),
        balance,
        delegate,
      );
    }
    t.diagnostic(
      `${accounts.length} accounts passed ${expectedOutputs.length} constrained batches; real proofs: ${process.env.PROOFS_ENABLED === "true"}`,
    );
    await assert.rejects(
      ledger.readStakingLedger(join(directory, "missing.json")),
    );
    await writeFile(path, "[{broken]");
    await assert.rejects(ledger.readStakingLedger(path));
    await writeFile(
      path,
      exportRecords([{ ...records[0], balance: "18446744073.709551616" }]),
    );
    await assert.rejects(
      ledger.readStakingLedger(path),
      /UInt64: Expected number/,
    );
    await writeFile(
      path,
      exportRecords([{ ...records[0], token_symbol: Buffer.alloc(7) }]),
    );
    await assert.rejects(
      ledger.readStakingLedger(path),
      /Token symbol exceeds six bytes/,
    );
  } finally {
    await tracer.close();
    await sqlite.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("imports existing ledger snapshots without changing native roots or stored fields", async (t) => {
  const snapshots = [
    new URL("../../test-ledger-mini.json", import.meta.url),
    new URL("../../test-ledger.json", import.meta.url),
    new URL(
      "../../../../../apps/cli/test/fixtures/staking-epoch-ledger-lightnet.json",
      import.meta.url,
    ),
    new URL(
      "../../../../../apps/cli/test/fixtures/staking-epoch-ledger-lightnet-tail.json",
      import.meta.url,
    ),
  ];
  for (const snapshot of snapshots) {
    await t.test(snapshot.pathname.split("/").at(-1), async () => {
      const directory = await mkdtemp(join(tmpdir(), "ledger-snapshot-"));
      const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
      const ledger = makeLedger(sqlite);
      try {
        const accounts = await ledger.readStakingLedger(
          fileURLToPath(snapshot),
        );
        const leaves = [];
        for (const account of accounts) {
          const restored = Account.fromJSON(
            JSON.parse(JSON.stringify(Account.toJSON(account))),
          );
          assert.deepEqual(fields(restored), fields(account));
          leaves.push(
            hashWithPrefix(
              accountHashPrefix,
              packToFields(Account.toHashInput(restored)),
            ),
          );
        }
        await ledger.merkleTree.fill(leaves);
        const root = LedgerHashBase58.toBase58(await ledger.getRoot());
        if (existsSync(nativeMina))
          assert.equal(
            root,
            await nativeRoot(fileURLToPath(snapshot), directory),
          );
        t.diagnostic(
          `${snapshot.pathname.split("/").at(-1)}: ${accounts.length} accounts, root ${root}`,
        );
      } finally {
        await ledger.close();
        await sqlite.disconnect();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
