import assert from "node:assert/strict";

interface ProjectedTally {
  createdByEventType: string;
  blockHeight: number;
  sourceStatus: string;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  totalParticipatingVotes: string | null;
}

export function assertRunningAndFinalTallies<T extends ProjectedTally>(
  tallies: T[],
  expectedRunningWeights: string[],
): T {
  assert.ok(expectedRunningWeights.length > 0);
  assert.equal(tallies.length, expectedRunningWeights.length + 1);
  const running = tallies
    .filter((tally) => tally.createdByEventType === "proposalVoteDispatched")
    .sort((left, right) => left.blockHeight - right.blockHeight);
  const final = tallies.filter(
    (tally) => tally.createdByEventType === "proposalVotesTallied",
  );
  assert.equal(running.length, expectedRunningWeights.length);
  assert.equal(final.length, 1);
  assert.equal(
    new Set(running.map((tally) => tally.blockHeight)).size,
    running.length,
  );
  assert.ok(final[0]!.blockHeight > running.at(-1)!.blockHeight);
  for (const [index, tally] of [...running, final[0]!].entries()) {
    const expectedWeight =
      expectedRunningWeights[
        Math.min(index, expectedRunningWeights.length - 1)
      ];
    assert.equal(tally.sourceStatus, "canonical");
    assert.equal(tally.yayWeight, expectedWeight);
    assert.equal(tally.totalParticipatingVotes, expectedWeight);
    assert.equal(tally.nayWeight, "0");
    assert.equal(tally.abstainWeight, "0");
  }
  return final[0]!;
}

export interface ApprovedProposalProjectionStatus {
  status: string;
  creationObservationStatus: string;
  contractStatus: string;
  contractStatusFinality: string;
}

export function assertApprovedProposalProjectionStatus(
  proposal: ApprovedProposalProjectionStatus,
): void {
  assert.equal(
    proposal.status,
    "canonical",
    "proposal status must describe the canonical creation observation",
  );
  assert.equal(
    proposal.creationObservationStatus,
    "canonical",
    "proposal creationObservationStatus must be canonical",
  );
  assert.equal(
    proposal.contractStatus,
    "approved",
    "proposal contractStatus must contain the approved contract outcome",
  );
  assert.equal(
    proposal.contractStatusFinality,
    "canonical",
    "proposal contractStatusFinality must be canonical",
  );
}
