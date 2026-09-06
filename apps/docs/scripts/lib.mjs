import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const docsAppRoot = path.resolve(SCRIPT_DIR, "..");
export const repositoryRoot = path.resolve(docsAppRoot, "..", "..");
export const docsRoot = path.join(docsAppRoot, "docs");

export const MAIN_AUDIENCES = ["user", "operator"];
export const PAGE_KINDS = ["navigation", "concept", "procedure", "reference"];

let yamlModule;

export async function parseYaml(text, sourceName) {
  try {
    yamlModule ??= await import("yaml");
  } catch (error) {
    throw new Error(
      `Cannot load the "yaml" package. Add it to apps/docs devDependencies. (${error.message})`,
    );
  }

  try {
    return yamlModule.parse(text, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    throw new Error(`${sourceName}: YAML parse error: ${error.message}`);
  }
}

export async function listFiles(root, extensions) {
  const results = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (
        entry.isFile() &&
        extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        results.push(fullPath);
      }
    }
  }

  await visit(root);
  return results;
}

export function relativeToRepository(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

export function relativeToDocs(filePath) {
  return path.relative(docsRoot, filePath).split(path.sep).join("/");
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function addError(errors, source, message) {
  errors.push(`${source}: ${message}`);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function printErrors(errors) {
  for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
  if (errors.length > 0) {
    process.stderr.write(
      `Documentation checks found ${errors.length} error(s).\n`,
    );
  }
}

export function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
