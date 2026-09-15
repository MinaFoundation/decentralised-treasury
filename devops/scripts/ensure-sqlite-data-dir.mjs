#!/usr/bin/env node
//
// Ensures the SQLITE_DATA_HOST_PATH directory referenced by a Compose env
// file exists. On the Linux deployment host, the "docker" group gid matches
// the container's "node" user gid (1000). Group write access and setgid let
// containers and host operators share the directory.
// On macOS, Docker shares host files through its Linux VM. Keep the host
// directory's group because macOS does not require a "docker" group.
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

if (process.platform === "darwin") {
  console.log(`Ensured ${targetPath} exists for Docker file sharing on macOS.`);
  process.exit(0);
}

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
