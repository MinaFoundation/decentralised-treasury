import { expect, test } from "@playwright/test";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProverResponse } from "../features/prover-worker.types";

test("loads o1js in the proof worker under its response policy", async ({
  page,
  request,
}) => {
  // A parser-loaded script uses the page policy. Browser automation script
  // injection can bypass CSP and would give a false result here.
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "</body>",
        `<script>
        try {
          new Function("return 1")();
          document.documentElement.dataset.evalResult = "allowed";
        } catch (error) {
          document.documentElement.dataset.evalResult = error.name;
        }
      </script></body>`,
      ),
    });
  });
  const response = await page.goto("/");
  // The UI starts its worker only after it gets treasury state. Read the
  // emitted entry so this check does not need a configured deployment.
  const workerDir = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
    process.env.BACKOFFICE_BUILD_DIR ?? ".next",
    "static/chunks/proof-worker",
  );
  const entries = await Promise.all(
    (await readdir(workerDir))
      .filter((name) => name.endsWith(".js"))
      .map(async (name) => ({
        name,
        modified: (await stat(path.join(workerDir, name))).mtimeMs,
      })),
  );
  entries.sort((a, b) => b.modified - a.modified);
  expect(entries.length).toBeGreaterThan(0);
  const workerUrl = new URL(
    `/_next/static/chunks/proof-worker/${entries[0]!.name}`,
    page.url(),
  ).toString();
  const workerResponse = await request.get(workerUrl);
  expect(workerResponse.ok()).toBe(true);
  expect(workerResponse.headers()["content-security-policy"]).toContain(
    "'unsafe-eval'",
  );

  // Production pages must still block JavaScript evaluation from strings.
  const pagePolicy = response!.headers()["content-security-policy"]!;
  if (!pagePolicy.includes("'unsafe-eval'")) {
    await expect(page.locator("html")).toHaveAttribute(
      "data-eval-result",
      "EvalError",
    );
  }

  // Exercise the same JavaScript loader operation as o1js. This runs in the
  // worker script itself, with the server's actual response headers.
  await page.route(workerUrl, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `new Function("return 1")();\n${await response.text()}`,
    });
  });

  // Load the actual contract modules without proof generation or a node.
  const result = await page.evaluate(
    (url) =>
      new Promise<ProverResponse>((resolve, reject) => {
        const probe = new Worker(url);
        const timeout = setTimeout(() => {
          probe.terminate();
          reject(new Error("The proof worker did not respond."));
        }, 20_000);
        probe.onerror = (event) => {
          clearTimeout(timeout);
          probe.terminate();
          reject(new Error(event.message));
        };
        probe.onmessage = (event: MessageEvent<ProverResponse>) => {
          clearTimeout(timeout);
          probe.terminate();
          resolve(event.data);
        };
        probe.postMessage({
          id: "csp-smoke",
          type: "compile",
          config: { proofsEnabled: false },
          includeProposalContracts: false,
        });
      }),
    workerUrl,
  );
  expect(result).toMatchObject({
    id: "csp-smoke",
    ok: true,
    status: { ready: true, phase: "idle", error: null },
  });
});
