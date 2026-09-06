import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildPublicDeploymentRecord,
  exportPublicDeploymentConfig,
} from "../scripts/export-public-deployment-config.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(
  new URL("../scripts/export-public-deployment-config.mjs", import.meta.url),
);

function publicKey(index) {
  const suffixes = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `B62${"1".repeat(51)}${suffixes[index]}`;
}

function verificationKey(name, index) {
  return {
    data: `${name}-verification-key-data`,
    hash: String(1_000 + index),
  };
}

function fixture() {
  const treasuryOwnerAddress = publicKey(0);
  const pauseControllerAddress = publicKey(1);
  const participants = [2, 3, 4, 5, 6].map(publicKey);

  return {
    accountQuery: {
      accessPermission: "proofOrSignature",
      databaseUrl: "postgres://operator:do-not-export@db/treasury",
      networkId: "testnet",
      nonce: "44",
      password: "account-query-password",
      pauseControllerAddress,
      pauseControllerVerificationKeyHash: "5002",
      sendPermission: "proofOrSignature",
      signature: "account-query-signature",
      treasuryOwnerAddress,
      treasuryOwnerVerificationKeyHash: "5001",
    },
    compileResult: {
      browserCompileConfig: {
        emptyNullifierRoot: "4002",
        emptyVotingLedgerRoot: "4001",
        lifecyclePeriodDuration: "7140",
        stakingLedgerToVotingLedgerVerificationKeyJson: verificationKey(
          "staking-ledger-to-voting-ledger",
          2,
        ),
        treasuryProposalVerificationKeyJson: verificationKey(
          "treasury-proposal",
          3,
        ),
        voteReducerVerificationKeyJson: verificationKey("vote-reducer", 1),
      },
      lifecyclePeriodDuration: "7140",
      senderPrivateKey: "EKF-compile-secret",
      verificationKeyHashes: {
        stakingLedgerToVotingLedger: "1002",
        treasuryOwner: "5001",
        treasuryPauseController: "5002",
        treasuryProposal: "1003",
        voteReducer: "1001",
      },
    },
    deploymentId: "testnet-2026-09-02",
    deploymentResult: {
      ledgerAccountIndex: 7,
      multisigCommitment: "6001",
      nonce: 12,
      pauseControllerAddress,
      pauseControllerPrivateKey: "EKF-pause-secret",
      pauseControllerTxHash: "5J-pause-controller-deployment",
      signature: "deployment-signature",
      treasuryOwnerAddress,
      treasuryOwnerPrivateKey: "EKF-owner-secret",
      treasuryOwnerTxHash: "5J-treasury-owner-deployment",
      withdrawalPermission: "proofOrSignature",
    },
    generatedAt: "2026-09-02T12:30:00Z",
    intended: {
      buildIdentity: "treasury-images@sha256:build-identity",
      lifecyclePeriodDuration: "7140",
      multisigParticipantsPublicKeys: participants,
      networkId: "testnet",
      password: "intended-password",
      pauseControllerAddress,
      policyConstants: {
        basisPoints: "10000",
        bondAmountDivisor: "10",
        curveConstantApprovalBp: "1000",
        curveConstantParticipationBp: "500",
        maxApprovalBp: "7000",
        maxParticipationBp: "5000",
        minApprovalBp: "5100",
        minParticipationBp: "2000",
        minValidMultisigSignaturesCount: "3",
        multisigParticipantsCount: "5",
        numberOfLifecyclePeriods: "4",
      },
      publicEndpoints: {
        archiveNode: "https://archive.testnet.example/graphql",
        backoffice: "https://operator.testnet.example",
        indexerApi: "https://api.testnet.example/indexer",
        minaNode: "https://mina.testnet.example/graphql",
        processorApi: "https://api.testnet.example/processor",
        treasuryApi: "https://api.testnet.example/api",
        web: "https://treasury.testnet.example",
      },
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      treasuryDeployedAtSlot: "14280",
      treasuryOwnerAddress,
      withdrawalPermission: "proofOrSignature",
    },
    ownerState: {
      accessPermission: "proofOrSignature",
      nonce: "2",
      pauseControllerPublicKey: pauseControllerAddress,
      sendPermission: "proofOrSignature",
      treasuryDeployedAtSlot: "14280",
      treasuryOwnerAddress,
      withdrawalPermission: "proofOrSignature",
    },
    pauseState: {
      multisigCommitment: "6001",
      nonce: "3",
      paused: false,
      pauseControllerAddress,
      signatures: ["signature-one", "signature-two"],
    },
    senderPrivateKey: "EKF-top-level-secret",
  };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

async function withTempDir(callback) {
  const directory = await mkdtemp(join(tmpdir(), "treasury-public-config-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("happy path writes the default deployment record and SHA-256 digest", async () => {
  await withTempDir(async (directory) => {
    const inputPath = join(directory, "public-input.json");
    await writeFile(inputPath, JSON.stringify(fixture()), "utf8");

    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT_PATH, "--input", inputPath],
      { cwd: directory },
    );
    const commandResult = JSON.parse(stdout);
    const expectedOutput = join(
      directory,
      "deployments",
      "testnet-2026-09-02",
      "public-configuration.json",
    );
    assert.equal(commandResult.outputPath, await realpath(expectedOutput));

    const record = JSON.parse(await readFile(expectedOutput, "utf8"));
    assert.equal(record.publicConfiguration.networkId, "testnet");
    assert.equal(
      record.publicConfiguration.comparisons.networkId.matches,
      true,
    );
    assert.equal(
      record.publicConfiguration.transactions.treasuryOwnerDeployment,
      "5J-treasury-owner-deployment",
    );
    assert.equal(
      record.publicConfiguration.comparisons.verificationKeyHashes.treasuryOwner
        .matches,
      true,
    );
    assert.match(record.digest.value, /^[a-f0-9]{64}$/);
  });
});

