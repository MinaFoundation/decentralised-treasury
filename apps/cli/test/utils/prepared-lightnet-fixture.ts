import assert from "node:assert";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { KeyvSqlite } from "@keyv/sqlite";
import {
  fetchAccount,
  LedgerHashBase58,
  Mina,
  PrivateKey,
  PublicKey,
  TokenId,
} from "o1js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { PersistentVotingLedger } from "@repo/sdk/src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { createSqliteVotingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import {
  ARCHIVE_NODE_URL,
  ensureExistingLightnetReady,
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  MINA_NODE_URL,
  waitForGlobalSlot,
} from "./cli-test-utils.js";

export type PreparedLightnetVote = "yay" | "nay" | "abstain";

export type PreparedLightnetFixture = {
  schemaVersion: 1;
  minaNodeUrl: string;
  archiveNodeUrl: string;
  accountManagerUrl: string;
  networkId: "devnet";
  chainId: string;
  slotDurationMs: number;
  slotsPerEpoch: number;
  ownerPublicKey: string;
  controllerPublicKey: string;
  deploymentTxHash: string;
  deployedAtSlot: number;
  lifecyclePeriodDurationSlots: number;
  proofsEnabled: true;
  ownerVerificationKeyHash: string;
  controllerVerificationKeyHash: string;
  stakingLedgerRoot: string;
  artifactLifecycleId: string;
  stakingLedgerPath: string;
  votingLedgerSqlitePath: string;
  exhaustedProofPath: string;
  voters: Array<{ privateKey: string; vote: PreparedLightnetVote }>;
  ownerBalance: string;
};

type StakingLedgerEntry = {
  pk: string;
  balance: string;
  delegate?: string;
  token?: string;
};

function requiredString(value: unknown, name: string): string {
  assert(typeof value === "string" && value.length > 0, `${name} is required`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  assert(
    Number.isInteger(value) && Number(value) > 0,
    `${name} must be a positive integer`,
  );
  return Number(value);
}

function resolveManifestPath(
  manifestPath: string,
  value: unknown,
  name: string,
) {
  const path = requiredString(value, name);
  return isAbsolute(path) ? path : resolve(dirname(manifestPath), path);
}

function minaToNanomina(value: string): bigint {
  assert(/^\d+(?:\.\d{1,9})?$/.test(value), `Invalid Mina balance: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

export async function loadPreparedLightnetFixture(): Promise<PreparedLightnetFixture> {
  const manifestPath = process.env.LIGHTNET_FIXTURE_MANIFEST_PATH;
  assert(
    manifestPath,
    "LIGHTNET_FIXTURE_MANIFEST_PATH must identify a prepared Lightnet fixture",
  );
  const absoluteManifestPath = resolve(manifestPath);
  const raw = JSON.parse(
    await readFile(absoluteManifestPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(
    raw.schemaVersion,
    1,
    "Prepared Lightnet schemaVersion must be 1",
  );
  assert.equal(
    raw.networkId,
    "devnet",
    "Prepared Lightnet networkId must be devnet",
  );
  assert.equal(raw.proofsEnabled, true, "Prepared Lightnet must use proofs");

  const rawVoters = raw.voters;
  assert(
    Array.isArray(rawVoters) && rawVoters.length >= 5,
    "At least five voters are required",
  );
  const voters = rawVoters.map((entry, index) => {
    assert(
      entry && typeof entry === "object",
      `voters[${index}] must be an object`,
    );
    const record = entry as Record<string, unknown>;
    const privateKey = requiredString(
      record.privateKey,
      `voters[${index}].privateKey`,
    );
    PrivateKey.fromBase58(privateKey);
    assert(
      record.vote === "yay" ||
        record.vote === "nay" ||
        record.vote === "abstain",
      `voters[${index}].vote is invalid`,
    );
    return { privateKey, vote: record.vote as PreparedLightnetVote };
  });

  const stakingLedgerPath = resolveManifestPath(
    absoluteManifestPath,
    raw.stakingLedgerPath,
    "stakingLedgerPath",
  );
  const votingLedgerSqlitePath = resolveManifestPath(
    absoluteManifestPath,
    raw.votingLedgerSqlitePath,
    "votingLedgerSqlitePath",
  );
  const exhaustedProofPath = resolveManifestPath(
    absoluteManifestPath,
    raw.exhaustedProofPath,
    "exhaustedProofPath",
  );
  await Promise.all([
    access(stakingLedgerPath),
    access(votingLedgerSqlitePath),
    access(exhaustedProofPath),
  ]);

  const ownerPublicKey = requiredString(raw.ownerPublicKey, "ownerPublicKey");
  PublicKey.fromBase58(ownerPublicKey);
  PublicKey.fromBase58(
    requiredString(raw.controllerPublicKey, "controllerPublicKey"),
  );
  const ledger = JSON.parse(
    await readFile(stakingLedgerPath, "utf8"),
  ) as StakingLedgerEntry[];
  assert(
    Array.isArray(ledger),
    "stakingLedgerPath must contain a ledger array",
  );
  const defaultToken = TokenId.toBase58(TokenId.default);
  const ownerEntries = ledger.filter(
    (entry) => entry.pk === ownerPublicKey && entry.token === defaultToken,
  );
  assert.equal(
    ownerEntries.length,
    1,
    "The ledger must contain one default-token Owner account",
  );
  const ownerBalance = minaToNanomina(ownerEntries[0]!.balance).toString();
  assert(
    BigInt(ownerBalance) > 0n,
    "The snapshot Owner balance must be positive",
  );

  const firstFive = voters.slice(0, 5);
  const voterPublicKeys = firstFive.map(({ privateKey }) =>
    PrivateKey.fromBase58(privateKey).toPublicKey().toBase58(),
  );
  assert.equal(
    new Set(voterPublicKeys).size,
    5,
    "The first five voters must be unique",
  );
  const votingPower = new Map<string, bigint>();
  let totalVotingPower = 0n;
  for (const entry of ledger) {
    if (entry.token !== defaultToken) continue;
    const balance = minaToNanomina(entry.balance);
    totalVotingPower += balance;
    const delegate = entry.delegate ?? entry.pk;
    votingPower.set(delegate, (votingPower.get(delegate) ?? 0n) + balance);
  }
  const selectedPower = voterPublicKeys.reduce(
    (sum, publicKey) => sum + (votingPower.get(publicKey) ?? 0n),
    0n,
  );
  const yayPower = firstFive.reduce(
    (sum, voter, index) =>
      sum +
      (voter.vote === "yay"
        ? (votingPower.get(voterPublicKeys[index]!) ?? 0n)
        : 0n),
    0n,
  );
  assert(
    selectedPower * 5n >= totalVotingPower,
    "The first five voters need at least 20% participation",
  );
  assert(
    yayPower * 2n > selectedPower,
    "The first five votes must have a yay majority",
  );

  return {
    schemaVersion: 1,
    minaNodeUrl: requiredString(raw.minaNodeUrl, "minaNodeUrl"),
    archiveNodeUrl: requiredString(raw.archiveNodeUrl, "archiveNodeUrl"),
    accountManagerUrl: requiredString(
      raw.accountManagerUrl,
      "accountManagerUrl",
    ),
    networkId: "devnet",
    chainId: requiredString(raw.chainId, "chainId"),
    slotDurationMs: positiveInteger(raw.slotDurationMs, "slotDurationMs"),
    slotsPerEpoch: positiveInteger(raw.slotsPerEpoch, "slotsPerEpoch"),
    ownerPublicKey,
    controllerPublicKey: requiredString(
      raw.controllerPublicKey,
      "controllerPublicKey",
    ),
    deploymentTxHash: requiredString(raw.deploymentTxHash, "deploymentTxHash"),
    deployedAtSlot: positiveInteger(raw.deployedAtSlot, "deployedAtSlot"),
    lifecyclePeriodDurationSlots: positiveInteger(
      raw.lifecyclePeriodDurationSlots,
      "lifecyclePeriodDurationSlots",
    ),
    proofsEnabled: true,
    ownerVerificationKeyHash: requiredString(
      raw.ownerVerificationKeyHash,
      "ownerVerificationKeyHash",
    ),
    controllerVerificationKeyHash: requiredString(
      raw.controllerVerificationKeyHash,
      "controllerVerificationKeyHash",
    ),
    stakingLedgerRoot: requiredString(
      raw.stakingLedgerRoot,
      "stakingLedgerRoot",
    ),
    artifactLifecycleId: requiredString(
      raw.artifactLifecycleId,
      "artifactLifecycleId",
    ),
    stakingLedgerPath,
    votingLedgerSqlitePath,
    exhaustedProofPath,
    voters,
    ownerBalance,
  };
}

async function currentStakingLedgerRoot(
  fixture: PreparedLightnetFixture,
): Promise<string> {
  const response = await fetch(fixture.minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "{ bestChain(maxLength:1) { protocolState { consensusState { stakingEpochData { ledger { hash } } } } } }",
    }),
  });
  assert(response.ok, `Staking-root query failed with HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      bestChain?: Array<{
        protocolState?: {
          consensusState?: {
            stakingEpochData?: { ledger?: { hash?: string } };
          };
        };
      }>;
    };
    errors?: Array<{ message?: string }>;
  };
  assert(
    !payload.errors?.length,
    payload.errors?.map(({ message }) => message).join("; "),
  );
  const root =
    payload.data?.bestChain?.[0]?.protocolState?.consensusState
      ?.stakingEpochData?.ledger?.hash;
  assert(root, "The current staking ledger root is unavailable");
  return root;
}

export async function validatePreparedLightnetFixture(
  fixture: PreparedLightnetFixture,
): Promise<void> {
  assert.equal(
    fixture.minaNodeUrl,
    MINA_NODE_URL,
    "MINA_NODE_URL does not match the manifest",
  );
  assert.equal(
    fixture.archiveNodeUrl,
    ARCHIVE_NODE_URL,
    "ARCHIVE_NODE_URL does not match the manifest",
  );
  assert.equal(
    fixture.accountManagerUrl,
    LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    "LIGHTNET_ACCOUNT_MANAGER_ENDPOINT does not match the manifest",
  );
  await ensureExistingLightnetReady({
    minaNodeUrl: fixture.minaNodeUrl,
    expectedChainId: fixture.chainId,
    expectedSlotDurationMs: fixture.slotDurationMs,
    expectedSlotsPerEpoch: fixture.slotsPerEpoch,
  });
  Mina.setActiveInstance(
    Mina.Network({
      mina: fixture.minaNodeUrl,
      archive: fixture.archiveNodeUrl,
      lightnetAccountManager: fixture.accountManagerUrl,
      networkId: fixture.networkId,
    }),
  );

  const ownerPublicKey = PublicKey.fromBase58(fixture.ownerPublicKey);
  const controllerPublicKey = PublicKey.fromBase58(fixture.controllerPublicKey);
  const [ownerResult, controllerResult] = await Promise.all([
    fetchAccount({ publicKey: ownerPublicKey }, fixture.minaNodeUrl),
    fetchAccount({ publicKey: controllerPublicKey }, fixture.minaNodeUrl),
  ]);
  assert(
    ownerResult.account,
    `Prepared Owner is unavailable: ${String(ownerResult.error)}`,
  );
  assert(
    controllerResult.account,
    `Prepared Controller is unavailable: ${String(controllerResult.error)}`,
  );
  assert.equal(
    ownerResult.account.zkapp.verificationKey?.hash.toString(),
    fixture.ownerVerificationKeyHash,
    "Prepared Owner verification key mismatch",
  );
  assert.equal(
    controllerResult.account.zkapp.verificationKey?.hash.toString(),
    fixture.controllerVerificationKeyHash,
    "Prepared Controller verification key mismatch",
  );

  const owner = new TreasuryOwnerSmartContract(ownerPublicKey);
  const [deployedAtSlot, configuredController] = await Promise.all([
    owner.treasuryDeployedAtSlot.fetch(),
    owner.pauseControllerPublicKey.fetch(),
  ]);
  assert.equal(deployedAtSlot?.toString(), String(fixture.deployedAtSlot));
  assert.equal(configuredController?.toBase58(), fixture.controllerPublicKey);
  assert.equal(
    await currentStakingLedgerRoot(fixture),
    fixture.stakingLedgerRoot,
  );

  const proof = JSON.parse(
    await readFile(fixture.exhaustedProofPath, "utf8"),
  ) as {
    publicInput?: unknown[];
    publicOutput?: unknown[];
  };
  assert(
    Array.isArray(proof.publicInput),
    "The exhausted proof has no publicInput",
  );
  assert(
    Array.isArray(proof.publicOutput),
    "The exhausted proof has no publicOutput",
  );
  assert.equal(
    String(proof.publicInput[0]),
    "0",
    "The exhausted proof must start at index 0",
  );
  assert.equal(
    String(proof.publicOutput[2]),
    "1",
    "The staking proof must be exhausted",
  );
  const proofStakingRoot = String(proof.publicInput[1]);
  assert.equal(
    proofStakingRoot,
    LedgerHashBase58.fromBase58(fixture.stakingLedgerRoot).toString(),
    "The exhausted proof does not match the staking snapshot",
  );

  const stakingLedger = new SqliteStakingLedgerService({
    lifecycleId: fixture.artifactLifecycleId,
    dbPath: fixture.votingLedgerSqlitePath,
  });
  await stakingLedger.start();
  try {
    assert.equal(
      (await stakingLedger.getRootHash()).toString(),
      proofStakingRoot,
      "The SQLite staking root does not match the exhausted proof",
    );
  } finally {
    await stakingLedger.close();
  }

  const sqliteStore = new KeyvSqlite({ uri: fixture.votingLedgerSqlitePath });
  const votingStorage = createSqliteVotingLedgerStorage(
    fixture.artifactLifecycleId,
    sqliteStore,
  );
  const votingLedger = new PersistentVotingLedger(
    votingStorage.votingAccountStorage,
    votingStorage.merkleTreeStorage,
  );
  try {
    assert.equal(
      (await votingLedger.getRoot()).toString(),
      String(proof.publicOutput[1]),
      "The SQLite voting root does not match the exhausted proof",
    );
  } finally {
    await votingLedger.close();
    await sqliteStore.disconnect();
  }
}

export async function selectPreparedProposalLifecycle(
  fixture: PreparedLightnetFixture,
  options: { minimumRemainingSlots: number },
): Promise<{ lifecycleId: number; startSlot: number; endSlot: number }> {
  const duration = fixture.lifecyclePeriodDurationSlots;
  const minimumRemainingSlots = positiveInteger(
    options.minimumRemainingSlots,
    "minimumRemainingSlots",
  );
  assert(minimumRemainingSlots <= duration);
  const cycleLength = duration * 4;
  const currentSlot = await getCurrentGlobalSlot();
  assert(
    currentSlot >= fixture.deployedAtSlot,
    "Owner deployment slot is in the future",
  );
  let lifecycleId = Math.floor(
    (currentSlot - fixture.deployedAtSlot) / cycleLength,
  );
  let startSlot = fixture.deployedAtSlot + lifecycleId * cycleLength;
  let endSlot = startSlot + duration - 1;
  if (
    currentSlot > endSlot ||
    endSlot - currentSlot + 1 < minimumRemainingSlots
  ) {
    lifecycleId += 1;
    startSlot += cycleLength;
    endSlot += cycleLength;
    const timeoutMs =
      Math.max(1, startSlot - currentSlot) * fixture.slotDurationMs + 120_000;
    await waitForGlobalSlot(startSlot, timeoutMs);
  }
  return { lifecycleId, startSlot, endSlot };
}

export async function prepareVotingLedgerForLifecycle(
  fixture: PreparedLightnetFixture,
  lifecycleId: string,
  runDirectory: string,
): Promise<{ sqliteDataDirectory: string; sqliteDbPath: string }> {
  const sqliteDataDirectory = join(runDirectory, "sqlite");
  const sqliteDbPath = join(sqliteDataDirectory, `${lifecycleId}.sqlite`);
  await mkdir(sqliteDataDirectory, { recursive: true });
  await copyFile(fixture.votingLedgerSqlitePath, sqliteDbPath);
  if (lifecycleId === fixture.artifactLifecycleId) {
    return { sqliteDataDirectory, sqliteDbPath };
  }

  const store = new KeyvSqlite({ uri: sqliteDbPath });
  const namespaces = [
    "staking-ledger-{id}-accounts",
    "staking-ledger-{id}-account-public-keys",
    "staking-ledger-{id}-merkle-tree",
    "staking-ledger-to-voting-ledger-{id}-traces",
    "voting-ledger-{id}-voting-accounts",
    "voting-ledger-{id}-merkle-tree",
  ];
  try {
    for (const template of namespaces) {
      const oldPrefix = `${template.replace("{id}", fixture.artifactLifecycleId)}:`;
      const newPrefix = `${template.replace("{id}", lifecycleId)}:`;
      await store.query(
        "UPDATE keyv SET key = ? || substr(key, ?) WHERE key >= ? AND key < ?",
        newPrefix,
        oldPrefix.length + 1,
        oldPrefix,
        `${oldPrefix}\uffff`,
      );
    }
  } finally {
    await store.disconnect();
  }
  return { sqliteDataDirectory, sqliteDbPath };
}
