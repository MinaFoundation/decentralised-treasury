#!/usr/bin/env node
//
// Ensures the SQLITE_DATA_HOST_PATH directory referenced by a Compose env
// file exists and is writable by the "docker" group. Compose containers in
// this stack run as the image's built-in non-root "node" user (uid/gid 1000
// from the node:*-bookworm-slim base image), which happens to match this
// host's "docker" group gid — so group-writable + setgid lets both the
// container and any host operator in the "docker" group (e.g. mina) write
// here, without needing to chown to a specific uid or run anything as root.
//
// Run this before "docker compose ... up" whenever SQLITE_DATA_HOST_PATH
// might not exist yet: Docker auto-creates missing bind-mount sources as
// root, which the container's non-root user then can't write into
// (SQLITE_CANTOPEN).

import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKER_GROUP = "docker";
const DIR_MODE = 0o2775; // rwxrwsr-x; setgid keeps new entries owned by the group

const DEVOPS_DIR = fileURLToPath(new URL("..", import.meta.url));

const [, , envFilePath] = process.argv;
if (!envFilePath) {
  console.error("Usage: ensure-sqlite-data-dir.mjs <path-to-compose-env-file>");
  process.exit(1);
}

const envContent = readFileSync(envFilePath, "utf8");
const match = envContent.match(/^SQLITE_DATA_HOST_PATH=(.+)$/m);
if (!match) {
  console.error(`SQLITE_DATA_HOST_PATH not set in ${envFilePath}; nothing to do.`);
  process.exit(0);
}

const rawPath = match[1].trim();
const targetPath = isAbsolute(rawPath) ? rawPath : resolve(DEVOPS_DIR, rawPath);

mkdirSync(targetPath, { recursive: true });
chmodSync(targetPath, DIR_MODE);

try {
  execFileSync("chgrp", [DOCKER_GROUP, targetPath]);
} catch (error) {
  console.error(
    `Could not set group "${DOCKER_GROUP}" on ${targetPath}. Containers running as the ` +
      `non-root "node" user won't be able to write here otherwise. Run this as the directory's ` +
      `owner (or root) while a member of the "${DOCKER_GROUP}" group.`,
  );
  throw error;
}

console.log(`Ensured ${targetPath} exists and is writable by the "${DOCKER_GROUP}" group.`);
