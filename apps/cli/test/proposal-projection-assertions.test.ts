import assert from "node:assert/strict";
import test from "node:test";
import {
  assertApprovedProposalProjectionStatus,
  assertRunningAndFinalTallies,
  type ApprovedProposalProjectionStatus,
} from "./utils/proposal-projection-assertions.js";

const APPROVED_PROJECTION: ApprovedProposalProjectionStatus = {
  status: "canonical",
  creationObservationStatus: "canonical",
  contractStatus: "approved",
  contractStatusFinality: "canonical",
};

const weights = ["0", "10", "10", "30", "18446744073709551615"];
function tallyRows() {
  return [...weights, weights.at(-1)!].map((weight, index) => ({
    createdByEventType:
      index < weights.length
        ? "proposalVoteDispatched"
        : "proposalVotesTallied",
    blockHeight: index + 10,
    sourceStatus: "canonical",
    yayWeight: weight,
    totalParticipatingVotes: weight,
    nayWeight: "0",
    abstainWeight: "0",
  }));
}

test("checks five running tallies and selects the final tally independent of response order", () => {
  const rows = tallyRows().reverse();
  assert.equal(assertRunningAndFinalTallies(rows, weights), rows[0]);
});

for (const [name, mutate] of [
  [
    "missing running row",
    (rows) => {
      rows.splice(2, 1);
    },
  ],
  [
    "missing final row",
    (rows) => {
      rows.pop();
    },
  ],
  [
    "duplicate final row",
    (rows) => {
      rows.push({ ...rows.at(-1)! });
    },
  ],
  [
    "unknown event type",
    (rows) => {
      rows[0]!.createdByEventType = "unknown";
    },
  ],
  [
    "pending source",
    (rows) => {
      rows[0]!.sourceStatus = "pending";
    },
  ],
  [
    "wrong running weight",
    (rows) => {
      rows[1]!.yayWeight = "11";
    },
  ],
  [
    "wrong final weight",
    (rows) => {
      rows.at(-1)!.yayWeight = "0";
    },
  ],
  [
    "wrong participation",
    (rows) => {
      rows[0]!.totalParticipatingVotes = "1";
    },
  ],
  [
    "unexpected nay",
    (rows) => {
      rows[0]!.nayWeight = "1";
    },
  ],
  [
    "unexpected abstain",
    (rows) => {
      rows[0]!.abstainWeight = "1";
    },
  ],
  [
    "duplicate running height",
    (rows) => {
      rows[1]!.blockHeight = rows[0]!.blockHeight;
    },
  ],
  [
    "final before last vote",
    (rows) => {
      rows.at(-1)!.blockHeight = 10;
    },
  ],
] satisfies Array<[string, (rows: ReturnType<typeof tallyRows>) => void]>) {
  test(`rejects invalid tally relation: ${name}`, () => {
    const rows = tallyRows();
    mutate(rows);
    assert.throws(() => assertRunningAndFinalTallies(rows, weights));
  });
}

test("accepts separate canonical creation and approved contract status fields", () => {
  assert.doesNotThrow(() =>
    assertApprovedProposalProjectionStatus(APPROVED_PROJECTION),
  );
});

test("rejects invalid approved proposal status partitions by field", async (context) => {
  const cases: Array<{
    name: string;
    change: Partial<ApprovedProposalProjectionStatus>;
    error: RegExp;
  }> = [
    {
      name: "pending legacy status",
      change: { status: "pending" },
      error:
        /proposal status must describe the canonical creation observation/u,
    },
    {
      name: "contract outcome incorrectly placed in legacy status",
      change: { status: "approved" },
      error:
        /proposal status must describe the canonical creation observation/u,
    },
    {
      name: "pending creation observation status",
      change: { creationObservationStatus: "pending" },
      error: /proposal creationObservationStatus must be canonical/u,
    },
    {
      name: "wrong contract outcome",
      change: { contractStatus: "rejected" },
      error:
        /proposal contractStatus must contain the approved contract outcome/u,
    },
    {
      name: "creation finality incorrectly placed in contract status",
      change: { contractStatus: "canonical" },
      error:
        /proposal contractStatus must contain the approved contract outcome/u,
    },
    {
      name: "pending contract status finality",
      change: { contractStatusFinality: "pending" },
      error: /proposal contractStatusFinality must be canonical/u,
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      assert.throws(
        () =>
          assertApprovedProposalProjectionStatus({
            ...APPROVED_PROJECTION,
            ...fixture.change,
          }),
        fixture.error,
      );
    });
  }
});
