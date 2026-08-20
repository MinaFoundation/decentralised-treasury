import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import {
  Field,
  LedgerHashBase58,
  Provable,
  PublicKey,
  ReceiptChainHashBase58,
  StateHashBase58,
  TokenId,
  UInt64,
} from "o1js";
import { Account, packToFields } from "@repo/sdk/src/provable/account.js";
import {
  accountHashPrefix,
  BaseStakingLedger,
} from "@repo/sdk/src/ledgers/staking-ledger/staking-ledger.js";
import { BaseVotingLedger } from "@repo/sdk/src/ledgers/voting-ledger/voting-ledger.js";
import type { MerkleTreeStorage } from "@repo/sdk/src/storage/merkle-tree-storage.js";
import { hashWithPrefix } from "@repo/sdk/src/provable/hashing-helpers.js";
import { VotingAccount } from "@repo/sdk/src/provable/voting-account.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { parseIntOption } from "./option-parsers.js";

const NANOMINA_PER_MINA = 1_000_000_000n;
const MAX_ACCOUNT_COUNT = 100_000;
const DEFAULT_ZKAPP_PERCENTAGE = 50;
const DEFAULT_TOKEN_ID = TokenId.toBase58(TokenId.default);
const PERMISSION_VALUES = [
  "none",
  "either",
  "proof",
  "signature",
  "impossible",
] as const;
const SIBLING_MINA_BINARY = fileURLToPath(
  new URL("../../../../../mina/single-node-devnet/bin/mina", import.meta.url),
);

export interface MinaTestLedgerAccount {
  pk: string;
  balance: string;
  sk?: string;
  delegate?: string;
  token?: string;
  token_symbol?: string;
  nonce?: string;
  receipt_chain_hash?: string;
  voting_for?: string;
  timing?: {
    initial_minimum_balance: string;
    cliff_time: string;
    cliff_amount: string;
    vesting_period: string;
    vesting_increment: string;
  };
  permissions?: MinaTestLedgerPermissions;
  zkapp?: MinaTestZkappAccount;
}

export interface MinaTestLedgerPermissions {
  edit_state: string;
  send: string;
  receive: string;
  access: string;
  set_delegate: string;
  set_permissions: string;
  set_verification_key: { auth: string; txn_version: string };
  set_zkapp_uri: string;
  edit_action_state: string;
  set_token_symbol: string;
  increment_nonce: string;
  set_voting_for: string;
  set_timing: string;
}

export interface MinaTestZkappAccount {
  app_state: string[];
  verification_key: null | { data: string; hash: string };
  zkapp_version: string;
  action_state: string[];
  last_action_slot: number;
  proved_state: boolean;
  zkapp_uri: string;
}

export interface MinaLedgerParityResult {
  accountCount: number;
  minaRoot: string;
  o1jsRoot: string;
  matches: boolean;
  seed: string;
  zkappCount: number;
  timedAccountCount: number;
  customTokenCount: number;
  circuit?: StakingToVotingCircuitResult;
  ledgerPath?: string;
}

export interface StakingToVotingCircuitResult {
  mode: "raw-circuit-method-no-proofs";
  proofsEnabled: false;
  batchCount: number;
  ocamlStakingRoot: string;
  inputStakingRoot: string;
  stakingRootMatches: true;
  circuitVotingRoot: string;
  expectedVotingRoot: string;
  votingRootMatches: boolean;
  exhaustionIndex: number;
  exhaustionCheckPassed: boolean;
  matches: boolean;
}

class EntropySource {
  private counter = 0;

  public constructor(private readonly seed: string) {}

  private digest(label: string): Buffer {
    return createHash("sha256")
      .update(this.seed)
      .update("\0")
      .update(label)
      .update("\0")
      .update(String(this.counter++))
      .digest();
  }

  public uint32(label: string): number {
    return this.digest(label).readUInt32BE(0);
  }

  public boolean(label: string, percentage = 50): boolean {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;
    return this.uint32(label) % 100 < percentage;
  }

  public field(label: string): Field {
    return Field(BigInt(`0x${this.digest(label).toString("hex")}`));
  }

