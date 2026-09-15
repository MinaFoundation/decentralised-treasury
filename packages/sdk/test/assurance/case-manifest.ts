import { primitiveCases } from "./catalog/primitive-cases.js";
import { stlvCases } from "./catalog/stlv-cases.js";
import { systemCases } from "./catalog/system-cases.js";
import { voteAndContractCases } from "./catalog/vote-contract-cases.js";
import {
  evidenceLanes,
  expandCaseLeaves,
  phasePolicies,
  type AssuranceCase,
} from "./case-types.js";

export const assuranceCases: readonly AssuranceCase[] = [
  ...primitiveCases,
  ...stlvCases,
  ...voteAndContractCases,
  ...systemCases,
];

export const assuranceLeaves = expandCaseLeaves(assuranceCases);

export interface ManifestSummary {
  readonly logicalCases: number;
  readonly plannedLeaves: number;
  readonly executableLeaves: number;
  readonly proofOffLeaves: number;
  readonly proofOnLeaves: number;
  readonly families: Readonly<Record<string, number>>;
}

export function summarizeManifest(): ManifestSummary {
  const families: Record<string, number> = {};
  for (const testCase of assuranceCases) {
    families[testCase.family] = (families[testCase.family] ?? 0) + 1;
  }

  return {
    logicalCases: assuranceCases.length,
    plannedLeaves: assuranceLeaves.length,
    executableLeaves: assuranceLeaves.filter((leaf) => leaf.executable).length,
    proofOffLeaves: assuranceLeaves.filter(
      (leaf) => leaf.executable && leaf.mode === "proof-off",
    ).length,
    proofOnLeaves: assuranceLeaves.filter(
      (leaf) => leaf.executable && leaf.mode === "proof-on",
    ).length,
    families,
  };
}

export function validateManifest(): string[] {
  const problems: string[] = [];
  const caseIds = new Set<string>();
  const leafIds = new Set<string>();
  const knownClaims = new Set<string>(evidenceLanes);
  const knownPhasePolicies = new Set<string>(phasePolicies);

  for (const testCase of assuranceCases) {
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+-\d{3}$/.test(testCase.id)) {
      problems.push(`${testCase.id}: invalid case ID`);
    }
    if (caseIds.has(testCase.id)) {
      problems.push(`${testCase.id}: duplicate case ID`);
    }
    caseIds.add(testCase.id);

    if (testCase.claims.length === 0) {
      problems.push(`${testCase.id}: no evidence claim`);
    }
    if (new Set(testCase.claims).size !== testCase.claims.length) {
      problems.push(`${testCase.id}: duplicate evidence claim`);
    }
    for (const claim of testCase.claims) {
      if (!knownClaims.has(claim)) {
        problems.push(`${testCase.id}: unknown evidence claim ${claim}`);
      }
    }

    if (!knownPhasePolicies.has(testCase.phasePolicy)) {
      problems.push(
        `${testCase.id}: unknown phase policy ${testCase.phasePolicy}`,
      );
    }
    if (
      (testCase.proofOff.outcome === "not-applicable" ||
        testCase.proofOn.outcome === "not-applicable") &&
      testCase.phasePolicy !== "lightnet-operational" &&
      testCase.phasePolicy !== "external-exception"
    ) {
      problems.push(`${testCase.id}: unapproved mode exception policy`);
    }
    if (
      testCase.policyStatus === "conformance" &&
      testCase.claims.some((claim) => claim === "UNRESOLVED")
    ) {
      problems.push(`${testCase.id}: conformance case has UNRESOLVED evidence`);
    }
    if (
      testCase.policyStatus !== "conformance" &&
      (!testCase.policyIds || testCase.policyIds.length === 0)
    ) {
      problems.push(`${testCase.id}: policy-sensitive case has no policy ID`);
    }

    for (const [mode, expectation] of [
      ["proof-off", testCase.proofOff],
      ["proof-on", testCase.proofOn],
    ] as const) {
      if (
        expectation.outcome === "reject" &&
        expectation.failureClass === undefined
      ) {
        problems.push(`${testCase.id}:${mode}: rejection has no failure class`);
      }
      if (
        expectation.outcome !== "reject" &&
        expectation.failureClass !== undefined
      ) {
        problems.push(
          `${testCase.id}:${mode}: non-rejection has a failure class`,
        );
      }
    }

    if (testCase.sources.length === 0) {
      problems.push(`${testCase.id}: no source binding`);
    }
    for (const source of testCase.sources) {
      if (source.path.startsWith("/") || source.path.includes("..")) {
        problems.push(
          `${testCase.id}: source path must be repository-relative`,
        );
      }
      if (source.symbols.length === 0) {
        problems.push(`${testCase.id}: ${source.path} has no bound symbol`);
      }
    }
  }

  for (const leaf of assuranceLeaves) {
    if (leafIds.has(leaf.id)) {
      problems.push(`${leaf.id}: duplicate leaf ID`);
    }
    leafIds.add(leaf.id);
  }

  return problems;
}
