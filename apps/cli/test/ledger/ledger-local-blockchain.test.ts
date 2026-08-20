import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  openTransportReplayer,
  RecordStore,
} from "@ledgerhq/hw-transport-mocker";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
} from "o1js";
import { MinaApp } from "@zondax/ledger-mina-js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
} from "@repo/sdk/src/signing/ledger-signing.js";
import { MultisigSignature } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { DummyLedgerContract } from "./dummy-ledger-contract.js";

type TestMode = "software" | "mocker" | "device";
const LEDGER_ACCOUNTS = {
  feePayer: 0,
  contract: 1,
} as const;

interface LedgerAccount {
  accountIndex: number;
  publicKey: PublicKey;
}

interface LedgerSession {
  ledger: Pick<MinaApp, "getAddress" | "signFieldElement">;
  feePayer: LedgerAccount;
  contract: LedgerAccount;
  close(): Promise<void>;
}

const mode = (process.env.LEDGER_TEST_MODE ?? "software") as TestMode;
if (!(["software", "mocker", "device"] as const).includes(mode)) {
  throw new Error(`Unknown LEDGER_TEST_MODE: ${mode}`);
}

function uint32Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function bigintBuffer(value: bigint): Buffer {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError("Ledger integer must fit in 32 bytes");
  }
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function commandApdu(instruction: number, p1: number, data: Buffer): Buffer {
  if (data.length > 255) {
    throw new RangeError("Ledger APDU data must fit in one byte");
  }
  return Buffer.concat([
    Buffer.from([0xe0, instruction, p1, 0, data.length]),
    data,
  ]);
}

function softwareLedgerSession(): LedgerSession {
  const privateKeys = new Map<number, PrivateKey>([
    [LEDGER_ACCOUNTS.feePayer, PrivateKey.random()],
    [LEDGER_ACCOUNTS.contract, PrivateKey.random()],
  ]);
  const privateKeyFor = (account: number): PrivateKey => {
    const privateKey = privateKeys.get(account);
    if (!privateKey)
      throw new Error(`Unknown software Ledger account ${account}`);
    return privateKey;
  };
  return {
    feePayer: {
      accountIndex: LEDGER_ACCOUNTS.feePayer,
      publicKey: privateKeyFor(LEDGER_ACCOUNTS.feePayer).toPublicKey(),
    },
    contract: {
      accountIndex: LEDGER_ACCOUNTS.contract,
      publicKey: privateKeyFor(LEDGER_ACCOUNTS.contract).toPublicKey(),
    },
    ledger: {
      async getAddress(account) {
        return {
          returnCode: "9000",
          publicKey: privateKeyFor(account).toPublicKey().toBase58(),
        };
      },
      async signFieldElement(account, networkId, bytes) {
        assert.equal(networkId, 0);
        const value = [...bytes].reduceRight(
          (result, byte) => (result << 8n) + BigInt(byte),
          0n,
        );
        const signature = Signature.create(privateKeyFor(account), [
          Field(value),
        ]).toJSON();
        return {
          returnCode: "9000",
          field: signature.r,
          scalar: signature.s,
        };
      },
    },
    async close() {},
  };
}

async function deviceLedgerSession(): Promise<LedgerSession> {
  console.log(
    "Connect and unlock the Ledger, open the Mina app, and enable blind signing.",
  );
  const require = createRequire(import.meta.url);
  const TransportNodeHid = (
    require("@ledgerhq/hw-transport-node-hid") as {
      default: typeof import("@ledgerhq/hw-transport-node-hid").default;
    }
  ).default;
  const transport = await TransportNodeHid.open(null);
  const ledger = new MinaApp(transport);
  const readAccount = async (accountIndex: number): Promise<LedgerAccount> => {
    const address = await ledger.getAddress(accountIndex, true);
    if (address.returnCode !== "9000" || !address.publicKey) {
      throw new Error(`Could not read Ledger account ${accountIndex}`);
    }
    return {
      accountIndex,
      publicKey: PublicKey.fromBase58(address.publicKey),
    };
  };
  let feePayer: LedgerAccount;
  let contract: LedgerAccount;
  try {
    feePayer = await readAccount(LEDGER_ACCOUNTS.feePayer);
    contract = await readAccount(LEDGER_ACCOUNTS.contract);
  } catch (error) {
    await transport.close();
    throw error;
  }
  assert.notEqual(
    feePayer.publicKey.toBase58(),
    contract.publicKey.toBase58(),
    "Ledger fee-payer and contract accounts must be different",
  );
  console.log(`Ledger fee-payer account: ${feePayer.publicKey.toBase58()}`);
  console.log(`Ledger contract account: ${contract.publicKey.toBase58()}`);
  return {
    ledger,
    feePayer,
    contract,
    async close() {
      await transport.close();
    },
  };
}