  public bigintBelow(label: string, upperExclusive: bigint): bigint {
    if (upperExclusive <= 1n) return 0n;
    return BigInt(`0x${this.digest(label).toString("hex")}`) % upperExclusive;
  }

  public choice<T>(label: string, values: readonly T[]): T {
    return values[this.uint32(label) % values.length];
  }
}

class MemoryMerkleTreeStorage implements MerkleTreeStorage {
  public readonly namespace = "mina-ledger-parity";
  private readonly nodes = new Map<string, import("o1js").Field>();

  public async getNode(level: number, index: bigint) {
    return this.nodes.get(`${level}-${index}`);
  }

  public async setNode(
    level: number,
    index: bigint,
    value: import("o1js").Field,
  ): Promise<void> {
    this.nodes.set(`${level}-${index}`, value);
  }

  public async clear(): Promise<void> {
    this.nodes.clear();
  }

  public async close(): Promise<void> {
    this.nodes.clear();
  }
}

class TestStakingLedger extends BaseStakingLedger {
  private readonly accounts = new Map<bigint, Account>();

  public async getAllAccounts(): Promise<Account[]> {
    return Array.from(this.accounts.entries())
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, account]) => account);
  }

  public async accountCount(): Promise<number> {
    return this.accounts.size;
  }

  public async getAccount(index: bigint): Promise<Account> {
    return this.accounts.get(index) ?? Account.empty();
  }

  public async setAccount(index: bigint, account: Account): Promise<void> {
    this.accounts.set(index, account);
  }

  public async close(): Promise<void> {
    await this.merkleTreeStorage.close();
  }
}

class TestVotingLedger extends BaseVotingLedger {
  private readonly accounts = new Map<string, VotingAccount>();

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    return this.accounts.get(publicKey) ?? VotingAccount.empty();
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount,
  ): Promise<void> {
    this.accounts.set(publicKey, votingAccount);
  }

  public async close(): Promise<void> {
    this.accounts.clear();
    await this.merkleTreeStorage.close();
  }
}

