import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

type App = { appRoot: string; distDir: string };
type Snapshot = {
  path: string;
  before: string;
  validate(after: string): boolean;
};

function validConfigChange(
  before: string,
  after: string,
  distDir: string,
): boolean {
  const original = JSON.parse(before) as Record<string, unknown>;
  const current = JSON.parse(after) as Record<string, unknown>;
  const originalIncludes = original.include;
  const currentIncludes = current.include;
  if (!Array.isArray(originalIncludes) || !Array.isArray(currentIncludes))
    return false;
  delete original.include;
  delete current.include;
  if (!isDeepStrictEqual(original, current)) return false;
  // Next can reorder includes and append its current generated types directory.
  const remaining = [...currentIncludes];
  for (const value of originalIncludes) {
    const index = remaining.indexOf(value);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return (
    remaining.length <= 1 &&
    remaining.every((value) => value === `${distDir}/types/**/*.ts`)
  );
}

/** Capture exact originals. Call the returned guard only after all Next processes stop. */
export function preserveNextGeneratedFiles(apps: App[]): () => void {
  const snapshots: Snapshot[] = [];
  for (const { appRoot, distDir } of apps) {
    if (!/^\.next(?:-[a-z0-9-]+)?$/.test(distDir))
      throw new Error(`Unsupported test distDir: ${distDir}`);
    const envPath = path.join(appRoot, "next-env.d.ts");
    const configPath = path.join(appRoot, "tsconfig.json");
    const env = readFileSync(envPath, "utf8");
    const config = readFileSync(configPath, "utf8");
    snapshots.push(
      {
        path: envPath,
        before: env,
        validate: (after) =>
          after ===
          env.replace(
            /^\/\/\/ <reference path="\.\/[^"\n]+\/types\/routes\.d\.ts" \/>$/m,
            `/// <reference path="./${distDir}/types/routes.d.ts" />`,
          ),
      },
      {
        path: configPath,
        before: config,
        validate: (after) => validConfigChange(config, after, distDir),
      },
    );
  }
  return () => {
    // Validate every file before restoring any file. Never erase a concurrent source edit.
    const changes = snapshots.map((snapshot) => ({
      ...snapshot,
      after: readFileSync(snapshot.path, "utf8"),
    }));
    for (const change of changes) {
      let valid = change.after === change.before;
      if (!valid) {
        try {
          valid = change.validate(change.after);
        } catch {
          valid = false;
        }
      }
      if (!valid)
        throw new Error(
          `Unexpected concurrent edit; Next cleanup did not restore any files: ${change.path}`,
        );
    }
    for (const change of changes) {
      if (readFileSync(change.path, "utf8") !== change.after)
        throw new Error(`File changed during Next cleanup: ${change.path}`);
      if (change.after !== change.before)
        writeFileSync(change.path, change.before);
    }
  };
}
