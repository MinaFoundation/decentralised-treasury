import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test(
  "Docker excludes private and generated files and retains application files",
  {
    skip: process.env.DOCKER_IGNORE_TEST !== "true",
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "treasury-docker-ignore-"));
    const context = path.join(root, "context");
    const output = path.join(root, "output");
    try {
      await mkdir(context);
      await writeFile(
        path.join(context, ".dockerignore"),
        await readFile(new URL("../../.dockerignore", import.meta.url)),
      );
      await writeFile(
        path.join(context, "Dockerfile"),
        "FROM scratch\nCOPY . /\n",
      );
      const excludedPaths = [
        ".env",
        ".env.production",
        ".env.example",
        "devops/.env.testnet",
        "apps/api/.env",
        "apps/web/.env.local",
        "apps/web/nested/.env.example",
        "packages/sdk/.env.testnet",
        "output/audit/report.json",
        "tmp/generated/artifact.json",
      ];
      const retainedPaths = [
        "package.json",
        "apps/api/src/index.ts",
        "devops/docker/start.sh",
      ];
      for (const file of [...excludedPaths, ...retainedPaths]) {
        await mkdir(path.dirname(path.join(context, file)), {
          recursive: true,
        });
        await writeFile(path.join(context, file), "synthetic-test-data\n");
      }
      execFileSync(
        "docker",
        [
          "buildx",
          "build",
          "--network=none",
          "--no-cache",
          "--output",
          `type=local,dest=${output}`,
          context,
        ],
        { stdio: "pipe" },
      );
      for (const file of excludedPaths) {
        await assert.rejects(readFile(path.join(output, file)), {
          code: "ENOENT",
        });
      }
      for (const file of retainedPaths) {
        assert.equal(
          await readFile(path.join(output, file), "utf8"),
          "synthetic-test-data\n",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
