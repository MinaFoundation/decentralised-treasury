#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UINT32_MAX = 4_294_967_295n;
const MINA_PUBLIC_KEY = /^B62[1-9A-HJ-NP-Za-km-z]{52}$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WITHDRAWAL_PERMISSIONS = new Set(["proof", "proofOrSignature"]);
const NETWORK_IDS = new Set(["mainnet", "devnet", "testnet"]);

function usage() {
  return [
    "Usage:",
    "  node devops/scripts/export-public-deployment-config.mjs --input <public-input.json> [--output <public-configuration.json>] [--force]",
    "",
    "Default output:",
    "  deployments/<deployment-id>/public-configuration.json",
    "",
    "Required input objects:",
    "  deploymentId, generatedAt, intended, compileResult, deploymentResult,",
    "  ownerState, pauseState, and accountQuery",
    "",
    "Use the JSON results from the Treasury Owner compile, deploy, and read-state",
    "commands, the Pause Controller read-state command, and a normalized public",
    "MINA account query. The intended object supplies networkId, contract addresses,",
    "lifecyclePeriodDuration, treasuryDeployedAtSlot, withdrawalPermission, and",
    "five ordered multisigParticipantsPublicKeys. It also supplies sourceRevision,",
    "buildIdentity, publicEndpoints, and policyConstants.",
    "",
    "The input must contain only structured deployment results. The exporter uses",
    "an explicit public-field allowlist. It does not copy private keys, passwords,",
    "database URLs, signatures, Ledger indexes, or transaction nonces.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { force: false, input: undefined, output: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      return value;
    };

    if (argument === "--input") {
      options.input = readValue();
      continue;
    }
    if (argument === "--output") {
      options.output = readValue();
      continue;
    }
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.help && !options.input) {
    throw new Error("--input is required");
  }

  return options;
}

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a nonempty string`);
  }
  if (value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`${path} must not contain surrounding space or newlines`);
  }
  return value;
}

function requireNetworkId(value, path) {
  const networkId = requireString(value, path);
  if (!NETWORK_IDS.has(networkId)) {
    throw new Error(`${path} must be mainnet, devnet, or testnet`);
  }
  return networkId;
}

function requirePublicKey(value, path) {
  const publicKey = requireString(value, path);
  if (!MINA_PUBLIC_KEY.test(publicKey)) {
    throw new Error(`${path} must be a Mina B62 public key`);
  }
  return publicKey;
}

function requireUInt32(value, path, { minimum = 0n } = {}) {
  const text = requireNonnegativeInteger(value, path, { minimum });
  if (BigInt(text) > UINT32_MAX) {
    throw new Error(`${path} must not exceed ${UINT32_MAX.toString()}`);
  }
  return text;
}

function requireNonnegativeInteger(value, path, { minimum = 0n } = {}) {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  const parsed = BigInt(text);
  if (parsed < minimum) {
    throw new Error(`${path} must be at least ${minimum.toString()}`);
  }
  return parsed.toString();
}

function requirePublicUrl(value, path) {
  const text = requireString(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${path} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${path} must not contain credentials`);
  }
  return text;
}