function parseMinaToNanomina(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid MINA balance: ${value}`);
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  return whole * NANOMINA_PER_MINA + fractional;
}

function formatNanomina(value: bigint): string {
  const whole = value / NANOMINA_PER_MINA;
  const fractional = (value % NANOMINA_PER_MINA).toString().padStart(9, "0");
  return `${whole}.${fractional}`;
}

function randomPermissions(
  entropy: EntropySource,
  accountIndex: number,
): MinaTestLedgerPermissions {
  const permission = (name: string) =>
    entropy.choice(
      `account-${accountIndex}-permission-${name}`,
      PERMISSION_VALUES,
    );

  return {
    edit_state: permission("edit-state"),
    send: permission("send"),
    receive: permission("receive"),
    access: permission("access"),
    set_delegate: permission("set-delegate"),
    set_permissions: permission("set-permissions"),
    set_verification_key: {
      auth: permission("set-verification-key"),
      txn_version: "4",
    },
    set_zkapp_uri: permission("set-zkapp-uri"),
    edit_action_state: permission("edit-action-state"),
    set_token_symbol: permission("set-token-symbol"),
    increment_nonce: permission("increment-nonce"),
    set_voting_for: permission("set-voting-for"),
    set_timing: permission("set-timing"),
  };
}

function randomZkapp(
  entropy: EntropySource,
  accountIndex: number,
  seedId: string,
): MinaTestZkappAccount {
  return {
    app_state: Array.from({ length: 32 }, (_, stateIndex) =>
      entropy
        .field(`account-${accountIndex}-app-state-${stateIndex}`)
        .toString(),
    ),
    verification_key: null,
    zkapp_version: String(
      entropy.uint32(`account-${accountIndex}-zkapp-version`),
    ),
    action_state: Array.from({ length: 5 }, (_, stateIndex) =>
      entropy
        .field(`account-${accountIndex}-action-state-${stateIndex}`)
        .toString(),
    ),
    last_action_slot: entropy.uint32(
      `account-${accountIndex}-last-action-slot`,
    ),
    proved_state: entropy.boolean(`account-${accountIndex}-proved-state`),
    zkapp_uri: `https://ledger-parity.test/${seedId}/${accountIndex}/${entropy
      .field(`account-${accountIndex}-zkapp-uri`)
      .toBigInt()
      .toString(16)}`,
  };
}

export function enrichGeneratedAccounts(
  generatedAccounts: MinaTestLedgerAccount[],
  {
    seed,
    zkappPercentage,
  }: {
    seed: string;
    zkappPercentage: number;
  },
): {
  accounts: MinaTestLedgerAccount[];
  zkappCount: number;
  timedAccountCount: number;
  customTokenCount: number;
} {
  if (
    !Number.isInteger(zkappPercentage) ||
    zkappPercentage < 0 ||
    zkappPercentage > 100
  ) {
    throw new Error("zkappPercentage must be an integer from 0 through 100");
  }

  const entropy = new EntropySource(seed);
  const seedId = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  let zkappCount = 0;
  let timedAccountCount = 0;
  let customTokenCount = 0;

  const accounts = generatedAccounts.map((generatedAccount, accountIndex) => {
    const balance = parseMinaToNanomina(generatedAccount.balance);
    const isCustomToken = entropy.boolean(
      `account-${accountIndex}-custom-token`,
      10,
    );
    const isTimed = entropy.boolean(`account-${accountIndex}-timed`, 25);
    const isZkapp = entropy.boolean(
      `account-${accountIndex}-zkapp`,
      zkappPercentage,
    );
    const token = isCustomToken
      ? TokenId.toBase58(entropy.field(`account-${accountIndex}-token-id`))
      : DEFAULT_TOKEN_ID;
    const delegate = isCustomToken
      ? undefined
      : (generatedAccounts[
          entropy.uint32(`account-${accountIndex}-delegate`) %
            generatedAccounts.length
        ]?.pk ?? generatedAccount.pk);
    const initialMinimumBalance = entropy.bigintBelow(
      `account-${accountIndex}-initial-minimum-balance`,
      balance + 1n,
    );
    const cliffAmount = entropy.bigintBelow(
      `account-${accountIndex}-cliff-amount`,
      initialMinimumBalance + 1n,
    );
    const vestingIncrement = entropy.bigintBelow(
      `account-${accountIndex}-vesting-increment`,
      initialMinimumBalance - cliffAmount + 1n,
    );

    if (isCustomToken) customTokenCount++;
    if (isTimed) timedAccountCount++;
    if (isZkapp) zkappCount++;

    return {
      ...generatedAccount,
      delegate,
      token,
      token_symbol: Array.from({ length: 6 }, (_, symbolIndex) =>
        String.fromCharCode(
          65 +
            (entropy.uint32(
              `account-${accountIndex}-token-symbol-${symbolIndex}`,
            ) %
              26),
        ),
      ).join(""),
      nonce: String(entropy.uint32(`account-${accountIndex}-nonce`)),
      receipt_chain_hash: ReceiptChainHashBase58.toBase58(
        entropy.field(`account-${accountIndex}-receipt-chain-hash`),
      ),
      voting_for: StateHashBase58.toBase58(
        entropy.field(`account-${accountIndex}-voting-for`),
      ),
      timing: isTimed
        ? {
            initial_minimum_balance: formatNanomina(initialMinimumBalance),
            cliff_time: String(
              entropy.uint32(`account-${accountIndex}-cliff-time`),
            ),
            cliff_amount: formatNanomina(cliffAmount),
            vesting_period: String(
              1 +
                (entropy.uint32(`account-${accountIndex}-vesting-period`) %
                  0xffff_ffff),
            ),
            vesting_increment: formatNanomina(vestingIncrement),
          }
        : undefined,
      permissions: randomPermissions(entropy, accountIndex),
      zkapp: isZkapp ? randomZkapp(entropy, accountIndex, seedId) : undefined,
    };
  });

  return { accounts, zkappCount, timedAccountCount, customTokenCount };
}

function parseGeneratedAccounts(json: string): MinaTestLedgerAccount[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    throw new Error("The Mina account generator did not return a JSON array");
  }

  return value.map((account, index) => {
    if (
      typeof account !== "object" ||
      account === null ||
      !("pk" in account) ||
      !("balance" in account) ||
      typeof account.pk !== "string" ||
      typeof account.balance !== "string"
    ) {
      throw new Error(
        `The Mina account at index ${index} has an invalid shape`,
      );
    }
    return account as MinaTestLedgerAccount;
  });
}

async function createO1jsStakingLedger(
  accounts: MinaTestLedgerAccount[],
): Promise<{ ledger: TestStakingLedger; accounts: Account[] }> {
  const ledger = new TestStakingLedger(new MemoryMerkleTreeStorage());
  const parsedAccounts: Account[] = [];
  const leaves: Field[] = [];

  for (const [index, generatedAccount] of accounts.entries()) {
    let account: Account;
    if (generatedAccount.permissions) {
      account = await ledger.parseStakingLedgerAccount(generatedAccount);
    } else {
      const publicKey = PublicKey.fromBase58(generatedAccount.pk);
      account = Account.empty();

      // Mina's test generator uses Account.create. For the default token,
      // Account.create delegates to the account's own public key.
      account.pk = publicKey;
      account.delegate = publicKey;
      account.balance = UInt64.from(
        parseMinaToNanomina(generatedAccount.balance),
      );
    }

    parsedAccounts[index] = account;
    await ledger.setAccount(BigInt(index), account);
    leaves[index] = hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(account)),
    );
  }

  await ledger.merkleTree.fill(leaves);
  return { ledger, accounts: parsedAccounts };
}

export async function computeO1jsLedgerRoot(
  accounts: MinaTestLedgerAccount[],
): Promise<string> {
  const { ledger } = await createO1jsStakingLedger(accounts);

  try {
    return LedgerHashBase58.toBase58(await ledger.getRoot());
  } finally {
    await ledger.close();
  }
}

async function computeExpectedVotingRoot(accounts: Account[]): Promise<Field> {
  const balancesByDelegate = new Map<string, bigint>();
  for (const account of accounts) {
    const delegate = account.delegate.toBase58();
    balancesByDelegate.set(
      delegate,
      (balancesByDelegate.get(delegate) ?? 0n) + account.balance.toBigInt(),
    );
  }

  const ledger = new TestVotingLedger(new MemoryMerkleTreeStorage());
  try {
    for (const [delegate, balance] of balancesByDelegate) {
      const votingAccount = new VotingAccount({
        balance: UInt64.from(balance),
      });
      await ledger.setVotingAccount(delegate, votingAccount);
      await ledger.setLeaf(delegate, votingAccount);
    }
    return await ledger.getRoot();
  } finally {
    await ledger.close();
  }
}

export async function checkStakingToVotingCircuit(
  inputAccounts: MinaTestLedgerAccount[],
  ocamlStakingRoot: string,
): Promise<StakingToVotingCircuitResult> {
  const { ledger: stakingLedger, accounts } =
    await createO1jsStakingLedger(inputAccounts);
  const votingLedger = new TestVotingLedger(new MemoryMerkleTreeStorage());

  try {
    stakingLedgerToVotingLedgerContext.set({ stakingLedger, votingLedger });
    const stakingLedgerRoot = await stakingLedger.getRoot();
    const inputStakingRoot = LedgerHashBase58.toBase58(stakingLedgerRoot);
    if (inputStakingRoot !== ocamlStakingRoot) {
      throw new Error(
        `The o1js staking root ${inputStakingRoot} does not match the OCaml staking root ${ocamlStakingRoot}`,
      );
    }
    let votingLedgerRoot = await votingLedger.getRoot();
    const batchCount = Math.ceil(accounts.length / ACCOUNT_BATCH_SIZE);
    const expectedVotingRoot = await computeExpectedVotingRoot(accounts);
    let votingRootValue = votingLedgerRoot.toBigInt();

    if (batchCount > 0) {
      await Provable.runAndCheck(async () => {
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
          const index = batchIndex * ACCOUNT_BATCH_SIZE;
          const accountBatch = Array.from(
            { length: ACCOUNT_BATCH_SIZE },
            (_, offset) => accounts[index + offset] ?? Account.empty(),
          );
          const { publicOutput } =
            await StakingLedgerToVotingLedger.rawMethods.digest(
              {
                index: UInt64.from(index),
                stakingLedgerRoot,
                votingLedgerRoot,
              },
              accountBatch,
            );
          votingLedgerRoot = publicOutput.votingLedgerRoot;
        }

        votingLedgerRoot.assertEquals(await votingLedger.getRoot());
        votingLedgerRoot.assertEquals(expectedVotingRoot);
        Provable.asProver(() => {
          votingRootValue = votingLedgerRoot.toBigInt();
        });
      });
    }

    const exhaustionIndex = batchCount * ACCOUNT_BATCH_SIZE;
    const exhaustionWitness = await stakingLedger.getWitness(
      BigInt(exhaustionIndex),
    );
    const emptyAccountLeaf = hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(Account.empty())),
    );
    const exhaustionCheckPassed = exhaustionWitness
      .calculateRoot(emptyAccountLeaf, stakingLedger.merkleTree.hashPrefixes)
      .equals(stakingLedgerRoot)
      .toBoolean();
    const votingRootMatches = votingRootValue === expectedVotingRoot.toBigInt();

    return {
      mode: "raw-circuit-method-no-proofs",
      proofsEnabled: false,
      batchCount,
      ocamlStakingRoot,
      inputStakingRoot,
      stakingRootMatches: true,
      circuitVotingRoot: votingRootValue.toString(),
      expectedVotingRoot: expectedVotingRoot.toString(),
      votingRootMatches,
      exhaustionIndex,
      exhaustionCheckPassed,
      matches: votingRootMatches && exhaustionCheckPassed,
    };
  } finally {
    await votingLedger.close();
    await stakingLedger.close();
  }
}

async function isAccessible(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveMinaBinary(explicitPath?: string): Promise<string> {
  if (explicitPath) return resolve(explicitPath);
  if (process.env.MINA_BINARY) return resolve(process.env.MINA_BINARY);

  if (await isAccessible(SIBLING_MINA_BINARY)) return SIBLING_MINA_BINARY;

  return "mina";
}

async function runMina(
  binary: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const outputDirectory = await mkdtemp(join(tmpdir(), "mina-command-"));
  const stdoutPath = join(outputDirectory, "stdout");
  const stderrPath = join(outputDirectory, "stderr");
  const stdoutFile = await open(stdoutPath, "w");
  const stderrFile = await open(stderrPath, "w");

  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const child = spawn(binary, args, {
        stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
      });
      child.once("error", reject);
      child.once("close", resolveExit);
    });

    await stdoutFile.close();
    await stderrFile.close();
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, "utf8"),
      readFile(stderrPath, "utf8"),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Mina command failed with exit code ${exitCode}: ${binary} ${args.join(" ")}\n${stderr}`,
      );
    }
    return { stdout, stderr };
  } finally {
    await stdoutFile.close().catch(() => undefined);
    await stderrFile.close().catch(() => undefined);
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

export async function computeMinaLedgerRoot(
  accounts: MinaTestLedgerAccount[],
  minaBinary?: string,
): Promise<string> {
  const binary = await resolveMinaBinary(minaBinary);
  const outputDirectory = await mkdtemp(join(tmpdir(), "mina-ledger-root-"));
  const ledgerPath = join(outputDirectory, "ledger.json");

  try {
    await writeFile(ledgerPath, `${JSON.stringify(accounts)}\n`, "utf8");
    const result = await runMina(binary, [
      "ledger",
      "hash",
      "--ledger-file",
      ledgerPath,
    ]);
    return result.stdout.trim();
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

export async function compareGeneratedMinaLedger({
  accountCount,
  minaBinary,
  minBalance,
  maxBalance,
  seed = randomBytes(32).toString("hex"),
  zkappPercentage = DEFAULT_ZKAPP_PERCENTAGE,
  ledgerOutputPath,
  checkCircuit = false,
}: {
  accountCount: number;
  minaBinary?: string;
  minBalance?: string;
  maxBalance?: string;
  seed?: string;
  zkappPercentage?: number;
  ledgerOutputPath?: string;
  checkCircuit?: boolean;
}): Promise<MinaLedgerParityResult> {
  if (
    !Number.isSafeInteger(accountCount) ||
    accountCount < 0 ||
    accountCount > MAX_ACCOUNT_COUNT
  ) {
    throw new Error(
      `accountCount must be an integer from 0 through ${MAX_ACCOUNT_COUNT}`,
    );
  }

  const binary = await resolveMinaBinary(minaBinary);
  const generateArgs = [
    "ledger",
    "test",
    "generate-accounts",
    "-n",
    String(accountCount),
  ];
  if (minBalance !== undefined) {
    generateArgs.push("--min-balance", minBalance);
  }
  if (maxBalance !== undefined) {
    generateArgs.push("--max-balance", maxBalance);
  }

  const generated = await runMina(binary, generateArgs);
  const generatedAccounts = parseGeneratedAccounts(generated.stdout);
  if (generatedAccounts.length !== accountCount) {
    throw new Error(
      `Mina generated ${generatedAccounts.length} accounts instead of ${accountCount}`,
    );
  }
  const { accounts, zkappCount, timedAccountCount, customTokenCount } =
    enrichGeneratedAccounts(generatedAccounts, { seed, zkappPercentage });

  let temporaryDirectory: string | undefined;
  const ledgerPath = ledgerOutputPath
    ? resolve(ledgerOutputPath)
    : join(
        (temporaryDirectory = await mkdtemp(
          join(tmpdir(), "mina-ledger-parity-"),
        )),
        "ledger.json",
      );

  try {
    if (ledgerOutputPath && !(await isAccessible(dirname(ledgerPath)))) {
      throw new Error(
        `Ledger output directory does not exist: ${dirname(ledgerPath)}`,
      );
    }
    await writeFile(ledgerPath, `${JSON.stringify(accounts)}\n`, "utf8");

    const minaHash = await runMina(binary, [
      "ledger",
      "hash",
      "--ledger-file",
      ledgerPath,
    ]);
    const minaRoot = minaHash.stdout.trim();
    const o1jsRoot = await computeO1jsLedgerRoot(accounts);
    const circuit = checkCircuit
      ? await checkStakingToVotingCircuit(accounts, minaRoot)
      : undefined;

    return {
      accountCount,
      minaRoot,
      o1jsRoot,
      matches: minaRoot === o1jsRoot,
      seed,
      zkappCount,
      timedAccountCount,
      customTokenCount,
      circuit,
      ledgerPath: ledgerOutputPath ? ledgerPath : undefined,
    };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export default function minaLedgerParityCommandFactory(program: Command) {
  program
    .command("mina-ledger-parity")
    .description("Generate a Mina test ledger and compare Mina and o1js roots")
    .addOption(
      new Option("-n, --account-count <count>", "Number of test accounts")
        .argParser(parseIntOption)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--mina-binary <path>", "Path to the OCaml Mina binary").env(
        "MINA_BINARY",
      ),
    )
    .addOption(new Option("--min-balance <mina>", "Minimum account balance"))
    .addOption(new Option("--max-balance <mina>", "Maximum account balance"))
    .addOption(
      new Option(
        "--zkapp-percentage <percentage>",
        "Percentage of accounts that contain zkApp state",
      )
        .argParser(parseIntOption)
        .default(DEFAULT_ZKAPP_PERCENTAGE),
    )
    .addOption(
      new Option(
        "--seed <seed>",
        "Seed for reproducible account-field entropy",
      ),
    )
    .addOption(
      new Option(
        "--ledger-output-path <path>",
        "Keep the generated ledger at this path",
      ),
    )
    .addOption(
      new Option(
        "--check-circuit",
        "Evaluate the staking-to-voting circuit method without proofs",
      ),
    )
    .action(async (options) => {
      const result = await compareGeneratedMinaLedger({
        accountCount: options.accountCount,
        minaBinary: options.minaBinary,
        minBalance: options.minBalance,
        maxBalance: options.maxBalance,
        seed: options.seed,
        zkappPercentage: options.zkappPercentage,
        ledgerOutputPath: options.ledgerOutputPath,
        checkCircuit: options.checkCircuit,
      });

      console.log(JSON.stringify(result, null, 2));
      if (!result.matches) {
        throw new Error(
          "Mina and o1js produced different staking ledger roots",
        );
      }
      if (result.circuit && !result.circuit.matches) {
        throw new Error(
          "The staking-to-voting circuit produced an unexpected voting ledger root",
        );
      }
    });
}
