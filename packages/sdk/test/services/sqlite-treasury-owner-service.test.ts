import { it } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { Mina, PrivateKey, PublicKey, UInt32 } from "o1js";
import { SqliteTreasuryOwnerService } from "../../src/services/sqlite/sqlite-treasury-owner-service.js";

const LIGHTNET_SQLITE_DATA_DIRECTORY = join(
  new URL("../../../cli/test/fixtures/.data/sqlite/", import.meta.url).pathname,
);
const TREASURY_OWNER_COMPILE_CACHE_DIRECTORY = join(
  new URL("../.data/cache/sqlite-treasury-owner-service", import.meta.url).pathname,
);

function logStep(message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  if (details === undefined) {
    console.log(`[sqlite-treasury-owner-service.test ${timestamp}] ${message}`);
    return;
  }
  console.log(`[sqlite-treasury-owner-service.test ${timestamp}] ${message}`, details);
}

it("supports compile with service-level progress logging", async () => {
  const service = new SqliteTreasuryOwnerService();
  logStep("starting compile test", {
    proofsEnabled: false,
    cachePath: TREASURY_OWNER_COMPILE_CACHE_DIRECTORY,
  });
  const startedAt = Date.now();
  const compileResult = await service.compile({
    proofsEnabled: false,
    cachePath: TREASURY_OWNER_COMPILE_CACHE_DIRECTORY,
  });
  logStep("compile test finished", {
    elapsedMs: Date.now() - startedAt,
  });

  assert(compileResult.voteReducerVerificationKey);
  assert(compileResult.stakingLedgerToVotingLedgerVerificationKey);
  assert(compileResult.treasuryProposalVerificationKey);
  assert(compileResult.treasuryPauseControllerVerificationKey);
  assert(compileResult.treasuryOwnerVerificationKey);
});

it("extracts treasury-owner witness from sqlite staking ledger fixture", async () => {
  const service = new SqliteTreasuryOwnerService();
  const treasuryOwnerPublicKey = PublicKey.fromBase58(
    "B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g",
  );
  const previousSqliteDataDirectory = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = LIGHTNET_SQLITE_DATA_DIRECTORY;

  try {
    const {
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
    } = await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
      "0",
      treasuryOwnerPublicKey,
    );

    assert(treasuryOwnerAccount.pk.equals(treasuryOwnerPublicKey).toBoolean());
    assert(treasuryOwnerAccountWitness);
  } finally {
    if (previousSqliteDataDirectory === undefined) {
      delete process.env.SQLITE_DATA_DIRECTORY;
    } else {
      process.env.SQLITE_DATA_DIRECTORY = previousSqliteDataDirectory;
    }
  }
});

it("determines current lifecycle period using Mina global slot", async () => {
  const Local = await Mina.LocalBlockchain({
    proofsEnabled: false,
  });
  Mina.setActiveInstance(Local);

  const service = new SqliteTreasuryOwnerService();
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const lifecyclePeriodDuration = UInt32.from(10);

  Local.addAccount(treasuryOwnerPublicKey, "1000000000");
  Local.setGlobalSlot(25);

  const votingResult = await service.getCurrentLifecyclePeriod({
    minaNodeUrl: "http://127.0.0.1:8080/graphql",
    treasuryOwnerPublicKey,
    lifecyclePeriodDuration,
  });

  assert.strictEqual(votingResult.treasuryOwnerAddress, treasuryOwnerPublicKey.toBase58());
  assert.strictEqual(votingResult.currentGlobalSlot, "25");
  assert.strictEqual(votingResult.lifecycleStarted, true);
  assert.strictEqual(votingResult.lifecyclePeriodDuration, "10");
  assert.strictEqual(votingResult.lifecycleId, "0");
  assert.strictEqual(votingResult.period, "voting");
  assert.strictEqual(votingResult.periodStartSlot, "20");
  assert.strictEqual(votingResult.periodEndSlot, "30");

  Local.setGlobalSlot(45);
  const nextLifecycleResult = await service.getCurrentLifecyclePeriod({
    minaNodeUrl: "http://127.0.0.1:8080/graphql",
    treasuryOwnerPublicKey,
    lifecyclePeriodDuration,
  });

  assert.strictEqual(nextLifecycleResult.currentGlobalSlot, "45");
  assert.strictEqual(nextLifecycleResult.lifecycleId, "1");
  assert.strictEqual(nextLifecycleResult.period, "proposal");
  assert.strictEqual(nextLifecycleResult.periodStartSlot, "40");
  assert.strictEqual(nextLifecycleResult.periodEndSlot, "50");
});

