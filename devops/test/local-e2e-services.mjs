export const serviceNames = [
  "indexer",
  "indexer-api",
  "processor",
  "processor-api",
  "app-api",
];

/**
 * Control only the fixture's named child processes. Preserve their database.
 * @param {(name: string) => import('node:child_process').ChildProcess} launch
 * @param {{ graceMs?: number, killMs?: number }} options
 */
export function createServiceControls(
  launch,
  { graceMs = 5_000, killMs = 5_000 } = {},
) {
  for (const value of [graceMs, killMs]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Service stop timeouts must be positive integers");
  }
  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const children = new Map();
  const stopping = new Map();
  const running = (child) =>
    child.exitCode === null && child.signalCode === null;
  const validate = (name) => {
    if (!serviceNames.includes(name))
      throw new Error(`Unknown fixture service: ${name}`);
  };

  return {
    start(name) {
      validate(name);
      const previous = children.get(name);
      if (stopping.has(name) || (previous && running(previous)))
        throw new Error(`Fixture service is already active: ${name}`);
      const child = launch(name);
      children.set(name, child);
      return child;
    },
    async stop(name) {
      validate(name);
      if (stopping.has(name)) return stopping.get(name);
      const child = children.get(name);
      if (!child || !running(child)) return;
      const stop = new Promise((resolve, reject) => {
        let forcedTimer;
        const graceTimer = setTimeout(() => {
          if (!running(child)) return;
          child.kill("SIGKILL");
          forcedTimer = setTimeout(() => {
            finish(new Error(`Fixture service did not stop: ${name}`));
          }, killMs);
        }, graceMs);
        const finish = (error) => {
          clearTimeout(graceTimer);
          clearTimeout(forcedTimer);
          child.off("close", closed);
          child.off("error", finish);
          error ? reject(error) : resolve();
        };
        const closed = () => finish();
        child.once("close", closed);
        child.once("error", finish);
        child.kill("SIGTERM");
      });
      stopping.set(name, stop);
      try {
        await stop;
      } finally {
        stopping.delete(name);
      }
    },
  };
}
