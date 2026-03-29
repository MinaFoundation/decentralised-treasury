import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { type ChildProcess } from "node:child_process";
import { fetchAccount, Mina, PrivateKey, PublicKey } from "o1js";
import { TreasuryPauseControllerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MIN_VALID_MULTISIG_SIGNATURES_COUNT,
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  ensureLightnetReady,
  LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
  logTestStep,
  MINA_NODE_URL,
  parseMultisigSignResult,
  parsePauseControllerCompileResult,
  parsePauseControllerDeployResult,
  parsePauseControllerStateResult,
  parsePauseTreasuryResult,
  parseRotateMultisigKeysResult,
  parseTogglePauseProposalResult,
  parseUnpauseTreasuryResult,
  runCli,
} from "./utils/cli-test-utils.js";

const TEST_NAME = "pause-controller.test";
const PROOFS_ENABLED = "true";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} for pause-controller e2e test`);
  }
  return value;
}

const SENDER_PRIVATE_KEY = requireEnv("SENDER_PRIVATE_KEY");

async function runPauseControllerCli(
  args: string[],
  options: Parameters<typeof runCli>[1] = {},
): Promise<string> {
  return await runCli(args, {
    ...options,
    envOverrides: {
      ...(options.envOverrides ?? {}),
      PROOFS_ENABLED,
    },
  });
}

type ParsedMultisigSignResult = NonNullable<
  ReturnType<typeof parseMultisigSignResult>
>;

interface BuildMergedSignaturesOptions {
  action:
    | "pause-treasury"
    | "unpause-treasury"
    | "toggle-pause-proposal"
    | "rotate-multisig-keys";
  participantPublicKeys: string[];
  signerPrivateKeys: string[];
  nonce: number;
  extraArgs?: string[];
  streamLabelPrefix: string;
}

async function buildMergedSignatures(
  options: BuildMergedSignaturesOptions,
): Promise<{
  partialResults: ParsedMultisigSignResult[];
  mergedSignatures: string[];
}> {
  const partialResults: ParsedMultisigSignResult[] = [];
  for (const [index, signerPrivateKey] of options.signerPrivateKeys.entries()) {
    const output = await runPauseControllerCli(
      [
        "multisig-sign",
        options.action,
        "--multisig-participants-public-keys",
        options.participantPublicKeys.join(","),
        "--multisig-signer-private-key",
        signerPrivateKey,
        ...(options.extraArgs ?? []),
        "--nonce",
        String(options.nonce),
      ],
      {
        streamOutput: true,
        streamLabel: `${options.streamLabelPrefix} signer ${index + 1}`,
      },
    );
    const result = parseMultisigSignResult(output);
    assert(result, `expected multisig-sign ${options.action} JSON output`);
    assert.strictEqual(result.type, options.action);
    assert.strictEqual(result.nonce, String(options.nonce));
    assert.strictEqual(result.validSignaturesCount, 1);
    partialResults.push(result);
  }

  const mergedSignatures = mergePartialSignatures(
    partialResults,
  );
  assert(
    countValidSignatures(mergedSignatures) >= MIN_VALID_MULTISIG_SIGNATURES_COUNT,
    `expected at least ${MIN_VALID_MULTISIG_SIGNATURES_COUNT} valid signatures after merge`,
  );

  return {
    partialResults,
    mergedSignatures,
  };
}

async function fetchPauseControllerState(pauseControllerPublicKey: string): Promise<{
  paused: boolean;
  multisigCommitment: string;
  nonce: number;
}> {
  const publicKey = PublicKey.fromBase58(pauseControllerPublicKey);
  const { error } = await fetchAccount({
    publicKey,
  });
  if (error) {
    throw new Error(
      `Failed to fetch pause controller account ${pauseControllerPublicKey}: ${String(error)}`,
    );
  }
  const contract = new TreasuryPauseControllerSmartContract(publicKey);
  const paused = await contract.paused.fetch();
  const multisigCommitment = await contract.multisigCommitment.fetch();
  assert(paused, "expected pause controller paused state to be available");
  assert(
    multisigCommitment,
    "expected pause controller multisig commitment to be available",
  );
  return {
    paused: paused.toBoolean(),
    multisigCommitment: multisigCommitment.toString(),
    nonce: Number(Mina.getAccount(publicKey).nonce.toBigint()),
  };
}

const EMPTY_MULTISIG_SIGNATURE = MultisigSignature.empty().toBase58();

function mergePartialSignatures(
  partialResults: ParsedMultisigSignResult[],
): string[] {
  const merged = Array.from(
    { length: MULTISIG_PARTICIPANTS_COUNT },
    () => EMPTY_MULTISIG_SIGNATURE,
  );

  for (const result of partialResults) {
    const index = result.signerParticipantIndex;
    assert(
      index >= 0 && index < MULTISIG_PARTICIPANTS_COUNT,
      `invalid signer participant index ${String(index)}`,
    );

    const signature = result.signature;
    if (
      merged[index] !== EMPTY_MULTISIG_SIGNATURE &&
      merged[index] !== signature
    ) {
      throw new Error(`Conflicting signatures detected at participant index ${index}`);
    }
    merged[index] = signature;
  }

  return merged;
}

function countValidSignatures(signatures: string[]): number {
  return signatures.filter((signature) => signature !== EMPTY_MULTISIG_SIGNATURE).length;
}

describe("pause-controller CLI", { concurrency: 1 }, () => {
  let lightnetProcess: ChildProcess | undefined;
  let pauseControllerPublicKey: string | undefined;
  let currentMultisigPrivateKeys: string[] = [];
  let currentMultisigPublicKeys: string[] = [];

  before(async () => {
    logTestStep(TEST_NAME, "setup: starting Lightnet for pause-controller e2e");
    lightnetProcess = await ensureLightnetReady();
    Mina.setActiveInstance(
      Mina.Network({
        mina: MINA_NODE_URL,
        lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
      }),
    );
  });

  after(() => {
    lightnetProcess?.kill("SIGTERM");
  });

  it("exposes pause-controller command in help", async () => {
    const rootHelp = await runPauseControllerCli(["--help"]);
    assert(
      rootHelp.includes("pause-controller"),
      "expected root help to list pause-controller command",
    );
    assert(
      rootHelp.includes("multisig-sign"),
      "expected root help to list multisig-sign command",
    );

    const pauseControllerHelp = await runPauseControllerCli([
      "pause-controller",
      "--help",
    ]);
    assert(
      pauseControllerHelp.includes("pause-treasury"),
      "expected pause-controller help to list pause-treasury subcommand",
    );
    assert(
      pauseControllerHelp.includes("unpause-treasury"),
      "expected pause-controller help to list unpause-treasury subcommand",
    );
    assert(
      pauseControllerHelp.includes("toggle-pause-proposal"),
      "expected pause-controller help to list toggle-pause-proposal subcommand",
    );
    assert(
      pauseControllerHelp.includes("rotate-multisig-keys"),
      "expected pause-controller help to list rotate-multisig-keys subcommand",
    );
    assert(
      pauseControllerHelp.includes("read-state"),
      "expected pause-controller help to list read-state subcommand",
    );
  });

  it("operates all pause-controller functions via dedicated commands", async () => {
    const senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
    const pauseControllerPrivateKey = PrivateKey.random();
    pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey().toBase58();
    currentMultisigPrivateKeys = Array.from({ length: 5 }, () =>
      PrivateKey.random().toBase58(),
    );
    currentMultisigPublicKeys = currentMultisigPrivateKeys.map((privateKey) =>
      PrivateKey.fromBase58(privateKey).toPublicKey().toBase58(),
    );
    const currentSigningPrivateKeys = currentMultisigPrivateKeys.slice(
      0,
      MIN_VALID_MULTISIG_SIGNATURES_COUNT,
    );

    logTestStep(TEST_NAME, "running pause-controller compile");
    const compileOutput = await runPauseControllerCli(
      ["pause-controller", "compile"],
      {
      timeoutMs: 600_000,
      streamOutput: true,
      streamLabel: "pause-controller compile test",
      },
    );
    const compileResult = parsePauseControllerCompileResult(compileOutput);
    assert(compileResult, "expected pause-controller compile JSON output");
    assert.strictEqual(
      compileResult.compiled.pauseControllerVerificationKey,
      true,
    );

    logTestStep(TEST_NAME, "running pause-controller deploy", {
      pauseControllerPublicKey,
      multisigParticipants: currentMultisigPublicKeys.length,
    });
    const deployOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "deploy",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-private-key",
        pauseControllerPrivateKey.toBase58(),
        "--multisig-participants-public-keys",
        currentMultisigPublicKeys.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller deploy test",
      },
    );
    const deployResult = parsePauseControllerDeployResult(deployOutput);
    assert(deployResult, "expected pause-controller deploy JSON output");
    assert.strictEqual(deployResult.pauseControllerAddress, pauseControllerPublicKey);
    assert(deployResult.pauseControllerTxHash, "expected deploy tx hash");
    const expectedInitialCommitment = MultisigSignatures.createCommitment(
      currentMultisigPublicKeys.map((publicKey) => PublicKey.fromBase58(publicKey)),
    ).toString();
    const deployedState = await fetchPauseControllerState(pauseControllerPublicKey);
    assert.strictEqual(deployedState.paused, false);
    assert.strictEqual(deployedState.multisigCommitment, expectedInitialCommitment);

    const stateOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "read-state",
        "--mina-node-url",
        MINA_NODE_URL,
        "--pause-controller-public-key",
        pauseControllerPublicKey,
      ],
      {
        timeoutMs: 120_000,
        streamOutput: true,
        streamLabel: "pause-controller state test",
      },
    );
    const stateResult = parsePauseControllerStateResult(stateOutput);
    assert(stateResult, "expected pause-controller state JSON output");
    assert.strictEqual(stateResult.pauseControllerAddress, pauseControllerPublicKey);
    assert.strictEqual(stateResult.paused, false);
    assert.strictEqual(stateResult.multisigCommitment, expectedInitialCommitment);

    logTestStep(TEST_NAME, "running pause-controller pause-treasury", {
      pauseControllerPublicKey,
    });
    const { mergedSignatures: pauseSignatures, partialResults: pauseSignResults } =
      await buildMergedSignatures({
        action: "pause-treasury",
        participantPublicKeys: currentMultisigPublicKeys,
        signerPrivateKeys: currentSigningPrivateKeys,
        nonce: deployedState.nonce,
        streamLabelPrefix: "multisig-sign pause-treasury test",
      });
    assert.strictEqual(
      pauseSignResults.length,
      MIN_VALID_MULTISIG_SIGNATURES_COUNT,
    );

    const pauseOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "pause-treasury",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-public-key",
        pauseControllerPublicKey,
        "--multisig-participants-public-keys",
        currentMultisigPublicKeys.join(","),
        "--multisig-signatures",
        pauseSignatures.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller pause test",
      },
    );
    const pauseResult = parsePauseTreasuryResult(pauseOutput);
    assert(pauseResult, "expected pause-treasury JSON output");
    assert.strictEqual(pauseResult.pauseControllerAddress, pauseControllerPublicKey);
    assert.strictEqual(pauseResult.paused, true);
    assert(pauseResult.pauseTxHash, "expected pause tx hash");
    const pausedState = await fetchPauseControllerState(pauseControllerPublicKey);
    assert.strictEqual(pausedState.paused, true);

    logTestStep(TEST_NAME, "running pause-controller unpause-treasury", {
      pauseControllerPublicKey,
    });
    const { mergedSignatures: unpauseSignatures } = await buildMergedSignatures({
      action: "unpause-treasury",
      participantPublicKeys: currentMultisigPublicKeys,
      signerPrivateKeys: currentSigningPrivateKeys,
      nonce: pausedState.nonce,
      streamLabelPrefix: "multisig-sign unpause-treasury test",
    });

    const unpauseOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "unpause-treasury",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-public-key",
        pauseControllerPublicKey,
        "--multisig-participants-public-keys",
        currentMultisigPublicKeys.join(","),
        "--multisig-signatures",
        unpauseSignatures.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller unpause test",
      },
    );
    const unpauseResult = parseUnpauseTreasuryResult(unpauseOutput);
    assert(unpauseResult, "expected unpause-treasury JSON output");
    assert.strictEqual(
      unpauseResult.pauseControllerAddress,
      pauseControllerPublicKey,
    );
    assert.strictEqual(unpauseResult.paused, false);
    assert(unpauseResult.unpauseTxHash, "expected unpause tx hash");
    const unpausedState = await fetchPauseControllerState(pauseControllerPublicKey);
    assert.strictEqual(unpausedState.paused, false);

    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    logTestStep(TEST_NAME, "running pause-controller toggle-pause-proposal", {
      pauseControllerPublicKey,
      proposalPublicKey,
    });
    const {
      mergedSignatures: toggleSignatures,
      partialResults: toggleSignResults,
    } = await buildMergedSignatures({
      action: "toggle-pause-proposal",
      participantPublicKeys: currentMultisigPublicKeys,
      signerPrivateKeys: currentSigningPrivateKeys,
      nonce: unpausedState.nonce,
      extraArgs: ["--proposal-public-key", proposalPublicKey],
      streamLabelPrefix: "multisig-sign toggle-pause-proposal test",
    });
    for (const toggleSignResult of toggleSignResults) {
      assert.strictEqual(toggleSignResult.proposalPublicKey, proposalPublicKey);
    }

    const toggleOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "toggle-pause-proposal",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-public-key",
        pauseControllerPublicKey,
        "--proposal-public-key",
        proposalPublicKey,
        "--multisig-participants-public-keys",
        currentMultisigPublicKeys.join(","),
        "--multisig-signatures",
        toggleSignatures.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller toggle proposal test",
      },
    );
    const toggleResult = parseTogglePauseProposalResult(toggleOutput);
    assert(toggleResult, "expected toggle-pause-proposal JSON output");
    assert.strictEqual(
      toggleResult.pauseControllerAddress,
      pauseControllerPublicKey,
    );
    assert.strictEqual(toggleResult.proposalPublicKey, proposalPublicKey);
    assert(
      toggleResult.togglePauseProposalTxHash,
      "expected toggle-pause-proposal tx hash",
    );
    const toggledState = await fetchPauseControllerState(pauseControllerPublicKey);

    const newMultisigPrivateKeys = Array.from({ length: 5 }, () =>
      PrivateKey.random().toBase58(),
    );
    const newMultisigPublicKeys = newMultisigPrivateKeys.map((privateKey) =>
      PrivateKey.fromBase58(privateKey).toPublicKey().toBase58(),
    );
    const newSigningPrivateKeys = newMultisigPrivateKeys.slice(
      0,
      MIN_VALID_MULTISIG_SIGNATURES_COUNT,
    );
    logTestStep(TEST_NAME, "running pause-controller rotate-multisig-keys", {
      pauseControllerPublicKey,
    });
    const { mergedSignatures: rotateSignatures } = await buildMergedSignatures({
      action: "rotate-multisig-keys",
      participantPublicKeys: currentMultisigPublicKeys,
      signerPrivateKeys: currentSigningPrivateKeys,
      nonce: toggledState.nonce,
      extraArgs: [
        "--new-multisig-participants-public-keys",
        newMultisigPublicKeys.join(","),
      ],
      streamLabelPrefix: "multisig-sign rotate-multisig-keys test",
    });

    const rotateOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "rotate-multisig-keys",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-public-key",
        pauseControllerPublicKey,
        "--current-multisig-participants-public-keys",
        currentMultisigPublicKeys.join(","),
        "--multisig-signatures",
        rotateSignatures.join(","),
        "--new-multisig-participants-public-keys",
        newMultisigPublicKeys.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller rotate keys test",
      },
    );
    const rotateResult = parseRotateMultisigKeysResult(rotateOutput);
    assert(rotateResult, "expected rotate-multisig-keys JSON output");
    assert.strictEqual(
      rotateResult.pauseControllerAddress,
      pauseControllerPublicKey,
    );
    assert(
      rotateResult.rotateMultisigKeysTxHash,
      "expected rotate-multisig-keys tx hash",
    );
    const expectedNewCommitment = MultisigSignatures.createCommitment(
      newMultisigPublicKeys.map((publicKey) => PublicKey.fromBase58(publicKey)),
    ).toString();
    assert.strictEqual(rotateResult.newMultisigCommitment, expectedNewCommitment);

    const rotatedState = await fetchPauseControllerState(pauseControllerPublicKey);
    assert.strictEqual(rotatedState.multisigCommitment, expectedNewCommitment);

    // Ensure rotated keys can still authorize a pause action.
    const { mergedSignatures: pauseWithRotatedKeysSignatures } =
      await buildMergedSignatures({
        action: "pause-treasury",
        participantPublicKeys: newMultisigPublicKeys,
        signerPrivateKeys: newSigningPrivateKeys,
        nonce: rotatedState.nonce,
        streamLabelPrefix: "multisig-sign pause rotated keys test",
      });

    const pauseWithRotatedKeysOutput = await runPauseControllerCli(
      [
        "pause-controller",
        "pause-treasury",
        "--mina-node-url",
        MINA_NODE_URL,
        "--sender-private-key",
        senderPrivateKey.toBase58(),
        "--pause-controller-public-key",
        pauseControllerPublicKey,
        "--multisig-participants-public-keys",
        newMultisigPublicKeys.join(","),
        "--multisig-signatures",
        pauseWithRotatedKeysSignatures.join(","),
        "--wait",
        "true",
      ],
      {
        timeoutMs: 900_000,
        streamOutput: true,
        streamLabel: "pause-controller pause rotated keys test",
      },
    );
    const pauseWithRotatedKeysResult = parsePauseTreasuryResult(
      pauseWithRotatedKeysOutput,
    );
    assert(
      pauseWithRotatedKeysResult?.pauseTxHash,
      "expected pause tx hash after key rotation",
    );
    const pausedAfterRotateState =
      await fetchPauseControllerState(pauseControllerPublicKey);
    assert.strictEqual(pausedAfterRotateState.paused, true);
  });
});

