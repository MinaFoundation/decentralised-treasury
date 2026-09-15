import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { allProofOffFiles } from "./proof-off-files.mjs";
import { assuranceCases } from "./case-manifest.js";

const groupedCaseIdPattern =
  /\b((?:ART|CALL|E2E|OPS|PRIM|QA|SC|ZK)-[A-Z0-9]+(?:-[A-Z0-9]+)*)-(\d{3})((?:\/\d{3})*)\b/gu;

const repositoryRoot = resolve(
  process.cwd(),
  process.cwd().endsWith("/packages/sdk") ? "../.." : ".",
);

test("proof-off file and logical-case closure", async (t) => {
  assert.equal(new Set(allProofOffFiles).size, allProofOffFiles.length);
  assert.ok(
    allProofOffFiles.every((path) => !path.includes("proof-on")),
    "the proof-off controller must not include a proof-on file",
  );

  const knownCaseIds = new Set(assuranceCases.map(({ id }) => id));
  const implementedCaseIds = new Set<string>();

  for (const path of allProofOffFiles) {
    const source = await readFile(resolve(repositoryRoot, path), "utf8");
    for (const match of source.matchAll(groupedCaseIdPattern)) {
      const [, prefix, firstNumber, otherNumbers] = match;
      const numbers = [firstNumber, ...otherNumbers.split("/").filter(Boolean)];
      for (const number of numbers) {
        const caseId = `${prefix}-${number}`;
        assert.ok(
          knownCaseIds.has(caseId),
          `${path}: unknown case ID ${caseId}`,
        );
        implementedCaseIds.add(caseId);
      }
    }
  }

  const families: Record<string, number> = {};
  for (const testCase of assuranceCases) {
    if (implementedCaseIds.has(testCase.id)) {
      families[testCase.family] = (families[testCase.family] ?? 0) + 1;
    }
  }

  t.diagnostic(
    JSON.stringify({
      plannedLogicalCases: assuranceCases.length,
      implementedProofOffLogicalCases: implementedCaseIds.size,
      openProofOffLogicalCases: assuranceCases.length - implementedCaseIds.size,
      families,
    }),
  );
});
