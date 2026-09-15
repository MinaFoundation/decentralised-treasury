import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { describe, it } from "node:test";
import { Field, PrivateKey, Signature, UInt32 } from "o1js";

import { loadApiConfig } from "../../../apps/api/src/config.js";
import { minaNetworkIdOption } from "../../../apps/cli/src/commands/mina-instance.js";
import {
  createLedgerTransactionSigner,
  resolveSigningAccount,
  selectTransactionLedgerAccountIndices,
} from "../../../apps/cli/src/ledger/transaction-signer.js";
import { RUNTIME_CONFIG_FIELDS } from "../../../apps/web/features/runtime-config/lib/runtime-config-fields.js";
import { buildPublicDeploymentRecord } from "../../scripts/export-public-deployment-config.mjs";
import { signFieldWithLedgerClient } from "../../../packages/sdk/src/signing/ledger-signing.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "../../../packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { StakingLedgerToVotingLedger } from "../../../packages/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { VoteReducer } from "../../../packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SqliteStakingLedgerToVotingLedgerService } from "../../../packages/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { SqliteVoteReducerService } from "../../../packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TREASURY_OWNER_ADDRESS =
  "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB";

function deterministicPrivateKey(index) {
  return PrivateKey.fromBigInt(BigInt(90_000 + index));
}

function verificationKey(name, hash) {
  return { data: `${name}-verification-key`, hash: String(hash) };
}

