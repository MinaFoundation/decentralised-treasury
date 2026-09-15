import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { inspect } from "node:util";
import { createLocalE2EBackendLauncher } from "./local-e2e-backend.mjs";
import { serviceNames } from "./local-e2e-services.mjs";

const treasuryOwnerPublicKey = "B62" + "a".repeat(52);

async function harness(t, settings = {}) {
  const runDirectory = await mkdtemp(join(tmpdir(), "treasury-backend-unit-"));
  const requests = [];
  const children = [];
  let label;
  const options = {
    runDirectory,
    resourceId: "backend-unit-run",
    minaNodeUrl: "http://127.0.0.1:19001/graphql",
    archiveNodeUrl: "http://127.0.0.1:19002/graphql",
    treasuryOwnerPublicKey,
    proofsEnabled: false,
    env: { PROOFS_ENABLED: "false" },
    startupTimeoutMs: 3_000,
    commandTimeoutMs: 3_000,
  };
  const launch = createLocalE2EBackendLauncher({
    spawn(executable, args, spawnOptions) {
      requests.push({ executable, args, options: spawnOptions });
      let script;
      if (executable === "docker") {
        if (settings.spawnError && args[0] === "run") {
          const password = args.find((arg) =>
            arg.startsWith("POSTGRES_PASSWORD="),
          );
          throw Object.assign(new Error(`Docker spawn failed: ${password}`), {
            spawnargs: args,
          });
        }
        let output = "";
        if (args[0] === "run") {
          label = args[args.indexOf("--label") + 1].split("=")[1];
          output = "isolated-container-id\n";
        }
        if (args[0] === "port") output = "127.0.0.1:54321\n";
        if (args[0] === "inspect")
          output = `${settings.foreignLabel ?? label}\n`;
        script = `process.stdout.write(${JSON.stringify(output)})`;
      } else if (args.includes("migration:run")) {
        if (settings.migrationHangs) script = "setInterval(() => {}, 1000)";
        else
          script = settings.migrationFails
            ? "console.error('migration rejected'); process.exitCode = 1"
            : "console.log('migration complete')";
      } else {
        const name = basename(args.at(-1), ".ts");
        if (settings.exits === name)
          script =
            "console.error('worker startup rejected'); process.exitCode = 1";
        else if (name.endsWith("api")) {
          const portKey =
            name === "app-api"
              ? "API_PORT"
              : name === "indexer-api"
                ? "INDEXER_API_PORT"
                : "PROCESSOR_API_PORT";
          script = `const http = require('node:http'); const server = http.createServer((request, response) => { response.writeHead(${settings.neverReady ? 503 : 200}); response.end(JSON.stringify({ready: true})); }); server.listen(Number(process.env.${portKey}), '127.0.0.1'); process.on('SIGTERM', () => server.close(() => process.exit(0)));`;
        } else script = "setInterval(() => {}, 1000)";
        if (settings.secretLogs)
          script +=
            "; process.stdout.write(process.env.TEST_PRIVATE_KEY.slice(0, 20)); setTimeout(() => process.stdout.write(process.env.TEST_PRIVATE_KEY.slice(20) + '\\n' + process.env.DATABASE_URL + '\\n' + process.env.TEST_API_TOKEN + '\\n'), 10)";
      }
      const child = spawn(process.execPath, ["-e", script], spawnOptions);
      children.push(child);
      return child;
    },
  });
  t.after(async () => {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "close");
        }
      }),
    );
  });
  return { launch, options, requests, children, runDirectory };
}

for (const proofsEnabled of [false, true]) {
  test(`real process boundaries preserve mode ${proofsEnabled}, absolute paths, isolated state, and named restart`, async (t) => {
    const h = await harness(t);
    const backend = await h.launch({
      ...h.options,
      proofsEnabled,
      env: { PROOFS_ENABLED: String(proofsEnabled) },
    });
    t.after(() => backend.dispose());
    assert.notEqual(backend.appApiUrl, backend.indexerApiUrl);
    assert.notEqual(backend.appApiUrl, backend.processorApiUrl);
    assert.ok(backend.artifactDirectory.startsWith(h.runDirectory + "/"));
    assert.equal(
      backend.sqliteDirectory,
      join(backend.artifactDirectory, "sqlite"),
    );
    const commands = h.requests.filter(
      (entry) => entry.executable !== "docker",
    );
    assert.equal(commands.length, 6);
    for (const command of commands) {
      assert.ok(isAbsolute(command.executable));
      assert.ok(isAbsolute(command.options.cwd));
      assert.ok(isAbsolute(command.args[1]));
      assert.ok(isAbsolute(command.args[2]));
      assert.ok(isAbsolute(command.options.env.TS_NODE_PROJECT));
      assert.equal(command.options.env.PROOFS_ENABLED, String(proofsEnabled));
      assert.equal(
        command.options.env.ARCHIVE_NODE_URL,
        h.options.archiveNodeUrl,
      );
      assert.equal(command.options.env.MINA_NODE_URL, h.options.minaNodeUrl);
      assert.equal(
        command.options.env.TREASURY_OWNER_CONTRACT_ADDRESS,
        treasuryOwnerPublicKey,
      );
      assert.equal(
        command.options.env.SQLITE_DATA_DIRECTORY,
        backend.sqliteDirectory,
      );
    }
    assert.ok(commands[0].args.includes("migration:run"));
    assert.deepEqual(
      commands.slice(1).map((entry) => basename(entry.args.at(-1), ".ts")),
      serviceNames,
    );
    const dockerRun = h.requests.find((entry) => entry.args[0] === "run");
    assert.ok(dockerRun.args.includes("127.0.0.1::5432"));
    assert.ok(
      dockerRun.args.includes("treasury.local-e2e.run=backend-unit-run"),
    );
    assert.ok(
      !h.requests.some((entry) =>
        entry.args.some((arg) => /deploy|sendZkapp/.test(arg)),
      ),
    );
    await backend.services.stop("app-api");
    backend.services.start("app-api");
    await delay(80);
    assert.equal((await fetch(`${backend.appApiUrl}/readyz`)).status, 200);
    await Promise.all([backend.dispose(), backend.dispose()]);
    assert.equal(
      h.requests.filter((entry) => entry.args[0] === "rm").length,
      1,
    );
    assert.ok(
      h.children.every(
        (child) => child.exitCode !== null || child.signalCode !== null,
      ),
    );
    assert.throws(() => backend.services.start("app-api"), /disposed/);
    const metadata = JSON.parse(
      await readFile(
        join(backend.artifactDirectory, "public-backend.json"),
        "utf8",
      ),
    );
    assert.equal(metadata.proofsEnabled, proofsEnabled);
    assert.equal(metadata.resourceId, "backend-unit-run");
    assert.equal(metadata.env, undefined);
  });
}

