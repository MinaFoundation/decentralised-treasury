export const proofOffFiles = [
  "packages/sdk/test/assurance/case-manifest.test.ts",
  "devops/test/assurance/caller-intent-proof-off.test.mjs",
  "devops/test/assurance/external-exceptions.proof-off.test.mjs",
  "devops/test/assurance/processor-readiness-proof-off.test.mjs",
  "packages/sdk/test/assurance/artifacts/proof-artifact-transport.proof-off.test.ts",
  "packages/sdk/test/assurance/contracts/authorization.proof-off.test.ts",
  "packages/sdk/test/assurance/contracts/owner-proposal/boundaries.proof-off.test.ts",
  "packages/sdk/test/assurance/contracts/owner-proposal/payout-pause.proof-off.test.ts",
  "packages/sdk/test/assurance/contracts/owner-proposal/tally-execute.proof-off.test.ts",
  "packages/sdk/test/assurance/contracts/pause/pause-controller.proof-off.test.ts",
  "packages/sdk/test/assurance/e2e/local-treasury-lifecycle.proof-off.test.ts",
  "packages/sdk/test/assurance/fixtures/deterministic.test.ts",
  "packages/sdk/test/assurance/fixtures/ledgers/strict-ledgers.test.ts",
  "packages/sdk/test/assurance/native-backend.test.ts",
  "packages/sdk/test/assurance/primitive/account-encoding.test.ts",
  "packages/sdk/test/assurance/primitive/account-hashing.test.ts",
  "packages/sdk/test/assurance/primitive/merkle-boundaries.test.ts",
  "packages/sdk/test/assurance/primitive/prefixed-merkle-tree.test.ts",
  "packages/sdk/test/assurance/proof-off-closure.test.ts",
  "packages/sdk/test/assurance/stlv/digest-proof-off.test.ts",
  "packages/sdk/test/assurance/stlv/merge-exhaust-proof-off.test.ts",
  "packages/sdk/test/assurance/operations/queue-restart.proof-off.test.ts",
  "packages/sdk/test/assurance/services/proof-service-lifecycle.proof-off.test.ts",
  "packages/sdk/test/assurance/vote-reducer/reduce-batch.proof-off.test.ts",
  "packages/sdk/test/assurance/vote-reducer/merge.proof-off.test.ts",
  "packages/sdk/test/assurance/vote-reducer/history-wrapper.proof-off.test.ts",
];

export const proofOffApiFiles = [
  "devops/test/assurance/projection-proof-off.test.mjs",
];

export const proofOffPostCoverageFiles = [
  "devops/test/assurance/lcov/sdk-proof-off-lcov.test.mjs",
  "devops/test/assurance/quality/coverage-closure.proof-off.test.mjs",
  "devops/test/assurance/quality/performance-observations.proof-off.test.mjs",
];

export const allProofOffFiles = [
  ...proofOffFiles,
  ...proofOffApiFiles,
  ...proofOffPostCoverageFiles,
];
