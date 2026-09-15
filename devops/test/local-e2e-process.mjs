import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export const TEST_CONTAINER_LABEL = "treasury.local-e2e.run";
const execFileAsync = promisify(execFile);

async function docker(args) {
  const { stdout } = await execFileAsync("docker", args, { timeout: 30_000 });
  return stdout;
}

// Only containers with this exact suite-run label belong to this cleanup.
// Never remove containers by a broad name prefix or a shared image name.
export async function cleanupTestContainers(runId, runDocker = docker) {
  assert.match(runId, /^[a-zA-Z0-9_-]+$/, "Invalid container cleanup run ID");
  const output = await runDocker([
    "ps",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `label=${TEST_CONTAINER_LABEL}=${runId}`,
  ]);
  const ids = output.trim() ? output.trim().split(/\s+/u) : [];
  for (const id of ids)
    assert.match(id, /^[a-f0-9]{64}$/, "Invalid test container ID");
  if (!ids.length) return [];
  const containers = JSON.parse(await runDocker(["inspect", ...ids]));
  assert.equal(
    containers.length,
    ids.length,
    "Missing container inspection results",
  );
  assert.deepEqual(
    new Set(containers.map((container) => container.Id)),
    new Set(ids),
    "Container inspection returned different IDs",
  );
  for (const container of containers) {
    assert.equal(
      container.Config?.Labels?.[TEST_CONTAINER_LABEL],
      runId,
      "Refusing to remove a container from another run",
    );
  }
  await runDocker(["rm", "--force", ...ids]);
  return ids;
}

function validatePid(pid) {
  assert.ok(
    Number.isSafeInteger(pid) && pid > 1,
    "Expected a test child PID greater than one",
  );
  assert.notEqual(pid, process.pid, "Refusing to stop the runner itself");
}

export function signalProcessGroup(pid, signal) {
  validatePid(pid);
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

// Keep the original group ID after the child exits. Descendants can keep
// running in that group even when the immediate child has already closed.
export async function stopProcessGroup(pid, { graceMs = 10_000 } = {}) {
  validatePid(pid);
  assert.ok(
    Number.isSafeInteger(graceMs) && graceMs >= 0,
    "Invalid cleanup grace period",
  );
  if (!signalProcessGroup(pid, "SIGTERM")) return { forced: false };
  const deadline = Date.now() + graceMs;
  while (signalProcessGroup(pid, 0)) {
    if (Date.now() >= deadline) {
      signalProcessGroup(pid, "SIGKILL");
      return { forced: true };
    }
    await delay(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return { forced: false };
}
