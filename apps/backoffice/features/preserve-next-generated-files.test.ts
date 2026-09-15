import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preserveNextGeneratedFiles } from "../e2e/utils/preserve-next-generated-files";

const originalEnv =
  '/// <reference types="next" />\n/// <reference path="./.next/types/routes.d.ts" />\n// Preserve this user comment.\n';
const originalConfig =
  '{\n "compilerOptions": {"strict": true},\n "include": ["**/*.ts", ".next/types/**/*.ts"]\n}\n';
function fixture() {
  const appRoot = mkdtempSync(
    path.join(os.tmpdir(), "backoffice-next-restore-"),
  );
  const env = path.join(appRoot, "next-env.d.ts");
  const config = path.join(appRoot, "tsconfig.json");
  writeFileSync(env, originalEnv);
  writeFileSync(config, originalConfig);
  const restore = preserveNextGeneratedFiles([
    { appRoot, distDir: ".next-e2e-proofs-false" },
  ]);
  const generate = () => {
    writeFileSync(
      env,
      originalEnv.replace("./.next/", "./.next-e2e-proofs-false/"),
    );
    writeFileSync(
      config,
      JSON.stringify(
        {
          compilerOptions: { strict: true },
          include: [
            ".next/types/**/*.ts",
            "**/*.ts",
            ".next-e2e-proofs-false/types/**/*.ts",
          ],
        },
        null,
        2,
      ),
    );
  };
  return { appRoot, env, config, restore, generate };
}

describe("Next generated-file cleanup", () => {
  it("restores exact pre-run bytes after only expected Next changes", () => {
    const f = fixture();
    f.generate();
    f.restore();
    expect(readFileSync(f.env, "utf8")).toBe(originalEnv);
    expect(readFileSync(f.config, "utf8")).toBe(originalConfig);
    f.restore();
  });

  it("preserves files that Next did not change", () => {
    const f = fixture();
    f.restore();
    expect(readFileSync(f.config, "utf8")).toBe(originalConfig);
  });

  it("rejects a concurrent compiler option edit and does not restore either file", () => {
    const f = fixture();
    f.generate();
    const generatedEnv = readFileSync(f.env, "utf8");
    const edited = readFileSync(f.config, "utf8").replace(
      '"strict": true',
      '"strict": false',
    );
    writeFileSync(f.config, edited);
    expect(f.restore).toThrow("Unexpected concurrent edit");
    expect(readFileSync(f.env, "utf8")).toBe(generatedEnv);
    expect(readFileSync(f.config, "utf8")).toBe(edited);
  });

  it("rejects a concurrent type declaration edit", () => {
    const f = fixture();
    f.generate();
    const edited = `${readFileSync(f.env, "utf8")}declare const userValue: string;\n`;
    writeFileSync(f.env, edited);
    expect(f.restore).toThrow("Unexpected concurrent edit");
    expect(readFileSync(f.env, "utf8")).toBe(edited);
  });

  it("rejects unrelated added or removed include paths", () => {
    for (const include of [
      ["**/*.ts", ".next/types/**/*.ts", "unrelated/**/*.ts"],
      [".next-e2e-proofs-false/types/**/*.ts"],
    ]) {
      const f = fixture();
      const edited = JSON.stringify({
        compilerOptions: { strict: true },
        include,
      });
      writeFileSync(f.config, edited);
      expect(f.restore).toThrow("Unexpected concurrent edit");
      expect(readFileSync(f.config, "utf8")).toBe(edited);
    }
  });
});
