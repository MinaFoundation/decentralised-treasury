import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { VoteReducer } from "../../../sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VoteReducerRunBatchTask } from "../../../sdk/src/proving/tasks/vote-reducer-run-batch-task.js";
import { VoteReducerRunBatchTrace } from "../../../sdk/src/proving/tracing/vote-reducer-tracer.js";
import { proofMode, proofsEnabled } from "../proof-mode.js";

const execFileAsync = promisify(execFile);

export async function proveVoteReducerInWorker(
  trace: VoteReducerRunBatchTrace,
) {
  const directory = process.env.E2E_ARTIFACT_DIRECTORY
    ? join(process.env.E2E_ARTIFACT_DIRECTORY, "vote-reducer-worker")
    : await mkdtemp(join(tmpdir(), `vote-reducer-${proofMode}-`));
  await mkdir(join(directory, "cache"), { recursive: true });
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "output.json");
  await writeFile(
    inputPath,
    await VoteReducerRunBatchTask.serializers.input({ trace, traceId: 0 }),
  );
  console.log(`[e2e-phase] isolated reducer artifacts ${directory}`);
  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--loader",
        fileURLToPath(
          new URL("../../../sdk/node_modules/ts-node/esm.mjs", import.meta.url),
        ),
        fileURLToPath(import.meta.url),
        inputPath,
        outputPath,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          PROOFS_ENABLED: proofMode,
          NODE_NO_WARNINGS: "1",
          TS_NODE_PROJECT: fileURLToPath(
            new URL("../../tsconfig.json", import.meta.url),
          ),
        },
        timeout: 1_800_000,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
      },
    ));
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    stdout = failure.stdout ?? "";
    stderr = failure.stderr ?? "";
    throw error;
  } finally {
    await writeFile(join(directory, "worker.log"), `${stdout}\n${stderr}`);
  }
  const result = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(
    result.proofMode,
    proofMode,
    "Reducer worker proof mode mismatch",
  );
  assert.equal(
    result.verified,
    proofsEnabled,
    "Reducer worker verification evidence mismatch",
  );
  const output = await VoteReducerRunBatchTask.deserializers.output(
    result.output,
  );
  assert.equal(output.traceId, 0);
  return output.proof;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const [, , inputPath, outputPath] = process.argv;
    assert.ok(
      inputPath && outputPath,
      "Expected reducer input and output paths",
    );
    console.log(`[e2e-phase] worker prepare PROOFS_ENABLED=${proofMode}`);
    await VoteReducerRunBatchTask.prepare();
    const input = await VoteReducerRunBatchTask.deserializers.input(
      await readFile(inputPath, "utf8"),
    );
    console.log("[e2e-phase] worker prove");
    const output = await VoteReducerRunBatchTask.run(input);
    const verified = proofsEnabled
      ? await VoteReducer.verify(output.proof)
      : false;
    assert.equal(verified, proofsEnabled);
    await writeFile(
      outputPath,
      JSON.stringify({
        proofMode,
        verified,
        output: await VoteReducerRunBatchTask.serializers.output(output),
      }),
    );
    console.log("[e2e-phase] worker complete");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