function deploymentFixture() {
  const keys = Array.from({ length: 7 }, (_, index) =>
    deterministicPrivateKey(index).toPublicKey().toBase58(),
  );
  const [treasuryOwnerAddress, pauseControllerAddress, ...participants] = keys;
  return {
    deploymentId: "assurance-testnet-001",
    generatedAt: "2026-09-10T08:00:00Z",
    intended: {
      buildIdentity: "sha256:caller-intent-build",
      lifecyclePeriodDuration: "7140",
      multisigParticipantsPublicKeys: participants,
      networkId: "testnet",
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
        archiveNode: "https://archive.assurance.invalid/graphql",
        backoffice: "https://backoffice.assurance.invalid",
        indexerApi: "https://indexer.assurance.invalid",
        minaNode: "https://mina.assurance.invalid/graphql",
        processorApi: "https://processor.assurance.invalid",
        treasuryApi: "https://api.assurance.invalid",
        web: "https://web.assurance.invalid",
      },
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      treasuryDeployedAtSlot: "14280",
      treasuryOwnerAddress,
      withdrawalPermission: "proofOrSignature",
    },
    compileResult: {
      lifecyclePeriodDuration: "7140",
      browserCompileConfig: {
        lifecyclePeriodDuration: "7140",
        emptyNullifierRoot: "4002",
        emptyVotingLedgerRoot: "4001",
        stakingLedgerToVotingLedgerVerificationKeyJson: verificationKey(
          "staking-ledger-to-voting-ledger",
          1002,
        ),
        treasuryProposalVerificationKeyJson: verificationKey(
          "treasury-proposal",
          1003,
        ),
        voteReducerVerificationKeyJson: verificationKey("vote-reducer", 1001),
      },
      verificationKeyHashes: {
        stakingLedgerToVotingLedger: "1002",
        treasuryOwner: "5001",
        treasuryPauseController: "5002",
        treasuryProposal: "1003",
        voteReducer: "1001",
      },
    },
    deploymentResult: {
      multisigCommitment: "6001",
      pauseControllerAddress,
      pauseControllerTxHash: "pause-transaction-hash",
      treasuryOwnerAddress,
      treasuryOwnerTxHash: "owner-transaction-hash",
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
    },
    accountQuery: {
      accessPermission: "proofOrSignature",
      networkId: "testnet",
      nonce: "44",
      pauseControllerAddress,
      pauseControllerVerificationKeyHash: "5002",
      sendPermission: "proofOrSignature",
      treasuryOwnerAddress,
      treasuryOwnerVerificationKeyHash: "5001",
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function fieldFromLedgerBytes(bytes) {
  return Field(
    [...bytes].reduceRight((result, byte) => (result << 8n) + BigInt(byte), 0n),
  );
}

function softwareLedger(privateKeysByIndex, overrides = {}) {
  return {
    async getAddress(account) {
      const privateKey = privateKeysByIndex.get(account);
      if (!privateKey)
        throw new Error(`Unknown mock Ledger account ${account}`);
      return {
        returnCode: "9000",
        publicKey: privateKey.toPublicKey().toBase58(),
      };
    },
    async signFieldElement(account, networkId, bytes) {
      const privateKey = privateKeysByIndex.get(account);
      if (!privateKey)
        throw new Error(`Unknown mock Ledger account ${account}`);
      assert.equal(networkId, 0);
      const signature = Signature.create(privateKey, [
        fieldFromLedgerBytes(bytes),
      ]).toJSON();
      return {
        returnCode: "9000",
        field: signature.r,
        scalar: signature.s,
      };
    },
    ...overrides,
  };
}

function transactionShape(feePayer, accountUpdates) {
  return {
    toJSON() {
      return JSON.stringify({
        feePayer: { body: { publicKey: feePayer }, authorization: "" },
        accountUpdates,
      });
    },
  };
}

async function readRepositorySource(path) {
  return await readFile(new URL(path, `file://${REPOSITORY_ROOT}/`), "utf8");
}

function compact(source) {
  return source.replace(/\s+/gu, " ");
}

describe("proof-off caller intent", () => {
  it("requires the proof-off process contract", () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
  });

  it("CALL-INTENT-002 rejects invalid shared deployment configuration", () => {
    const cases = [
      {
        name: "missing network",
        mutate(input) {
          delete input.intended.networkId;
        },
        error: /intended\.networkId must be a nonempty string/,
      },
      {
        name: "blank verification key",
        mutate(input) {
          input.compileResult.browserCompileConfig.voteReducerVerificationKeyJson.data =
            "";
        },
        error: /voteReducerVerificationKeyJson\.data must be a nonempty string/,
      },
      {
        name: "malformed network",
        mutate(input) {
          input.intended.networkId = "berkeley";
        },
        error: /must be mainnet, devnet, or testnet/,
      },
      {
        name: "conflicting observed network",
        mutate(input) {
          input.accountQuery.networkId = "devnet";
        },
        error: /networkId in accountQuery mismatch/,
      },
      {
        name: "credential-bearing public URL",
        mutate(input) {
          input.intended.publicEndpoints.web =
            "https://operator:secret@web.assurance.invalid";
        },
        error: /must not contain credentials/,
      },
      {
        name: "duplicate multisig participant",
        mutate(input) {
          input.intended.multisigParticipantsPublicKeys[4] =
            input.intended.multisigParticipantsPublicKeys[0];
        },
        error: /must contain five distinct public keys/,
      },
    ];

    for (const scenario of cases) {
      const input = clone(deploymentFixture());
      scenario.mutate(input);
      assert.throws(
        () => buildPublicDeploymentRecord(input),
        scenario.error,
        scenario.name,
      );
    }
  });

  it("CALL-INTENT-004 validates UInt32 lifecycle boundaries", () => {
    const maximum = 0xffff_ffffn;
    const cases = [
      { value: 0n, accepted: false },
      { value: 1n, accepted: true },
      { value: maximum - 1n, accepted: true },
      { value: maximum, accepted: true },
      { value: maximum + 1n, accepted: false },
    ];

    for (const scenario of cases) {
      const input = clone(deploymentFixture());
      const value = scenario.value.toString();
      input.intended.lifecyclePeriodDuration = value;
      input.compileResult.lifecyclePeriodDuration = value;
      input.compileResult.browserCompileConfig.lifecyclePeriodDuration = value;
      if (scenario.accepted) {
        const record = buildPublicDeploymentRecord(input);
        assert.equal(record.publicConfiguration.lifecyclePeriodDuration, value);
      } else {
        assert.throws(
          () => buildPublicDeploymentRecord(input),
          /must be at least 1|must not exceed 4294967295/,
          value,
        );
      }
    }
  });

  it("CALL-INTENT-001 selects one deployment intent across API, Web, and DevOps", async () => {
    class TreasuryOwnerContractShape {
      events = {
        treasuryConfigured: {},
        treasuryCreated: {},
      };

      constructor(_publicKey) {}
    }

    const apiConfig = loadApiConfig(
      { treasuryOwnerContractClass: TreasuryOwnerContractShape },
      {
        ARCHIVE_NODE_URL: "https://archive.assurance.invalid/graphql",
        DATABASE_URL: "postgres://assurance.invalid/treasury",
        PROOFS_ENABLED: "false",
        TREASURY_OWNER_CONTRACT_ADDRESS: TREASURY_OWNER_ADDRESS,
      },
    );

    assert.deepEqual(apiConfig.knownEventTypes, [
      "treasuryConfigured",
      "treasuryCreated",
    ]);
    assert.equal(
      apiConfig.treasuryOwnerContractAddress,
      TREASURY_OWNER_ADDRESS,
    );
    assert.equal(
      apiConfig.archiveNodeUrl,
      "https://archive.assurance.invalid/graphql",
    );

    const browserFields = [
      ["proofsEnabled", ["NEXT_PUBLIC_PROOFS_ENABLED"]],
      [
        "treasuryOwnerContractAddress",
        [
          "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
          "TREASURY_OWNER_CONTRACT_ADDRESS",
        ],
      ],
      [
        "lifecyclePeriodDuration",
        ["NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION", "LIFECYCLE_PERIOD_DURATION"],
      ],
      [
        "stakingLedgerToVotingLedgerVerificationKeyJson",
        ["NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON"],
      ],
      ["emptyVotingLedgerRoot", ["NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT"]],
      ["emptyNullifierRoot", ["NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT"]],
    ];

    for (const [field, expectedNames] of browserFields) {
      assert.deepEqual(RUNTIME_CONFIG_FIELDS[field].envNames, expectedNames);
    }

    // Source characterization: create-testnet-env.mjs calls main() on import.
    const devopsSource = await readRepositorySource(
      "devops/scripts/create-testnet-env.mjs",
    );
    const proofModeWrites = [
      'formatEnvLine("PROOFS_ENABLED", options.proofsEnabled)',
      'formatEnvLine("NEXT_PUBLIC_PROOFS_ENABLED", options.proofsEnabled)',
    ];
    for (const write of proofModeWrites) {
      assert.ok(devopsSource.includes(write), write);
    }
    assert.equal(
      devopsSource.match(
        /formatEnvLine\("PROOFS_ENABLED", options\.proofsEnabled\)/gu,
      )?.length,
      3,
      "API, CLI, and LocalBlockchain must receive the same proof-mode option",
    );
  });

  it("CALL-INTENT-003 gives explicit CLI network input precedence over the environment", () => {
    const previousNetworkId = process.env.MINA_NETWORK_ID;
    process.env.MINA_NETWORK_ID = "testnet";

    try {
      const cases = [
        { input: "MAINNET", expected: "mainnet" },
        { input: "devnet", expected: "devnet" },
        { input: "TeStNeT", expected: "testnet" },
      ];

      for (const testCase of cases) {
        const program = new Command()
          .exitOverride()
          .addOption(minaNetworkIdOption());
        program.parse(["--network-id", testCase.input], { from: "user" });
        assert.equal(
          program.opts().networkId,
          testCase.expected,
          testCase.input,
        );
      }
    } finally {
      if (previousNetworkId === undefined) {
        delete process.env.MINA_NETWORK_ID;
      } else {
        process.env.MINA_NETWORK_ID = previousNetworkId;
      }
    }
  });

  it("CALL-INTENT-005 installs Web config before the dynamic prover import (source characterization)", async () => {
    // Importing this worker installs self.onmessage and needs a Web Worker
    // global. Read its source to characterize the entry order.
    const workerSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/workers/treasury-proposal.worker.ts",
      ),
    );
    const handlerStart = workerSource.indexOf(
      "self.onmessage = async (event: MessageEvent<ProposalProverWorkerRequest>) => {",
    );
    const configInstall = workerSource.indexOf(
      "adoptRuntimeConfig(message.runtimeConfig);",
      handlerStart,
    );
    const firstDispatch = workerSource.indexOf(
      'if (message.type === "getStatus")',
      handlerStart,
    );

    assert.ok(handlerStart >= 0, "worker request handler");
    assert.ok(configInstall > handlerStart, "runtime config install");
    assert.ok(firstDispatch > configInstall, "config precedes dispatch");
    assert.ok(
      workerSource.includes(
        'proposalProverRuntimePromise ??= import("../lib/proposal-prover-runtime")',
      ),
      "lazy prover runtime import",
    );
  });

  it("CALL-INTENT-006 passes proof-off mode through service compile boundaries", async () => {
    const observed = [];
    const originalStakingCompile = StakingLedgerToVotingLedger.compile;
    const originalVoteCompile = VoteReducer.compile;

    StakingLedgerToVotingLedger.compile = async (options) => {
      observed.push({
        service: "staking-ledger-to-voting-ledger",
        proofsEnabled: options.proofsEnabled,
      });
      return undefined;
    };
    VoteReducer.compile = async (options) => {
      observed.push({
        service: "vote-reducer",
        proofsEnabled: options.proofsEnabled,
      });
      return undefined;
    };

    try {
      await new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId: "caller-intent-staking",
      }).compile();
      await new SqliteVoteReducerService({
        lifecycleId: "caller-intent-vote",
      }).compile();
    } finally {
      StakingLedgerToVotingLedger.compile = originalStakingCompile;
      VoteReducer.compile = originalVoteCompile;
    }

    assert.deepEqual(observed, [
      {
        service: "staking-ledger-to-voting-ledger",
        proofsEnabled: false,
      },
      { service: "vote-reducer", proofsEnabled: false },
    ]);
  });

  it("CALL-INTENT-007 requires proof-shaped updates for create, vote, and execute (source characterization)", async () => {
    const runtimeSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/lib/proposal-prover-runtime.ts",
      ),
    );
    const flows = [
      {
        name: "create",
        start:
          "export async function buildAndProveCreateProposalTransactionInCurrentThread",
        end: "async function constructCreateProposalTransactionInCurrentThread",
      },
      {
        name: "vote",
        start:
          "export async function buildAndProveVoteProposalTransactionInCurrentThread",
        end: "async function constructVoteProposalTransactionInCurrentThread",
      },
      {
        name: "execute",
        start:
          "export async function buildAndProveExecuteProposalTransactionInCurrentThread",
        end: "async function constructExecuteProposalTransactionInCurrentThread",
      },
    ];

    for (const flow of flows) {
      const start = runtimeSource.indexOf(flow.start);
      const end = runtimeSource.indexOf(flow.end, start);
      assert.ok(start >= 0 && end > start, flow.name);
      const implementation = runtimeSource.slice(start, end);
      assert.ok(
        implementation.includes("await constructed.transaction.prove();"),
        `${flow.name} prove call`,
      );
      assert.ok(
        implementation.includes("assertProofsPresent("),
        `${flow.name} proof-presence guard`,
      );
    }
  });

  it("CALL-INTENT-008 keeps signer identities explicit through worker and wallet boundaries (source characterization)", async () => {
    const workerSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/workers/treasury-proposal.worker.ts",
      ),
    );
    const runtimeSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/lib/proposal-prover-runtime.ts",
      ),
    );
    const walletSource = compact(
      await readRepositorySource(
        "apps/web/features/wallet/providers/auro-wallet-client.ts",
      ),
    );

    for (const requestType of [
      "buildAndProveCreateProposal",
      "buildAndProveVoteProposal",
      "buildAndProveExecuteProposal",
    ]) {
      const start = workerSource.indexOf(`message.type === "${requestType}"`);
      assert.ok(start >= 0, requestType);
      assert.ok(
        workerSource.indexOf(
          "senderAddress: message.input.senderAddress",
          start,
        ) > start,
        `${requestType} sender identity`,
      );
    }
    assert.ok(
      runtimeSource.includes(
        "constructed.transaction.sign([constructed.proposalPrivateKey]);",
      ),
      "create identifies the generated proposal signer",
    );
    assert.ok(
      walletSource.includes(
        "readFeePayer(input.transactionJson) !== input.expectedSenderAddress",
      ),
      "wallet checks the expected fee payer",
    );
    assert.ok(
      walletSource.includes("selectedAddress !== input.expectedSenderAddress"),
      "wallet checks the selected signer",
    );
  });

  it("CALL-INTENT-009 records the missing authorization-kind snapshot guard (source characterization)", async () => {
    const runtimeSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/lib/proposal-prover-runtime.ts",
      ),
    );
    const walletSource = compact(
      await readRepositorySource(
        "apps/web/features/wallet/providers/auro-wallet-client.ts",
      ),
    );
    const guardStart = runtimeSource.indexOf("function assertProofsPresent(");
    const guardEnd = runtimeSource.indexOf(
      "let compileContractsPromise",
      guardStart,
    );
    assert.ok(guardStart >= 0 && guardEnd > guardStart);
    const guard = runtimeSource.slice(guardStart, guardEnd);

    assert.ok(
      guard.includes("accountUpdate.isProved && !accountUpdate.hasProof"),
    );
    assert.equal(
      guard.includes("expectedAuthorizationKind"),
      false,
      "The proof guard has no expected authorization-kind snapshot",
    );
    assert.equal(
      walletSource.includes("authorizationKind"),
      false,
      "The wallet boundary does not compare authorization kinds",
    );
  });

  it("CALL-INTENT-010 keys Web compile reuse by mode and keeps worker tasks on the inherited mode (source characterization)", async () => {
    // The Web worker is an entry point, and worker-job-process.ts exits when
    // it has no task-module argument. Characterize these process seams.
    const webWorkerSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/workers/treasury-proposal.worker.ts",
      ),
    );
    assert.ok(
      webWorkerSource.includes(
        "compileArtifacts && compileProofsEnabled === proofsEnabled",
      ),
      "compile reuse checks the requested mode",
    );
    assert.ok(
      webWorkerSource.includes("compileProofsEnabled = proofsEnabled;"),
      "compiled artifacts record their mode",
    );

    const workerSource = compact(
      await readRepositorySource("packages/sdk/src/proving/worker.ts"),
    );
    const forkStart = workerSource.indexOf("fork(workerProcessPath");
    const forkEnd = workerSource.indexOf("); this.subprocess", forkStart);
    assert.ok(forkStart >= 0 && forkEnd > forkStart, "worker fork call");
    assert.ok(
      !workerSource.slice(forkStart, forkEnd).includes("env:"),
      "the child inherits the controller environment",
    );

    const taskPaths = [
      "packages/sdk/src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.ts",
      "packages/sdk/src/proving/tasks/staking-ledger-to-voting-ledger-merge-task.ts",
      "packages/sdk/src/proving/tasks/vote-reducer-run-batch-task.ts",
      "packages/sdk/src/proving/tasks/vote-reducer-merge-task.ts",
    ];
    for (const path of taskPaths) {
      const taskSource = compact(await readRepositorySource(path));
      assert.ok(
        taskSource.includes(
          'const proofsEnabled = process.env.PROOFS_ENABLED === "true";',
        ),
        path,
      );
      assert.ok(taskSource.includes("proofsEnabled,"), path);
    }
  });

  it("CALL-INTENT-011 records cancellation cleanup and the missing request timeout (source characterization)", async () => {
    const hookSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/hooks/use-proposal-prover-worker.ts",
      ),
    );
    assert.ok(
      hookSource.includes('signal?.addEventListener("abort", handleAbort'),
      "abort listener",
    );
    assert.ok(
      hookSource.includes("workerRef.current?.terminate();"),
      "worker termination",
    );
    assert.ok(
      hookSource.includes("pendingRequestsRef.current.clear();"),
      "pending request cleanup",
    );
    assert.equal(
      hookSource.includes("setTimeout("),
      false,
      "The worker request path has no internal timeout",
    );
  });

  it("CALL-INTENT-012 records same-mode stale compile reuse after config change (source characterization)", async () => {
    const workerSource = compact(
      await readRepositorySource(
        "apps/web/features/proposals/workers/treasury-proposal.worker.ts",
      ),
    );
    const reuseStart = workerSource.indexOf(
      "if (compileArtifacts && compileProofsEnabled === proofsEnabled)",
    );
    const reuseEnd = workerSource.indexOf("status = {", reuseStart);
    const reuseCondition = workerSource.slice(reuseStart, reuseEnd);

    assert.ok(reuseStart >= 0 && reuseEnd > reuseStart);
    assert.ok(
      workerSource.includes("adoptRuntimeConfig(message.runtimeConfig);"),
      "each request installs its current config",
    );
    assert.equal(
      reuseCondition.includes("runtimeConfig"),
      false,
      "Compile reuse does not bind the current runtime config",
    );
  });

  it("CALL-INTENT-013 keeps software and mock Ledger signing intent equal", async () => {
    const participantKeys = Array.from({ length: 5 }, (_, index) =>
      deterministicPrivateKey(100 + index),
    );
    const signerIndex = 2;
    const signerKey = participantKeys[signerIndex];
    const ledgerAccountIndex = 23;
    const baseLedger = softwareLedger(
      new Map([[ledgerAccountIndex, signerKey]]),
    );
    const observedLedgerSignings = [];
    const ledger = {
      async getAddress(account, showOnDevice) {
        return await baseLedger.getAddress(account, showOnDevice);
      },
      async signFieldElement(account, networkId, bytes) {
        observedLedgerSignings.push({
          account,
          networkId,
          dataHash: fieldFromLedgerBytes(bytes).toString(),
        });
        return await baseLedger.signFieldElement(account, networkId, bytes);
      },
    };
    const nextParticipantKeys = Array.from({ length: 5 }, (_, index) =>
      deterministicPrivateKey(200 + index).toPublicKey(),
    );
    const currentPublicKeys = participantKeys.map((key) => key.toPublicKey());
    const proposalPublicKey = deterministicPrivateKey(300).toPublicKey();
    const cases = [
      {
        type: "pause-treasury",
        dataHash: MultisigSignature.dataPauseTreasury(UInt32.from(0)),
      },
      {
        type: "unpause-treasury",
        dataHash: MultisigSignature.dataUnpauseTreasury(
          UInt32.from(0xffff_ffff),
        ),
      },
      {
        type: "toggle-pause-proposal",
        dataHash: MultisigSignature.dataTogglePauseProposal(
          proposalPublicKey,
          UInt32.from(71),
        ),
      },
      {
        type: "rotate-multisig-keys",
        dataHash: MultisigSignature.dataRotateMultisigKeys(
          MultisigSignatures.createCommitment(currentPublicKeys),
          MultisigSignatures.createCommitment(nextParticipantKeys),
          UInt32.from(97),
        ),
      },
    ];

    for (const scenario of cases) {
      const softwareSignature = Signature.create(signerKey, [
        scenario.dataHash,
      ]);
      const ledgerSignature = await signFieldWithLedgerClient(
        scenario.dataHash,
        ledger,
        signerKey.toPublicKey(),
        ledgerAccountIndex,
      );
      const softwareIntent = {
        type: scenario.type,
        dataHash: scenario.dataHash.toString(),
        signerPublicKey: signerKey.toPublicKey().toBase58(),
        signerParticipantIndex: signerIndex,
      };
      const ledgerCall = observedLedgerSignings.at(-1);
      const ledgerIntent = {
        type: scenario.type,
        dataHash: ledgerCall?.dataHash,
        signerPublicKey: signerKey.toPublicKey().toBase58(),
        signerParticipantIndex: signerIndex,
      };

      assert.deepEqual(ledgerIntent, softwareIntent);
      assert.equal(ledgerCall?.account, ledgerAccountIndex);
      assert.equal(ledgerCall?.networkId, 0);
      assert.equal(
        softwareSignature
          .verify(signerKey.toPublicKey(), [scenario.dataHash])
          .toBoolean(),
        true,
        `${scenario.type} software signature`,
      );
      assert.equal(
        ledgerSignature
          .verify(signerKey.toPublicKey(), [scenario.dataHash])
          .toBoolean(),
        true,
        `${scenario.type} Ledger signature`,
      );
    }
  });

  it("CALL-INTENT-014 maps every signer position and excludes value-only recipients", async () => {
    const keys = Array.from({ length: 4 }, (_, index) =>
      deterministicPrivateKey(400 + index).toPublicKey(),
    );
    const indices = [0, 19, 0xffff_ffff];
    const accounts = indices.map((ledgerAccountIndex, index) =>
      resolveSigningAccount({
        signer: "ledger",
        label: `Signer ${index}`,
        publicKey: keys[index],
        ledgerAccountIndex,
      }),
    );
    const configured = new Map(
      accounts.map((account) => [
        account.publicKey.toBase58(),
        account.ledgerAccountIndex,
      ]),
    );
    const cases = [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
    ];

    for (const order of cases) {
      const feePayer = keys[order[0]].toBase58();
      const signedUpdates = order.slice(1).map((index) => ({
        body: {
          publicKey: keys[index].toBase58(),
          authorizationKind: { isSigned: true },
        },
      }));
      const valueOnlyRecipient = {
        body: {
          publicKey: keys[3].toBase58(),
          authorizationKind: { isSigned: false },
        },
      };
      const transaction = transactionShape(feePayer, [
        valueOnlyRecipient,
        ...signedUpdates,
      ]);
      const selected = selectTransactionLedgerAccountIndices(
        transaction,
        configured,
      );
      assert.deepEqual(
        [...selected].sort((left, right) => left[1] - right[1]),
        [...configured].sort((left, right) => left[1] - right[1]),
      );
      assert.equal(selected.has(keys[3].toBase58()), false);
    }
  });

  it("CALL-INTENT-015 records same-key role collision behavior", async () => {
    const first = deterministicPrivateKey(500).toPublicKey();
    const second = deterministicPrivateKey(501).toPublicKey();
    const account = (label, publicKey, ledgerAccountIndex) => ({
      label,
      publicKey,
      ledgerAccountIndex,
    });
    const calls = [];
    const acceptedSigner = createLedgerTransactionSigner(
      "ledger",
      [account("Sender", first, 7), account("Funding", first, 7)],
      "testnet",
      async (transaction, indices, networkId) => {
        calls.push({ indices: [...indices], networkId });
        return transaction;
      },
    );
    assert.ok(acceptedSigner);
    await acceptedSigner(
      transactionShape(first.toBase58(), [
        {
          body: {
            publicKey: first.toBase58(),
            authorizationKind: { isSigned: true },
          },
        },
      ]),
    );
    assert.deepEqual(calls, [
      { indices: [[first.toBase58(), 7]], networkId: "testnet" },
    ]);

    assert.throws(
      () =>
        createLedgerTransactionSigner("ledger", [
          account("Sender", first, 7),
          account("Owner", first, 8),
        ]),
      /cannot use both account indices 7 and 8/,
    );
    assert.throws(
      () =>
        createLedgerTransactionSigner("ledger", [
          account("Sender", first, 7),
          account("Owner", second, 7),
        ]),
      /cannot identify both/,
    );
  });

  it("CALL-INTENT-016 rejects wrong Ledger accounts and payloads and records the fixed field network", async () => {
    const expectedKey = deterministicPrivateKey(600);
    const wrongKey = deterministicPrivateKey(601);
    const accountIndex = 31;
    const dataHash = MultisigSignature.dataPauseTreasury(UInt32.from(113));
    const cases = [
      {
        name: "wrong account public key",
        ledger: softwareLedger(new Map([[accountIndex, wrongKey]])),
        index: accountIndex,
        error: /returned .* expected/,
      },
      {
        name: "negative account index",
        ledger: softwareLedger(new Map([[accountIndex, expectedKey]])),
        index: -1,
        error: /integer from 0 through 4294967295/,
      },
      {
        name: "overflow account index",
        ledger: softwareLedger(new Map([[accountIndex, expectedKey]])),
        index: 0x1_0000_0000,
        error: /integer from 0 through 4294967295/,
      },
      {
        name: "signature for changed payload",
        ledger: softwareLedger(new Map([[accountIndex, expectedKey]]), {
          async signFieldElement(_account, networkId, bytes) {
            assert.equal(networkId, 0);
            const signature = Signature.create(expectedKey, [
              fieldFromLedgerBytes(bytes).add(1),
            ]).toJSON();
            return {
              returnCode: "9000",
              field: signature.r,
              scalar: signature.s,
            };
          },
        }),
        index: accountIndex,
        error: /invalid field signature/,
      },
    ];

    for (const scenario of cases) {
      await assert.rejects(
        () =>
          signFieldWithLedgerClient(
            dataHash,
            scenario.ledger,
            expectedKey.toPublicKey(),
            scenario.index,
          ),
        scenario.error,
        scenario.name,
      );
    }

    const signingSource = compact(
      await readRepositorySource("packages/sdk/src/signing/ledger-signing.ts"),
    );
    assert.ok(
      signingSource.includes(
        "const signature = await signFieldAtAccount(ledger, account, field, 0);",
      ),
      "break-glass field signing always sends Ledger network ID 0",
    );
  });

  it("CALL-INTENT-017 rejects Ledger device faults without an accepted partial signature", async () => {
    const signerKey = deterministicPrivateKey(700);
    const accountIndex = 41;
    const dataHash = MultisigSignature.dataUnpauseTreasury(UInt32.from(127));
    const baseKeys = new Map([[accountIndex, signerKey]]);
    const cases = [
      {
        name: "disconnect",
        ledger: softwareLedger(baseKeys, {
          async getAddress() {
            throw new Error("Ledger disconnected");
          },
        }),
        error: /disconnected/,
      },
      {
        name: "user refusal",
        ledger: softwareLedger(baseKeys, {
          async getAddress() {
            return { returnCode: "6985", message: "User denied" };
          },
        }),
        error: /User denied/,
      },
      {
        name: "transport timeout",
        ledger: softwareLedger(baseKeys, {
          async signFieldElement() {
            throw new Error("Ledger transport timeout");
          },
        }),
        error: /timeout/,
      },
      {
        name: "partial signature response",
        ledger: softwareLedger(baseKeys, {
          async signFieldElement() {
            return {
              returnCode: "9000",
              field: "1",
              scalar: null,
            };
          },
        }),
        error: /field signing failed/,
      },
    ];
    const accepted = [];

    for (const scenario of cases) {
      await assert.rejects(
        async () => {
          const signature = await signFieldWithLedgerClient(
            dataHash,
            scenario.ledger,
            signerKey.toPublicKey(),
            accountIndex,
          );
          accepted.push(signature.toBase58());
        },
        scenario.error,
        scenario.name,
      );
    }
    assert.deepEqual(accepted, []);
  });

  it("CALL-INTENT-018 records physical Ledger evidence as not applicable", () => {
    const record = {
      outcome: "not-applicable",
      evidence: "No physical Ledger device is available in hosted CI.",
      simulated: false,
    };

    assert.deepEqual(record, {
      outcome: "not-applicable",
      evidence: "No physical Ledger device is available in hosted CI.",
      simulated: false,
    });
  });
});
