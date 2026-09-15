import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliEntry = new URL("../src/cli.ts", import.meta.url).href;

for (const override of [undefined, "wasm"] as const) {
  const expected = override ?? "native";
  test(`CLI startup ${override ? "preserves the wasm override" : "defaults to native bindings"}`, async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.O1JS_BACKEND;
    if (override) env.O1JS_BACKEND = override;

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--loader",
        "ts-node/esm",
        "--input-type=module",
        "--eval",
        `
          await import(${JSON.stringify(cliEntry)});
          const { getBackendPreference, initializeBindings } = await import("o1js");
          await initializeBindings();
          console.log(JSON.stringify({
            environment: process.env.O1JS_BACKEND,
            preference: getBackendPreference(),
            loaded: globalThis.__kimchi_backend,
          }));
        `,
      ],
      { cwd: new URL("..", import.meta.url), env, timeout: 30_000 },
    );

    assert.deepEqual(JSON.parse(stdout), {
      environment: expected,
      preference: expected,
      loaded: expected,
    });
  });
}
