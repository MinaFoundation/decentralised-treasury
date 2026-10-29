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

test("the daemon keeps its full GraphQL API private and allows only sendZkapp", async () => {
  const text = await readFile(
    new URL(
      "../runbooks/1-Network/1b-Mina-Daemon/helmfile.yaml",
      import.meta.url,
    ),
    "utf8",
  );
  const network = parse(text);
  const daemon = network.releases.find((release) => release.name === "node-0");
  const [major, minor] = daemon.chart
    .match(/mina-daemon-(\d+)\.(\d+)\./)
    .slice(1)
    .map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 3), daemon.chart);
  const values = daemon.values[0];
  assert.equal(values.node.graphqlListen, "localhost");
  assert.deepEqual(values.graphqlPublicProxy.allowedMutations, ["sendZkapp"]);
  const service = network.releases
    .find((release) => release.name === "graphql-proxy")
    .values[0].resources.find((resource) => resource.kind === "Service");
  assert.deepEqual(
    service.spec.ports.map((port) => port.port),
    [3000],
  );
});

test("server-side treasury and ledger reads use the filtered proxy", async () => {
  const read = (path) =>
    readFile(
      new URL(`../runbooks/${path}/helmfile.yaml`, import.meta.url),
      "utf8",
    );
  const stack = await read("2-Treasury/2c-Deploy-Stack");
  const stackUrls = [...stack.matchAll(/^\s*minaNodeUrl:\s*(\S+)/gm)].map(
    (match) => match[1],
  );
  assert.ok(stackUrls.length > 0);
  for (const url of stackUrls) assert.equal(new URL(url).port, "3000");
  const provider = parse(await read("1-Network/1c-Staking-Ledger-Provider"))
    .releases[0].values[0];
  assert.equal(new URL(provider.minaNodeUrl).port, "3000");
  assert.equal(provider.minaGraphqlPort, 3000);
});