function requireField(value, path) {
  const text = requireString(value, path);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${path} must be a decimal field value`);
  }
  return text;
}

function requireWithdrawalPermission(value, path) {
  const permission = requireString(value, path);
  if (!WITHDRAWAL_PERMISSIONS.has(permission)) {
    throw new Error(`${path} must be proof or proofOrSignature`);
  }
  return permission;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
  return value;
}

function requireVerificationKey(value, path) {
  const verificationKey = requireRecord(value, path);
  return {
    data: requireString(verificationKey.data, `${path}.data`),
    hash: requireField(verificationKey.hash, `${path}.hash`),
  };
}

function requireEqual(label, expected, actual) {
  if (expected !== actual) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function requirePublicKeys(value, path) {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error(`${path} must contain exactly five ordered public keys`);
  }
  const publicKeys = value.map((publicKey, index) =>
    requirePublicKey(publicKey, `${path}[${index}]`),
  );
  if (new Set(publicKeys).size !== publicKeys.length) {
    throw new Error(`${path} must contain five distinct public keys`);
  }
  return publicKeys;
}

function requirePublicEndpoints(value, path) {
  const endpoints = requireRecord(value, path);
  return {
    archiveNode: requirePublicUrl(endpoints.archiveNode, `${path}.archiveNode`),
    backoffice: requirePublicUrl(endpoints.backoffice, `${path}.backoffice`),
    indexerApi: requirePublicUrl(endpoints.indexerApi, `${path}.indexerApi`),
    minaNode: requirePublicUrl(endpoints.minaNode, `${path}.minaNode`),
    processorApi: requirePublicUrl(
      endpoints.processorApi,
      `${path}.processorApi`,
    ),
    treasuryApi: requirePublicUrl(endpoints.treasuryApi, `${path}.treasuryApi`),
    web: requirePublicUrl(endpoints.web, `${path}.web`),
  };
}

function requirePolicyConstants(value, path, participantCount) {
  const constants = requireRecord(value, path);
  const result = {
    basisPoints: requireNonnegativeInteger(
      constants.basisPoints,
      `${path}.basisPoints`,
      { minimum: 1n },
    ),
    bondAmountDivisor: requireNonnegativeInteger(
      constants.bondAmountDivisor,
      `${path}.bondAmountDivisor`,
      { minimum: 1n },
    ),
    curveConstantApprovalBp: requireNonnegativeInteger(
      constants.curveConstantApprovalBp,
      `${path}.curveConstantApprovalBp`,
      { minimum: 1n },
    ),
    curveConstantParticipationBp: requireNonnegativeInteger(
      constants.curveConstantParticipationBp,
      `${path}.curveConstantParticipationBp`,
      { minimum: 1n },
    ),
    maxApprovalBp: requireNonnegativeInteger(
      constants.maxApprovalBp,
      `${path}.maxApprovalBp`,
    ),
    maxParticipationBp: requireNonnegativeInteger(
      constants.maxParticipationBp,
      `${path}.maxParticipationBp`,
    ),
    minApprovalBp: requireNonnegativeInteger(
      constants.minApprovalBp,
      `${path}.minApprovalBp`,
    ),
    minParticipationBp: requireNonnegativeInteger(
      constants.minParticipationBp,
      `${path}.minParticipationBp`,
    ),
    minValidMultisigSignaturesCount: requireNonnegativeInteger(
      constants.minValidMultisigSignaturesCount,
      `${path}.minValidMultisigSignaturesCount`,
      { minimum: 1n },
    ),
    multisigParticipantsCount: requireNonnegativeInteger(
      constants.multisigParticipantsCount,
      `${path}.multisigParticipantsCount`,
      { minimum: 1n },
    ),
    numberOfLifecyclePeriods: requireNonnegativeInteger(
      constants.numberOfLifecyclePeriods,
      `${path}.numberOfLifecyclePeriods`,
      { minimum: 1n },
    ),
  };

  const basisPoints = BigInt(result.basisPoints);
  const requireBasisPointRange = (name) => {
    if (BigInt(result[name]) > basisPoints) {
      throw new Error(`${path}.${name} must not exceed ${path}.basisPoints`);
    }
  };
  for (const name of [
    "curveConstantApprovalBp",
    "curveConstantParticipationBp",
    "maxApprovalBp",
    "maxParticipationBp",
    "minApprovalBp",
    "minParticipationBp",
  ]) {
    requireBasisPointRange(name);
  }
  if (BigInt(result.minApprovalBp) > BigInt(result.maxApprovalBp)) {
    throw new Error(`${path}.minApprovalBp must not exceed maxApprovalBp`);
  }
  if (BigInt(result.minParticipationBp) > BigInt(result.maxParticipationBp)) {
    throw new Error(
      `${path}.minParticipationBp must not exceed maxParticipationBp`,
    );
  }
  if (BigInt(result.multisigParticipantsCount) !== BigInt(participantCount)) {
    throw new Error(
      `${path}.multisigParticipantsCount must equal the number of ordered participant public keys`,
    );
  }
  if (
    BigInt(result.minValidMultisigSignaturesCount) >
    BigInt(result.multisigParticipantsCount)
  ) {
    throw new Error(
      `${path}.minValidMultisigSignaturesCount must not exceed multisigParticipantsCount`,
    );
  }

  return result;
}

function comparison(intended, observed, source) {
  return { intended, matches: true, observed, source };
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

/**
 * Build one deterministic, public deployment record from normalized CLI and
 * MINA network results. Only fields selected below can enter the output.
 */
export function buildPublicDeploymentRecord(inputValue) {
  const input = requireRecord(inputValue, "input");
  const intendedInput = requireRecord(input.intended, "intended");
  const compileInput = requireRecord(input.compileResult, "compileResult");
  const browserCompileInput = requireRecord(
    compileInput.browserCompileConfig,
    "compileResult.browserCompileConfig",
  );
  const deploymentInput = requireRecord(
    input.deploymentResult,
    "deploymentResult",
  );
  const ownerInput = requireRecord(input.ownerState, "ownerState");
  const pauseInput = requireRecord(input.pauseState, "pauseState");
  const accountInput = requireRecord(input.accountQuery, "accountQuery");

  const deploymentId = requireString(input.deploymentId, "deploymentId");
  if (!DEPLOYMENT_ID.test(deploymentId)) {
    throw new Error(
      "deploymentId must start with an alphanumeric character and contain only alphanumeric characters, dots, underscores, or hyphens",
    );
  }
  const generatedAt = requireString(input.generatedAt, "generatedAt");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(generatedAt) ||
    Number.isNaN(Date.parse(generatedAt))
  ) {
    throw new Error("generatedAt must be an ISO 8601 UTC timestamp");
  }

  const multisigParticipantsPublicKeys = requirePublicKeys(
    intendedInput.multisigParticipantsPublicKeys,
    "intended.multisigParticipantsPublicKeys",
  );
  const intended = {
    buildIdentity: requireString(
      intendedInput.buildIdentity,
      "intended.buildIdentity",
    ),
    lifecyclePeriodDuration: requireUInt32(
      intendedInput.lifecyclePeriodDuration,
      "intended.lifecyclePeriodDuration",
      { minimum: 1n },
    ),
    multisigParticipantsPublicKeys,
    networkId: requireNetworkId(intendedInput.networkId, "intended.networkId"),
    pauseControllerAddress: requirePublicKey(
      intendedInput.pauseControllerAddress,
      "intended.pauseControllerAddress",
    ),
    policyConstants: requirePolicyConstants(
      intendedInput.policyConstants,
      "intended.policyConstants",
      multisigParticipantsPublicKeys.length,
    ),
    publicEndpoints: requirePublicEndpoints(
      intendedInput.publicEndpoints,
      "intended.publicEndpoints",
    ),
    sourceRevision: requireString(
      intendedInput.sourceRevision,
      "intended.sourceRevision",
    ),
    treasuryDeployedAtSlot: requireUInt32(
      intendedInput.treasuryDeployedAtSlot,
      "intended.treasuryDeployedAtSlot",
    ),
    treasuryOwnerAddress: requirePublicKey(
      intendedInput.treasuryOwnerAddress,
      "intended.treasuryOwnerAddress",
    ),
    withdrawalPermission: requireWithdrawalPermission(
      intendedInput.withdrawalPermission,
      "intended.withdrawalPermission",
    ),
  };

  const compileLifecyclePeriodDuration = requireUInt32(
    compileInput.lifecyclePeriodDuration,
    "compileResult.lifecyclePeriodDuration",
    { minimum: 1n },
  );
  const browserLifecyclePeriodDuration = requireUInt32(
    browserCompileInput.lifecyclePeriodDuration,
    "compileResult.browserCompileConfig.lifecyclePeriodDuration",
    { minimum: 1n },
  );
  requireEqual(
    "lifecyclePeriodDuration in compileResult",
    intended.lifecyclePeriodDuration,
    compileLifecyclePeriodDuration,
  );
  requireEqual(
    "lifecyclePeriodDuration in browserCompileConfig",
    intended.lifecyclePeriodDuration,
    browserLifecyclePeriodDuration,
  );

  const proofConfiguration = {
    roots: {
      emptyNullifierRoot: requireField(
        browserCompileInput.emptyNullifierRoot,
        "compileResult.browserCompileConfig.emptyNullifierRoot",
      ),
      emptyVotingLedgerRoot: requireField(
        browserCompileInput.emptyVotingLedgerRoot,
        "compileResult.browserCompileConfig.emptyVotingLedgerRoot",
      ),
    },
    verificationKeys: {
      stakingLedgerToVotingLedger: requireVerificationKey(
        browserCompileInput.stakingLedgerToVotingLedgerVerificationKeyJson,
        "compileResult.browserCompileConfig.stakingLedgerToVotingLedgerVerificationKeyJson",
      ),
      treasuryProposal: requireVerificationKey(
        browserCompileInput.treasuryProposalVerificationKeyJson,
        "compileResult.browserCompileConfig.treasuryProposalVerificationKeyJson",
      ),
      voteReducer: requireVerificationKey(
        browserCompileInput.voteReducerVerificationKeyJson,
        "compileResult.browserCompileConfig.voteReducerVerificationKeyJson",
      ),
    },
  };

  const verificationKeyHashesInput = requireRecord(
    compileInput.verificationKeyHashes,
    "compileResult.verificationKeyHashes",
  );
  const verificationKeyHashes = {
    stakingLedgerToVotingLedger: requireField(
      verificationKeyHashesInput.stakingLedgerToVotingLedger,
      "compileResult.verificationKeyHashes.stakingLedgerToVotingLedger",
    ),
    treasuryOwner: requireField(
      verificationKeyHashesInput.treasuryOwner,
      "compileResult.verificationKeyHashes.treasuryOwner",
    ),
    treasuryPauseController: requireField(
      verificationKeyHashesInput.treasuryPauseController,
      "compileResult.verificationKeyHashes.treasuryPauseController",
    ),
    treasuryProposal: requireField(
      verificationKeyHashesInput.treasuryProposal,
      "compileResult.verificationKeyHashes.treasuryProposal",
    ),
    voteReducer: requireField(
      verificationKeyHashesInput.voteReducer,
      "compileResult.verificationKeyHashes.voteReducer",
    ),
  };
  requireEqual(
    "Vote Reducer verification-key hash in browserCompileConfig",
    verificationKeyHashes.voteReducer,
    proofConfiguration.verificationKeys.voteReducer.hash,
  );
  requireEqual(
    "Staking Ledger to Voting Ledger verification-key hash in browserCompileConfig",
    verificationKeyHashes.stakingLedgerToVotingLedger,
    proofConfiguration.verificationKeys.stakingLedgerToVotingLedger.hash,
  );
  requireEqual(
    "Treasury Proposal verification-key hash in browserCompileConfig",
    verificationKeyHashes.treasuryProposal,
    proofConfiguration.verificationKeys.treasuryProposal.hash,
  );

  const deployment = {
    multisigCommitment: requireField(
      deploymentInput.multisigCommitment,
      "deploymentResult.multisigCommitment",
    ),
    pauseControllerAddress: requirePublicKey(
      deploymentInput.pauseControllerAddress,
      "deploymentResult.pauseControllerAddress",
    ),
    treasuryOwnerAddress: requirePublicKey(
      deploymentInput.treasuryOwnerAddress,
      "deploymentResult.treasuryOwnerAddress",
    ),
    pauseControllerTxHash: requireString(
      deploymentInput.pauseControllerTxHash,
      "deploymentResult.pauseControllerTxHash",
    ),
    treasuryOwnerTxHash: requireString(
      deploymentInput.treasuryOwnerTxHash,
      "deploymentResult.treasuryOwnerTxHash",
    ),
    withdrawalPermission: requireWithdrawalPermission(
      deploymentInput.withdrawalPermission,
      "deploymentResult.withdrawalPermission",
    ),
  };
  requireEqual(
    "Treasury Owner address in deploymentResult",
    intended.treasuryOwnerAddress,
    deployment.treasuryOwnerAddress,
  );
  requireEqual(
    "Pause Controller address in deploymentResult",
    intended.pauseControllerAddress,
    deployment.pauseControllerAddress,
  );
  requireEqual(
    "withdrawalPermission in deploymentResult",
    intended.withdrawalPermission,
    deployment.withdrawalPermission,
  );

  const ownerState = {
    accessPermission: requireWithdrawalPermission(
      ownerInput.accessPermission,
      "ownerState.accessPermission",
    ),
    pauseControllerAddress: requirePublicKey(
      ownerInput.pauseControllerPublicKey,
      "ownerState.pauseControllerPublicKey",
    ),
    sendPermission: requireWithdrawalPermission(
      ownerInput.sendPermission,
      "ownerState.sendPermission",
    ),
    treasuryDeployedAtSlot: requireUInt32(
      ownerInput.treasuryDeployedAtSlot,
      "ownerState.treasuryDeployedAtSlot",
    ),
    treasuryOwnerAddress: requirePublicKey(
      ownerInput.treasuryOwnerAddress,
      "ownerState.treasuryOwnerAddress",
    ),
    withdrawalPermission: requireWithdrawalPermission(
      ownerInput.withdrawalPermission,
      "ownerState.withdrawalPermission",
    ),
  };
  requireEqual(
    "Treasury Owner address in ownerState",
    intended.treasuryOwnerAddress,
    ownerState.treasuryOwnerAddress,
  );
  requireEqual(
    "Pause Controller address in ownerState",
    intended.pauseControllerAddress,
    ownerState.pauseControllerAddress,
  );
  requireEqual(
    "treasuryDeployedAtSlot in ownerState",
    intended.treasuryDeployedAtSlot,
    ownerState.treasuryDeployedAtSlot,
  );
  requireEqual(
    "withdrawalPermission in ownerState",
    intended.withdrawalPermission,
    ownerState.withdrawalPermission,
  );
  requireEqual(
    "accessPermission in ownerState",
    intended.withdrawalPermission,
    ownerState.accessPermission,
  );
  requireEqual(
    "sendPermission in ownerState",
    intended.withdrawalPermission,
    ownerState.sendPermission,
  );

  const pauseState = {
    multisigCommitment: requireField(
      pauseInput.multisigCommitment,
      "pauseState.multisigCommitment",
    ),
    pauseControllerAddress: requirePublicKey(
      pauseInput.pauseControllerAddress,
      "pauseState.pauseControllerAddress",
    ),
    paused: requireBoolean(pauseInput.paused, "pauseState.paused"),
  };
  requireEqual(
    "Pause Controller address in pauseState",
    intended.pauseControllerAddress,
    pauseState.pauseControllerAddress,
  );
  requireEqual("initial paused value in pauseState", false, pauseState.paused);
  requireEqual(
    "multisigCommitment in pauseState",
    deployment.multisigCommitment,
    pauseState.multisigCommitment,
  );

  const accountQuery = {
    accessPermission: requireWithdrawalPermission(
      accountInput.accessPermission,
      "accountQuery.accessPermission",
    ),
    networkId: requireNetworkId(
      accountInput.networkId,
      "accountQuery.networkId",
    ),
    pauseControllerAddress: requirePublicKey(
      accountInput.pauseControllerAddress,
      "accountQuery.pauseControllerAddress",
    ),
    pauseControllerVerificationKeyHash: requireField(
      accountInput.pauseControllerVerificationKeyHash,
      "accountQuery.pauseControllerVerificationKeyHash",
    ),
    sendPermission: requireWithdrawalPermission(
      accountInput.sendPermission,
      "accountQuery.sendPermission",
    ),
    treasuryOwnerAddress: requirePublicKey(
      accountInput.treasuryOwnerAddress,
      "accountQuery.treasuryOwnerAddress",
    ),
    treasuryOwnerVerificationKeyHash: requireField(
      accountInput.treasuryOwnerVerificationKeyHash,
      "accountQuery.treasuryOwnerVerificationKeyHash",
    ),
  };
  requireEqual(
    "networkId in accountQuery",
    intended.networkId,
    accountQuery.networkId,
  );
  requireEqual(
    "Treasury Owner address in accountQuery",
    intended.treasuryOwnerAddress,
    accountQuery.treasuryOwnerAddress,
  );
  requireEqual(
    "Pause Controller address in accountQuery",
    intended.pauseControllerAddress,
    accountQuery.pauseControllerAddress,
  );
  requireEqual(
    "accessPermission in accountQuery",
    intended.withdrawalPermission,
    accountQuery.accessPermission,
  );
  requireEqual(
    "sendPermission in accountQuery",
    intended.withdrawalPermission,
    accountQuery.sendPermission,
  );
  requireEqual(
    "Treasury Owner verification-key hash in accountQuery",
    verificationKeyHashes.treasuryOwner,
    accountQuery.treasuryOwnerVerificationKeyHash,
  );
  requireEqual(
    "Pause Controller verification-key hash in accountQuery",
    verificationKeyHashes.treasuryPauseController,
    accountQuery.pauseControllerVerificationKeyHash,
  );

  const publicConfiguration = {
    addresses: {
      pauseController: intended.pauseControllerAddress,
      treasuryOwner: intended.treasuryOwnerAddress,
    },
    buildIdentity: intended.buildIdentity,
    comparisons: {
      accessPermission: comparison(
        intended.withdrawalPermission,
        accountQuery.accessPermission,
        "MINA account query",
      ),
      lifecyclePeriodDuration: comparison(
        intended.lifecyclePeriodDuration,
        compileLifecyclePeriodDuration,
        "compile result",
      ),
      multisigCommitment: comparison(
        deployment.multisigCommitment,
        pauseState.multisigCommitment,
        "MINA Pause Controller state",
      ),
      networkId: comparison(
        intended.networkId,
        accountQuery.networkId,
        "MINA account query",
      ),
      pauseControllerAddress: comparison(
        intended.pauseControllerAddress,
        pauseState.pauseControllerAddress,
        "MINA Pause Controller state",
      ),
      pauseControllerPaused: comparison(
        false,
        pauseState.paused,
        "MINA Pause Controller state",
      ),
      sendPermission: comparison(
        intended.withdrawalPermission,
        accountQuery.sendPermission,
        "MINA account query",
      ),
      treasuryDeployedAtSlot: comparison(
        intended.treasuryDeployedAtSlot,
        ownerState.treasuryDeployedAtSlot,
        "MINA Treasury Owner state",
      ),
      treasuryOwnerAddress: comparison(
        intended.treasuryOwnerAddress,
        ownerState.treasuryOwnerAddress,
        "MINA Treasury Owner state",
      ),
      withdrawalPermission: comparison(
        intended.withdrawalPermission,
        ownerState.withdrawalPermission,
        "MINA Treasury Owner permissions",
      ),
      verificationKeyHashes: {
        stakingLedgerToVotingLedger: comparison(
          verificationKeyHashes.stakingLedgerToVotingLedger,
          proofConfiguration.verificationKeys.stakingLedgerToVotingLedger.hash,
          "browser compile configuration",
        ),
        treasuryOwner: comparison(
          verificationKeyHashes.treasuryOwner,
          accountQuery.treasuryOwnerVerificationKeyHash,
          "MINA Treasury Owner account query",
        ),
        treasuryPauseController: comparison(
          verificationKeyHashes.treasuryPauseController,
          accountQuery.pauseControllerVerificationKeyHash,
          "MINA Pause Controller account query",
        ),
        treasuryProposal: comparison(
          verificationKeyHashes.treasuryProposal,
          proofConfiguration.verificationKeys.treasuryProposal.hash,
          "browser compile configuration",
        ),
        voteReducer: comparison(
          verificationKeyHashes.voteReducer,
          proofConfiguration.verificationKeys.voteReducer.hash,
          "browser compile configuration",
        ),
      },
    },
    deploymentId,
    generatedAt,
    lifecyclePeriodDuration: intended.lifecyclePeriodDuration,
    multisig: {
      commitment: pauseState.multisigCommitment,
      participantsPublicKeys: intended.multisigParticipantsPublicKeys,
      pauseControllerPaused: pauseState.paused,
    },
    networkId: intended.networkId,
    policyConstants: intended.policyConstants,
    proofConfiguration: {
      ...proofConfiguration,
      verificationKeys: {
        ...proofConfiguration.verificationKeys,
        treasuryOwner: {
          hash: verificationKeyHashes.treasuryOwner,
        },
        treasuryPauseController: {
          hash: verificationKeyHashes.treasuryPauseController,
        },
      },
    },
    publicEndpoints: intended.publicEndpoints,
    schemaVersion: 1,
    sourceRevision: intended.sourceRevision,
    treasuryDeployedAtSlot: intended.treasuryDeployedAtSlot,
    transactions: {
      pauseControllerDeployment: deployment.pauseControllerTxHash,
      treasuryOwnerDeployment: deployment.treasuryOwnerTxHash,
    },
    withdrawalPermission: intended.withdrawalPermission,
  };

  const digest = createHash("sha256")
    .update(canonicalJson(publicConfiguration))
    .digest("hex");

  return sortJson({
    digest: {
      algorithm: "sha256",
      scope: "canonical publicConfiguration JSON",
      value: digest,
    },
    publicConfiguration,
  });
}

export async function exportPublicDeploymentConfig({
  force = false,
  inputPath,
  outputPath,
}) {
  const inputText = await readFile(resolve(inputPath), "utf8");
  let input;
  try {
    input = JSON.parse(inputText);
  } catch (error) {
    throw new Error(`Cannot parse ${inputPath} as JSON: ${String(error)}`);
  }

  const record = buildPublicDeploymentRecord(input);
  const resolvedOutput = resolve(
    outputPath ??
      `deployments/${record.publicConfiguration.deploymentId}/public-configuration.json`,
  );
  await mkdir(dirname(resolvedOutput), { recursive: true });
  try {
    await writeFile(resolvedOutput, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: force ? "w" : "wx",
      mode: 0o644,
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(
        `Output already exists: ${resolvedOutput}. Use --force to replace it.`,
      );
    }
    throw error;
  }

  return { outputPath: resolvedOutput, record };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = await exportPublicDeploymentConfig({
      force: options.force,
      inputPath: options.input,
      outputPath: options.output,
    });
    console.log(
      JSON.stringify({
        outputPath: result.outputPath,
        sha256: result.record.digest.value,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