async function mockerLedgerSession(): Promise<LedgerSession> {
  const privateKeys = new Map<number, PrivateKey>([
    [LEDGER_ACCOUNTS.feePayer, PrivateKey.random()],
    [LEDGER_ACCOUNTS.contract, PrivateKey.random()],
  ]);
  const privateKeyFor = (account: number): PrivateKey => {
    const privateKey = privateKeys.get(account);
    if (!privateKey) throw new Error(`Unknown mock Ledger account ${account}`);
    return privateKey;
  };
  const records = new RecordStore();
  const transport = await openTransportReplayer(records);
  const app = new MinaApp(transport);

  // This is a small device model around Ledger's strict APDU replayer. The
  // replayer rejects a request if MinaApp emits different bytes.
  const ledger: Pick<MinaApp, "getAddress" | "signFieldElement"> = {
    async getAddress(account, showOnDevice = true) {
      const publicKey = privateKeyFor(account).toPublicKey();
      const data = uint32Buffer(account);
      const request = commandApdu(0x02, showOnDevice ? 0 : 1, data);
      const response = Buffer.concat([
        Buffer.from(publicKey.toBase58(), "ascii"),
        Buffer.from("9000", "hex"),
      ]);
      records.recordExchange(request, response);
      const result = await app.getAddress(account, showOnDevice);
      assert.equal(records.isEmpty(), true, "Address APDU was not consumed");
      return result;
    },
    async signFieldElement(account, networkId, fieldElement) {
      if (!Number.isInteger(networkId) || networkId < 0 || networkId > 255) {
        throw new RangeError("Ledger network ID must fit in one byte");
      }
      const bytes = Buffer.from(fieldElement);
      const request = commandApdu(
        0x06,
        0,
        Buffer.concat([uint32Buffer(account), Buffer.from([networkId]), bytes]),
      );
      const value = [...bytes].reduceRight(
        (result, byte) => (result << 8n) + BigInt(byte),
        0n,
      );
      const signature = Signature.create(privateKeyFor(account), [
        Field(value),
      ]).toJSON();
      const response = Buffer.concat([
        bigintBuffer(BigInt(signature.r)),
        bigintBuffer(BigInt(signature.s)),
        Buffer.from("9000", "hex"),
      ]);
      records.recordExchange(request, response);
      const result = await app.signFieldElement(account, networkId, bytes);
      assert.equal(records.isEmpty(), true, "Signing APDU was not consumed");
      return result;
    },
  };

  return {
    ledger,
    feePayer: {
      accountIndex: LEDGER_ACCOUNTS.feePayer,
      publicKey: privateKeyFor(LEDGER_ACCOUNTS.feePayer).toPublicKey(),
    },
    contract: {
      accountIndex: LEDGER_ACCOUNTS.contract,
      publicKey: privateKeyFor(LEDGER_ACCOUNTS.contract).toPublicKey(),
    },
    async close() {
      await transport.close();
    },
  };
}

async function openLedgerSession(): Promise<LedgerSession> {
  if (mode === "device") return deviceLedgerSession();
  if (mode === "mocker") return mockerLedgerSession();
  return softwareLedgerSession();
}

test(
  `Ledger signs an o1js dummy-contract transaction on LocalBlockchain (${mode})`,
  { timeout: mode === "device" ? 2_400_000 : 30_000 },
  async () => {
    const ledgerSession = await openLedgerSession();
    try {
      const local = await Mina.LocalBlockchain({ proofsEnabled: false });
      Mina.setActiveInstance(local);
      local.addAccount(ledgerSession.feePayer.publicKey, "100000000000");

      const contract = new DummyLedgerContract(
        ledgerSession.contract.publicKey,
      );
      const deployTransaction = await Mina.transaction(
        {
          sender: ledgerSession.feePayer.publicKey,
          fee: UInt64.from(100_000_000),
          memo: "Ledger contract deployment",
        },
        async () => {
          AccountUpdate.fundNewAccount(ledgerSession.feePayer.publicKey);
          await contract.deploy();
        },
      );
      await deployTransaction.prove();
      const signedDeployTransaction = await signTransactionWithLedgerClient(
        deployTransaction,
        ledgerSession.ledger,
      );
      await (await signedDeployTransaction.send()).wait();

      const transaction = await Mina.transaction(
        {
          sender: ledgerSession.feePayer.publicKey,
          fee: UInt64.from(100_000_000),
          memo: "Ledger LocalBlockchain test",
        },
        async () => {
          await contract.increment();
        },
      );
      await transaction.prove();

      const signedTransaction = await signTransactionWithLedgerClient(
        transaction,
        ledgerSession.ledger,
      );
      const pendingTransaction = await signedTransaction.send();
      await pendingTransaction.wait();

      const counter = await contract.counter.fetch();
      assert.equal(counter?.toBigInt(), 1n);

      const breakGlassField = MultisigSignature.dataPauseTreasury(
        UInt32.from(7),
      );
      const breakGlassSignature = await signFieldWithLedgerClient(
        breakGlassField,
        ledgerSession.ledger,
        ledgerSession.feePayer.publicKey,
      );
      assert.equal(
        breakGlassSignature
          .verify(ledgerSession.feePayer.publicKey, [breakGlassField])
          .toBoolean(),
        true,
      );
      console.log(
        `LocalBlockchain accepted Ledger transaction ${pendingTransaction.hash}; counter=${counter?.toString()}; break-glass signature valid`,
      );
    } finally {
      await ledgerSession.close();
    }
  },
);
