import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { type ChildProcess } from "node:child_process";
import { Mina, PrivateKey } from "o1js";
import {
  ensureLightnetReady,
  getCurrentGlobalSlot,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  logTestStep,
  MINA_NODE_URL,
  parseTreasuryFundTreasuryResult,
  parseTreasuryOwnerDeployResult,
  parseTreasuryOwnerCompileResult,
  parseTreasuryOwnerStateResult,
  runCli,
  waitForGlobalSlot,
} from "./utils/cli-test-utils.js";

let lightnetProcess: ChildProcess | undefined;
let compileCommandCompleted = false;
let deployedTreasuryOwnerPublicKey: string | undefined;

const TREASURY_OWNER_TEST_NAME = "treasury-owner.test";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for treasury-owner e2e test`);
  }
  return value;
}

const LIFECYCLE_PERIOD_DURATION = requireEnv("LIFECYCLE_PERIOD_DURATION");
const SENDER_PRIVATE_KEY = requireEnv("SENDER_PRIVATE_KEY");
const TRANSFER_AMOUNT = requireEnv("TRANSFER_AMOUNT");

before(async () => {
  logTestStep(TREASURY_OWNER_TEST_NAME, "step 0: setting up Lightnet");
  lightnetProcess = await ensureLightnetReady();
  Mina.setActiveInstance(
    Mina.Network({
      mina: MINA_NODE_URL,
      lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    }),
  );
  logTestStep(TREASURY_OWNER_TEST_NAME, "Lightnet is ready", {
    minaNodeUrl: MINA_NODE_URL,
    lifecyclePeriodDuration: LIFECYCLE_PERIOD_DURATION,
  });
});

after(() => {
  lightnetProcess?.kill("SIGTERM");
});

describe("treasury-owner CLI", { concurrency: 1 }, () => {
  it("compiles treasury owner", async () => {
    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "running treasury-owner compile CLI command",
    );
    const compileStartedAt = Date.now();
    const compileOutput = await runCli(["treasury-owner", "compile"], {
      timeoutMs: 600_000,
      streamOutput: true,
      streamLabel: "treasury-owner compile test",
    });
    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "treasury-owner compile CLI command completed",
      {
        elapsedMs: Date.now() - compileStartedAt,
      },
    );
    const compileResult = parseTreasuryOwnerCompileResult(compileOutput);
    assert(compileResult, "expected treasury-owner compile JSON output");
    assert.strictEqual(
      compileResult.lifecyclePeriodDuration,
      LIFECYCLE_PERIOD_DURATION,
    );
    assert.strictEqual(compileResult.compiled.voteReducerVerificationKey, true);
    assert.strictEqual(
      compileResult.compiled.stakingLedgerToVotingLedgerVerificationKey,
      true,
    );
    assert.strictEqual(
      compileResult.compiled.treasuryProposalVerificationKey,
      true,
    );
    assert.strictEqual(
      compileResult.compiled.treasuryPauseControllerVerificationKey,
      true,
    );
    assert.strictEqual(
      compileResult.compiled.treasuryOwnerVerificationKey,
      true,
    );
    compileCommandCompleted = true;
  });

  it("deploys treasury owner to a new account", async () => {
    assert.strictEqual(
      compileCommandCompleted,
      true,
      "expected compile test to run before deploy test",
    );

    const senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
    const treasuryOwnerPrivateKey = PrivateKey.random();
    const pauseControllerPrivateKey = PrivateKey.random();
    const multisigParticipantsPublicKeys = Array.from({ length: 5 }, () =>
      PrivateKey.random().toPublicKey(),
    );

    const treasuryOwnerPublicKey = treasuryOwnerPrivateKey
      .toPublicKey()
      .toBase58();
    const pauseControllerPublicKey = pauseControllerPrivateKey
      .toPublicKey()
      .toBase58();
    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "prepared treasury-owner deploy inputs",
      {
        senderPublicKey: senderPrivateKey.toPublicKey().toBase58(),
        treasuryOwnerPublicKey,
        pauseControllerPublicKey,
        multisigParticipantsCount: multisigParticipantsPublicKeys.length,
      },
    );

    const treasuryDeployedAtSlot = await getCurrentGlobalSlot();
    logTestStep(TREASURY_OWNER_TEST_NAME, "selected treasury deployment slot", {
      treasuryDeployedAtSlot,
    });

    const deployEnv = {
      TREASURY_OWNER_PRIVATE_KEY: treasuryOwnerPrivateKey.toBase58(),
      PAUSE_CONTROLLER_PRIVATE_KEY: pauseControllerPrivateKey.toBase58(),
      TREASURY_DEPLOYED_AT_SLOT: String(treasuryDeployedAtSlot),
      MULTISIG_PARTICIPANTS_PUBLIC_KEYS: multisigParticipantsPublicKeys
        .map((key) => key.toBase58())
        .join(","),
    };

    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "running treasury-owner deploy CLI command",
    );
    const deployStartedAt = Date.now();
    const output = await runCli(["treasury-owner", "deploy"], {
      timeoutMs: 600_000,
      streamOutput: true,
      streamLabel: "treasury-owner deploy test",
      envOverrides: deployEnv,
    });
    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "treasury-owner deploy CLI command completed",
      {
        elapsedMs: Date.now() - deployStartedAt,
      },
    );

    const deployResult = parseTreasuryOwnerDeployResult(output);
    assert(deployResult, "expected treasury-owner deploy JSON output");
    assert.strictEqual(
      deployResult.treasuryOwnerAddress,
      treasuryOwnerPublicKey,
    );
    assert.strictEqual(
      deployResult.pauseControllerAddress,
      pauseControllerPublicKey,
    );
    assert(
      deployResult.pauseControllerTxHash,
      "expected pause controller tx hash",
    );
    assert(deployResult.treasuryOwnerTxHash, "expected treasury owner tx hash");
    deployedTreasuryOwnerPublicKey = deployResult.treasuryOwnerAddress;

    const stateOutput = await runCli(["treasury-owner", "read-state"], {
      timeoutMs: 120_000,
      streamOutput: true,
      streamLabel: "treasury-owner state test",
      envOverrides: {
        TREASURY_OWNER_PUBLIC_KEY: treasuryOwnerPublicKey,
      },
    });
    const stateResult = parseTreasuryOwnerStateResult(stateOutput);
    assert(stateResult, "expected treasury-owner state JSON output");
    assert.strictEqual(stateResult.treasuryOwnerAddress, treasuryOwnerPublicKey);
    assert.strictEqual(
      stateResult.pauseControllerPublicKey,
      pauseControllerPublicKey,
    );
    assert.strictEqual(
      stateResult.treasuryDeployedAtSlot,
      String(treasuryDeployedAtSlot),
    );
    assert(
      stateResult.currentLifecyclePeriod,
      "expected currentLifecyclePeriod in treasury-owner state output",
    );
    assert.strictEqual(
      stateResult.currentLifecyclePeriod.treasuryOwnerAddress,
      treasuryOwnerPublicKey,
    );
    assert.strictEqual(
      stateResult.currentLifecyclePeriod.treasuryDeployedAtSlot,
      String(treasuryDeployedAtSlot),
    );
    assert.strictEqual(
      stateResult.currentLifecyclePeriod.lifecyclePeriodDuration,
      LIFECYCLE_PERIOD_DURATION,
    );
    assert.strictEqual(stateResult.currentLifecyclePeriod.lifecycleStarted, true);
    assert(
      Number(stateResult.currentLifecyclePeriod.currentGlobalSlot) >=
        treasuryDeployedAtSlot,
      "expected current global slot to be at or after treasury deployment slot",
    );

    const currentSlot = await getCurrentGlobalSlot();
    logTestStep(TREASURY_OWNER_TEST_NAME, "waiting for post-deploy block", {
      targetSlot: currentSlot + 1,
    });
    await waitForGlobalSlot(currentSlot + 1, 120_000);
    logTestStep(TREASURY_OWNER_TEST_NAME, "post-deploy block reached");

    assert.match(output, /"treasuryOwnerAddress"/);
    assert.match(output, /treasuryOwner/);
    assert.match(output, new RegExp(treasuryOwnerPublicKey));
    assert.match(output, new RegExp(pauseControllerPublicKey));
  });

  it("funds treasury owner from whale account", async () => {
    assert(
      deployedTreasuryOwnerPublicKey,
      "expected treasury owner deploy step to run before funding step",
    );

    const senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
    const fundEnv = {
      TREASURY_OWNER_PUBLIC_KEY: deployedTreasuryOwnerPublicKey,
    };

    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "running treasury-owner fund-treasury CLI command",
      {
        treasuryOwnerPublicKey: deployedTreasuryOwnerPublicKey,
        amount: TRANSFER_AMOUNT,
      },
    );
    const fundStartedAt = Date.now();
    const fundOutput = await runCli(["treasury-owner", "fund-treasury"], {
      timeoutMs: 600_000,
      streamOutput: true,
      streamLabel: "treasury-owner fund-treasury test",
      envOverrides: fundEnv,
    });
    logTestStep(
      TREASURY_OWNER_TEST_NAME,
      "treasury-owner fund-treasury CLI command completed",
      {
        elapsedMs: Date.now() - fundStartedAt,
      },
    );

    const fundResult = parseTreasuryFundTreasuryResult(fundOutput);
    assert(fundResult, "expected treasury fund JSON output");
    assert.strictEqual(
      fundResult.sender,
      senderPrivateKey.toPublicKey().toBase58(),
    );
    assert.strictEqual(
      fundResult.fundingAccount,
      senderPrivateKey.toPublicKey().toBase58(),
    );
    assert.strictEqual(
      fundResult.from,
      senderPrivateKey.toPublicKey().toBase58(),
    );
    assert.strictEqual(fundResult.to, deployedTreasuryOwnerPublicKey);
    assert.strictEqual(fundResult.amount, TRANSFER_AMOUNT);
    assert(fundResult.transferTxHash, "expected fund transaction hash");

    const currentSlot = await getCurrentGlobalSlot();
    logTestStep(TREASURY_OWNER_TEST_NAME, "waiting for post-fund block", {
      targetSlot: currentSlot + 1,
    });
    await waitForGlobalSlot(currentSlot + 1, 120_000);
    logTestStep(TREASURY_OWNER_TEST_NAME, "post-fund block reached");
  });
});