test("a mismatch between intended data and the MINA account query is rejected", () => {
  const input = fixture();
  input.accountQuery.networkId = "devnet";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /networkId in accountQuery mismatch/,
  );
});

test("duplicate break-glass signer public keys are rejected", () => {
  const input = fixture();
  input.intended.multisigParticipantsPublicKeys[4] =
    input.intended.multisigParticipantsPublicKeys[0];

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /must contain five distinct public keys/,
  );
});

test("a missing proof verification-key value is rejected", () => {
  const input = fixture();
  input.compileResult.browserCompileConfig.voteReducerVerificationKeyJson.data =
    "";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /voteReducerVerificationKeyJson\.data must be a nonempty string/,
  );
});

test("a verification-key hash mismatch is rejected", () => {
  const input = fixture();
  input.compileResult.verificationKeyHashes.voteReducer = "9999";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /Vote Reducer verification-key hash.*mismatch/,
  );
});

test("a deployed multisig commitment mismatch is rejected", () => {
  const input = fixture();
  input.pauseState.multisigCommitment = "6999";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /multisigCommitment in pauseState mismatch/,
  );
});

test("a paused initial Pause Controller state is rejected", () => {
  const input = fixture();
  input.pauseState.paused = true;

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /initial paused value in pauseState mismatch/,
  );
});

test("both deployment transaction hashes are required", () => {
  const input = fixture();
  delete input.deploymentResult.treasuryOwnerTxHash;

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /deploymentResult\.treasuryOwnerTxHash must be a nonempty string/,
  );
});

test("policy threshold ordering is validated", () => {
  const input = fixture();
  input.intended.policyConstants.minApprovalBp = "7001";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /minApprovalBp must not exceed maxApprovalBp/,
  );
});

test("a zero curve constant is rejected", () => {
  const input = fixture();
  input.intended.policyConstants.curveConstantApprovalBp = "0";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /curveConstantApprovalBp must be at least 1/,
  );
});

test("public endpoints reject embedded credentials", () => {
  const input = fixture();
  input.intended.publicEndpoints.archiveNode =
    "https://operator:secret@archive.testnet.example/graphql";

  assert.throws(
    () => buildPublicDeploymentRecord(input),
    /publicEndpoints\.archiveNode must not contain credentials/,
  );
});

test("the output allowlist excludes secrets and signing metadata", () => {
  const recordText = JSON.stringify(buildPublicDeploymentRecord(fixture()));

  for (const secret of [
    "EKF-top-level-secret",
    "EKF-compile-secret",
    "EKF-owner-secret",
    "EKF-pause-secret",
    "postgres://operator:do-not-export@db/treasury",
    "account-query-password",
    "intended-password",
    "account-query-signature",
    "deployment-signature",
    "signature-one",
  ]) {
    assert.equal(recordText.includes(secret), false, `exported ${secret}`);
  }
  assert.equal(
    /"(?:privateKey|password|databaseUrl|signatures?|ledgerAccountIndex|nonce)"/i.test(
      recordText,
    ),
    false,
  );
});

test("the record and digest are deterministic for the same explicit input", () => {
  const first = buildPublicDeploymentRecord(fixture());
  const second = buildPublicDeploymentRecord(fixture());

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const canonicalConfiguration = JSON.stringify(
    sortJson(first.publicConfiguration),
  );
  const expectedDigest = createHash("sha256")
    .update(canonicalConfiguration)
    .digest("hex");
  assert.equal(first.digest.value, expectedDigest);
});

test("an existing output is protected unless force is true", async () => {
  await withTempDir(async (directory) => {
    const inputPath = join(directory, "public-input.json");
    const outputPath = join(directory, "public-configuration.json");
    await writeFile(inputPath, JSON.stringify(fixture()), "utf8");

    await exportPublicDeploymentConfig({ inputPath, outputPath });
    await assert.rejects(
      () => exportPublicDeploymentConfig({ inputPath, outputPath }),
      /Output already exists.*Use --force/,
    );
    await exportPublicDeploymentConfig({
      force: true,
      inputPath,
      outputPath,
    });
  });
});
