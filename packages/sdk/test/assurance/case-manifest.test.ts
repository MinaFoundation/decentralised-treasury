import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assuranceCases,
  assuranceLeaves,
  summarizeManifest,
  validateManifest,
} from "./case-manifest.js";
import { evidenceLanes, failureClasses } from "./case-types.js";

const repositoryRoot = existsSync(resolve(process.cwd(), "packages/sdk"))
  ? process.cwd()
  : resolve(process.cwd(), "../..");
const frozenSummary = {
  logicalCases: 343,
  plannedLeaves: 1_424,
  executableLeaves: 1_414,
  proofOffLeaves: 705,
  proofOnLeaves: 709,
  families: {
    "PRIM-ACCOUNT": 14,
    "PRIM-MERKLE": 17,
    "ZK-STLV-DIGEST": 31,
    "ZK-STLV-MERGE": 30,
    "ZK-STLV-EXHAUST": 22,
    "ZK-VOTE-REDUCE": 35,
    "ZK-VOTE-MERGE": 15,
    "ZK-VOTE-HISTORY": 8,
    "SC-OWNER": 29,
    "SC-PROPOSAL": 28,
    "SC-PAUSE": 22,
    "ART-PROOF": 19,
    "OPS-QUEUE": 10,
    "OPS-RESTART": 20,
    "CALL-INTENT": 18,
    "CALL-PROJECTION": 7,
    "E2E-LOCAL": 3,
    "E2E-LIGHTNET": 3,
    "QA-COVERAGE": 6,
    "QA-PERFORMANCE": 6,
  },
} as const;

test("assurance case manifest", async (t) => {
  await t.test("has no schema or closure problems", () => {
    assert.deepEqual(validateManifest(), []);
  });

  await t.test("has unique logical and leaf IDs", () => {
    assert.equal(
      new Set(assuranceCases.map(({ id }) => id)).size,
      assuranceCases.length,
    );
    assert.equal(
      new Set(assuranceLeaves.map(({ id }) => id)).size,
      assuranceLeaves.length,
    );
  });

  await t.test("has one proof-off and proof-on leaf per evidence claim", () => {
    for (const testCase of assuranceCases) {
      for (const claim of testCase.claims) {
        const leaves = assuranceLeaves.filter(
          (leaf) => leaf.caseId === testCase.id && leaf.claim === claim,
        );
        assert.deepEqual(
          leaves.map(({ mode }) => mode).sort(),
          ["proof-off", "proof-on"],
          `${testCase.id}:${claim}`,
        );
      }
    }
  });

  await t.test("matches the frozen current-HEAD count", () => {
    assert.deepEqual(summarizeManifest(), frozenSummary);
  });

  await t.test("binds every case to an existing repository source", () => {
    for (const testCase of assuranceCases) {
      for (const source of testCase.sources) {
        assert.ok(
          existsSync(resolve(repositoryRoot, source.path)),
          `${testCase.id}: missing source ${source.path}`,
        );
      }
    }
  });

  await t.test("represents every evidence lane and failure class", () => {
    const representedClaims = new Set(
      assuranceCases.flatMap((testCase) => testCase.claims),
    );
    const representedFailures = new Set(
      assuranceCases.flatMap((testCase) =>
        [testCase.proofOff, testCase.proofOn].flatMap((expectation) =>
          expectation.failureClass === undefined
            ? []
            : [expectation.failureClass],
        ),
      ),
    );

    assert.deepEqual([...representedClaims].sort(), [...evidenceLanes].sort());
    assert.deepEqual(
      [...representedFailures].sort(),
      [...failureClasses].sort(),
    );
  });

  await t.test("prints the reproducible count", (t) => {
    t.diagnostic(JSON.stringify(summarizeManifest()));
  });
});
