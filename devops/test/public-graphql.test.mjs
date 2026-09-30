import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(
  new URL("../../apps/docs/package.json", import.meta.url),
);
const { parse } = require("yaml");

test("public daemon and Treasury ingress use the restricted GraphQL service", async () => {
  const read = async (path) =>
    parse(
      await readFile(
        new URL(`../runbooks/${path}/helmfile.yaml`, import.meta.url),
        "utf8",
      ),
    );
  const network = await read("1-Network/1b-Mina-Daemon");
  const resources = network.releases.find(
    (release) => release.name === "graphql-proxy",
  ).values[0].resources;
  const ingress = resources.find((resource) => resource.kind === "Ingress");
  for (const rule of ingress.spec.rules) {
    for (const path of rule.http.paths)
      assert.equal(path.backend.service.port.number, 3000);
  }
  const stackText = await readFile(
    new URL(
      "../runbooks/2-Treasury/2c-Deploy-Stack/helmfile.yaml",
      import.meta.url,
    ),
    "utf8",
  );
  const stack = parse(stackText.split("\n---")[0]);
  const upstreams = stack.environments.default.values.filter(
    (value) => value.minaNodeUpstream,
  );
  assert.ok(upstreams.length > 0);
  for (const value of upstreams)
    assert.equal(new URL(value.minaNodeUpstream).port, "3000");
});
