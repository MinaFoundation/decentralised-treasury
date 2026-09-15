export const evidenceLanes = [
  "ORACLE",
  "HOST",
  "CONSTRAINT",
  "PROOF_AUTHENTICITY",
  "CONTRACT",
  "EXTERNAL_PARITY",
  "PROOF_MODE_PARITY",
  "RESILIENCE",
  "PERFORMANCE",
  "CHARACTERIZATION",
  "UNRESOLVED",
  "STATIC_ONLY",
] as const;

export type EvidenceLane = (typeof evidenceLanes)[number];

export const phasePolicies = [
  "paired-semantic",
  "proof-authenticity",
  "transport-only",
  "host-dual",
  "lightnet-operational",
  "external-exception",
] as const;

export type PhasePolicy = (typeof phasePolicies)[number];
export type ProofMode = "proof-off" | "proof-on";
export type RiskPriority = "P0" | "P1" | "P2";
export type PolicyStatus = "conformance" | "characterization" | "unresolved";

export const expectedOutcomes = [
  "accept",
  "reject",
  "record",
  "not-applicable",
] as const;

export type ExpectedOutcome = (typeof expectedOutcomes)[number];

export const failureClasses = [
  "INPUT_VALIDATION",
  "HOST_PREFLIGHT",
  "CONSTRAINT_UNSATISFIED",
  "PROOF_VERIFICATION",
  "TRANSACTION_PRECONDITION",
  "STORAGE_FAILURE",
  "DEPENDENCY_FAILURE",
  "TIMEOUT",
] as const;

export type FailureClass = (typeof failureClasses)[number];

export interface SourceBinding {
  readonly path: string;
  readonly symbols: readonly string[];
}

export interface ModeExpectation {
  readonly outcome: ExpectedOutcome;
  readonly failureClass?: FailureClass;
  readonly note: string;
}

export interface AssuranceCase {
  readonly id: string;
  readonly family: string;
  readonly title: string;
  readonly component: string;
  readonly sources: readonly SourceBinding[];
  readonly claims: readonly EvidenceLane[];
  readonly priority: RiskPriority;
  readonly phasePolicy: PhasePolicy;
  readonly policyStatus: PolicyStatus;
  readonly policyIds?: readonly `POL-${string}`[];
  readonly fixture: string;
  readonly proofOff: ModeExpectation;
  readonly proofOn: ModeExpectation;
}

export interface AssuranceLeaf {
  readonly id: string;
  readonly caseId: string;
  readonly claim: EvidenceLane;
  readonly mode: ProofMode;
  readonly executable: boolean;
  readonly expectation: ModeExpectation;
}

export function defineCases<const T extends readonly AssuranceCase[]>(
  cases: T,
): T {
  return cases;
}

export function expandCaseLeaves(
  cases: readonly AssuranceCase[],
): AssuranceLeaf[] {
  return cases.flatMap((testCase) =>
    testCase.claims.flatMap((claim) =>
      (["proof-off", "proof-on"] as const).map((mode) => {
        const expectation =
          mode === "proof-off" ? testCase.proofOff : testCase.proofOn;
        return {
          id: `${testCase.id}:${claim}:${mode}`,
          caseId: testCase.id,
          claim,
          mode,
          executable: expectation.outcome !== "not-applicable",
          expectation,
        };
      }),
    ),
  );
}
