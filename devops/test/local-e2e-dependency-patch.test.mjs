import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("the pinned Ledger patch includes both browser and Node transport implementations", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  const patchPath =
    manifest.pnpm.patchedDependencies["@ledgerhq/hw-transport-webhid@6.36.0"];
  assert.equal(
    patchPath,
    "patches/@ledgerhq__hw-transport-webhid@6.36.0.patch",
  );
  const patch = await readFile(new URL(patchPath, root), "utf8");
  for (const file of [
    "src/TransportWebHID.ts",
    "lib/TransportWebHID.js",
    "lib-es/TransportWebHID.js",
  ])
    assert.ok(
      patch.includes(`diff --git a/${file} b/${file}`),
      `${file} is not patched`,
    );
});

test("the container build copies dependency patches before frozen installation", async () => {
  const dockerfile = await readFile(
    new URL("devops/docker/Dockerfile", root),
    "utf8",
  );
  const copy = dockerfile.indexOf("COPY --chown=node:node patches/ patches/");
  const install = dockerfile.indexOf("RUN pnpm install --frozen-lockfile");
  assert.ok(
    copy >= 0 && install > copy,
    "Patch files must exist before dependency installation",
  );
});
