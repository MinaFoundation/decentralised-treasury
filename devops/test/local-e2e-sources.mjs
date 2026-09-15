import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dependencyPatchPattern = "patches/**/*.patch";

export async function fingerprintSources(root, paths) {
  const hash = createHash("sha256");
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    const content = await readFile(join(root, path));
    hash.update(path).update("\0").update(content).update("\0");
    files.push({
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return { hash: hash.digest("hex"), files };
}

export function changedSourcePaths(before, after) {
  const previous = new Map(
    before.files.map(({ path, sha256 }) => [path, sha256]),
  );
  const current = new Map(
    after.files.map(({ path, sha256 }) => [path, sha256]),
  );
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((path) => previous.get(path) !== current.get(path))
    .sort();
}