test("invalid or conflicting mode and relative directories fail before process launch", async (t) => {
  const h = await harness(t);
  await assert.rejects(
    h.launch({ ...h.options, proofsEnabled: "false" }),
    /explicit boolean/,
  );
  await assert.rejects(
    h.launch({ ...h.options, env: { PROOFS_ENABLED: "true" } }),
    /differs/,
  );
  await assert.rejects(
    h.launch({ ...h.options, runDirectory: "relative" }),
    /absolute/,
  );
  await assert.rejects(
    h.launch({ ...h.options, resourceId: "../other" }),
    /resource ID/,
  );
  await assert.rejects(
    h.launch({
      ...h.options,
      minaNodeUrl: "http://secret:password@localhost/graphql",
    }),
    /credentials/,
  );
  assert.equal(h.requests.length, 0);
});

test("migration failure cleans only its labelled database and never starts services", async (t) => {
  const h = await harness(t, { migrationFails: true });
  await assert.rejects(h.launch(h.options), /migration rejected/);
  assert.equal(
    h.requests.filter((entry) => entry.executable !== "docker").length,
    1,
  );
  assert.equal(h.requests.filter((entry) => entry.args[0] === "rm").length, 1);
});

test("cleanup refuses a database whose run label differs", async (t) => {
  const h = await harness(t, {
    migrationFails: true,
    foreignLabel: "another-run",
  });
  await assert.rejects(h.launch(h.options), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[1].errors[0]), /another run/);
    return true;
  });
  assert.equal(h.requests.filter((entry) => entry.args[0] === "rm").length, 0);
});

test("an early worker exit fails readiness and stops all remaining services", async (t) => {
  const h = await harness(t, { exits: "indexer" });
  await assert.rejects(
    h.launch(h.options),
    /indexer stopped before backend readiness/,
  );
  assert.ok(
    h.children.every(
      (child) => child.exitCode !== null || child.signalCode !== null,
    ),
  );
  assert.equal(h.requests.filter((entry) => entry.args[0] === "rm").length, 1);
});

test("readiness timeout is bounded and cleans the database", async (t) => {
  const h = await harness(t, { neverReady: true });
  await assert.rejects(
    h.launch({ ...h.options, startupTimeoutMs: 200 }),
    /readiness timed out/,
  );
  assert.equal(h.requests.filter((entry) => entry.args[0] === "rm").length, 1);
});

test("a command timeout stops the child and still cleans the database", async (t) => {
  const h = await harness(t, { migrationHangs: true });
  await assert.rejects(
    h.launch({ ...h.options, commandTimeoutMs: 150 }),
    /migrations timed out/,
  );
  assert.ok(
    h.children.every(
      (child) => child.exitCode !== null || child.signalCode !== null,
    ),
  );
  assert.equal(h.requests.filter((entry) => entry.args[0] === "rm").length, 1);
});

test("logs redact split private keys, supplied tokens, and generated database credentials", async (t) => {
  const h = await harness(t, { secretLogs: true });
  const privateKey = "EK" + "A".repeat(53);
  const token = "test-api-token-should-not-be-public";
  const backend = await h.launch({
    ...h.options,
    env: {
      PROOFS_ENABLED: "false",
      TEST_PRIVATE_KEY: privateKey,
      TEST_API_TOKEN: token,
    },
  });
  await backend.dispose();
  const text = (
    await Promise.all(
      (await readdir(backend.artifactDirectory))
        .filter((name) => name.endsWith(".log") || name.endsWith(".json"))
        .map((name) => readFile(join(backend.artifactDirectory, name), "utf8")),
    )
  ).join("\n");
  const dbPassword = h.requests
    .find((entry) => entry.args[0] === "run")
    .args.find((arg) => arg.startsWith("POSTGRES_PASSWORD="))
    .split("=")[1];
  assert.ok(!text.includes(privateKey));
  assert.ok(!text.includes(token));
  assert.ok(!text.includes(dbPassword));
  assert.match(text, /redacted/);
});

test("startup and cleanup error objects do not expose Docker credentials or spawn arguments", async (t) => {
  const h = await harness(t, { spawnError: true });
  await assert.rejects(h.launch(h.options), (error) => {
    const password = h.requests
      .find((entry) => entry.args[0] === "run")
      .args.find((arg) => arg.startsWith("POSTGRES_PASSWORD="))
      .split("=")[1];
    const diagnostic = inspect(error, { depth: 10 });
    assert.ok(!diagnostic.includes(password));
    assert.ok(!diagnostic.includes("spawnargs"));
    assert.match(diagnostic, /redacted/);
    return true;
  });
});
