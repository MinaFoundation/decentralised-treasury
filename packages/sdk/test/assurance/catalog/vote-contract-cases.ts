import {
  defineCases,
  type AssuranceCase,
  type EvidenceLane,
  type FailureClass,
  type SourceBinding,
} from "../case-types.js";

const voteSource = {
  path: "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
  symbols: [
    "Vote.assertValid",
    "VoteAction.isDummy",
    "VoteReducer.reduceBatch",
  ],
} as const;

const voteMergeSource = {
  path: "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
  symbols: ["VoteReducer.merge", "SideLoadedVoteReducerProof"],
} as const;

const voteTracerSource = {
  path: "packages/sdk/src/proving/tracing/vote-reducer-tracer.ts",
  symbols: ["VoteReducerTracer.runBatch"],
} as const;

const voteProverSource = {
  path: "packages/sdk/src/proving/prover/vote-reducer-prover.ts",
  symbols: [
    "VoteReducerProver.findMergeableProofs",
    "VoteReducerProver.runBatch",
  ],
} as const;

const ownerSource = {
  path: "packages/sdk/src/provable/contracts/treasury-owner.ts",
  symbols: [
    "TreasuryOwnerSmartContract.createProposal",
    "TreasuryOwnerSmartContract.vote",
    "TreasuryOwnerSmartContract.tallyVotes",
    "TreasuryOwnerSmartContract.executeProposal",
    "TreasuryOwnerSmartContract.togglePauseProposal",
    "TreasuryOwnerSmartContract.requireLifecyclePeriod",
  ],
} as const;

const proposalSource = {
  path: "packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts",
  symbols: [
    "TreasuryProposalSmartContract.vote",
    "TreasuryProposalSmartContract.tallyVotes",
    "TreasuryProposalSmartContract.calculateAcceptanceCriteria",
    "TreasuryProposalSmartContract.calculateApprovalStatus",
    "TreasuryProposalSmartContract.execute",
    "TreasuryProposalSmartContract.togglePause",
  ],
} as const;

const pauseSource = {
  path: "packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts",
  symbols: [
    "TreasuryPauseControllerSmartContract.rotateMultisigKeys",
    "TreasuryPauseControllerSmartContract.pauseTreasury",
    "TreasuryPauseControllerSmartContract.unpauseTreasury",
    "TreasuryPauseControllerSmartContract.togglePauseProposal",
  ],
} as const;

const multisigSource = {
  path: "packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts",
  symbols: [
    "MultisigSignature",
    "MultisigSignatures.verify",
    "MultisigSignatures.createCommitment",
  ],
} as const;

interface CaseInput {
  id: string;
  family: string;
  title: string;
  component: string;
  sources: readonly SourceBinding[];
  claims: readonly EvidenceLane[];
  priority: "P0" | "P1" | "P2";
  fixture: string;
  policyIds?: readonly `POL-${string}`[];
}

function accepted(input: CaseInput): AssuranceCase {
  return {
    ...input,
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    proofOff: {
      outcome: "accept",
      note: "Checked proof-off execution must accept and record the semantic result.",
    },
    proofOn: {
      outcome: "accept",
      note: "Native proof-on execution must accept with the same normalized semantics.",
    },
  };
}

function rejected(input: CaseInput, failureClass: FailureClass): AssuranceCase {
  return {
    ...input,
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    proofOff: {
      outcome: "reject",
      failureClass,
      note: "Checked proof-off execution must reject at the specified layer.",
    },
    proofOn: {
      outcome: "reject",
      failureClass,
      note: "Native proof-on execution must reject at the same semantic layer.",
    },
  };
}

function recorded(input: CaseInput): AssuranceCase {
  return {
    ...input,
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    proofOff: {
      outcome: "record",
      note: "Record current proof-off behavior without a conformance claim.",
    },
    proofOn: {
      outcome: "record",
      note: "Record current proof-on behavior without a conformance claim.",
    },
  };
}

function unresolvedRejection(
  input: CaseInput,
  failureClass: FailureClass,
): AssuranceCase {
  return {
    ...rejected(input, failureClass),
    policyStatus: "unresolved",
  };
}

function authenticityAccepted(input: CaseInput): AssuranceCase {
  return {
    ...input,
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    proofOff: {
      outcome: "record",
      note: "Execute and record the proof-off authenticity capability boundary.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real native proof must verify with the intended verification key.",
    },
  };
}

function authenticityRejected(input: CaseInput): AssuranceCase {
  return {
    ...input,
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    proofOff: {
      outcome: "record",
      note: "Execute and record the proof-off authenticity capability boundary.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "The native verifier or proof-authorized transaction must reject.",
    },
  };
}

const directCardinalityCases = [
  ["001", "raw reducer receives zero array entries", "0"],
  ["002", "raw reducer receives one array entry", "1"],
  ["003", "raw reducer receives four array entries", "4"],
  ["004", "raw reducer receives five array entries", "5"],
  ["005", "raw reducer receives six array entries", "6"],
  ["006", "public reducer receives zero array entries", "0"],
  ["007", "public reducer receives one array entry", "1"],
  ["008", "public reducer receives four array entries", "4"],
  ["009", "public reducer receives five array entries", "5"],
  ["010", "public reducer receives six array entries", "6"],
] as const;

const tracerCardinalityCases = [
  ["011", "tracer receives zero real actions", "0"],
  ["012", "tracer pads one real action into one batch", "1"],
  ["013", "tracer pads four real actions into one batch", "4"],
  ["014", "tracer keeps five real actions in one batch", "5"],
  ["015", "tracer splits six real actions into two batches", "6"],
] as const;

const voteReducerCases: AssuranceCase[] = [
  ...directCardinalityCases.map(([id, title, count]) =>
    recorded({
      id: `ZK-VOTE-REDUCE-${id}`,
      family: "ZK-VOTE-REDUCE",
      title,
      component: "Vote Reducer",
      sources: [voteSource],
      claims: ["HOST", "CONSTRAINT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `vote/reduce/direct-cardinality-${count}`,
      policyIds: ["POL-001"],
    }),
  ),
  ...tracerCardinalityCases.map(([id, title, count]) =>
    accepted({
      id: `ZK-VOTE-REDUCE-${id}`,
      family: "ZK-VOTE-REDUCE",
      title,
      component: "Vote Reducer tracer",
      sources: [voteTracerSource, voteSource],
      claims: ["HOST", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: `vote/reduce/tracer-cardinality-${count}`,
    }),
  ),
  accepted({
    id: "ZK-VOTE-REDUCE-016",
    family: "ZK-VOTE-REDUCE",
    title: "unique voters contribute their exact vote weights",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "vote/reduce/unique-voters",
  }),
  recorded({
    id: "ZK-VOTE-REDUCE-017",
    family: "ZK-VOTE-REDUCE",
    title:
      "same-batch duplicate voter advances the action hash with zero repeated weight",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["HOST", "CONSTRAINT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "vote/reduce/duplicate-same-batch",
    policyIds: ["POL-038"],
  }),
  recorded({
    id: "ZK-VOTE-REDUCE-018",
    family: "ZK-VOTE-REDUCE",
    title:
      "cross-batch duplicate voter advances the action hash with zero repeated weight",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["HOST", "CONSTRAINT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "vote/reduce/duplicate-cross-batch",
    policyIds: ["POL-038"],
  }),
  recorded({
    id: "ZK-VOTE-REDUCE-019",
    family: "ZK-VOTE-REDUCE",
    title: "already-nullified voter advances the action hash with zero weight",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["HOST", "CONSTRAINT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "vote/reduce/already-nullified",
    policyIds: ["POL-038"],
  }),
  rejected(
    {
      id: "ZK-VOTE-REDUCE-020",
      family: "ZK-VOTE-REDUCE",
      title: "missing voting account cannot supply an accepted ledger witness",
      component: "Vote Reducer",
      sources: [voteSource],
      claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: "vote/reduce/missing-voting-account",
    },
    "CONSTRAINT_UNSATISFIED",
  ),
  recorded({
    id: "ZK-VOTE-REDUCE-021",
    family: "ZK-VOTE-REDUCE",
    title: "zero-weight voting account records membership behavior",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["CHARACTERIZATION"],
    priority: "P1",
    fixture: "vote/reduce/zero-weight-account",
    policyIds: ["POL-008"],
  }),
  accepted({
    id: "ZK-VOTE-REDUCE-022",
    family: "ZK-VOTE-REDUCE",
    title: "maximum-weight voter contributes without overflow",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "vote/reduce/maximum-weight-account",
  }),
  accepted({
    id: "ZK-VOTE-REDUCE-023",
    family: "ZK-VOTE-REDUCE",
    title: "exact dummy actions are trailing padding with no semantic effect",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "vote/reduce/exact-padding",
  }),
  recorded({
    id: "ZK-VOTE-REDUCE-024",
    family: "ZK-VOTE-REDUCE",
    title: "dummy vote value with a real key is not exact padding",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["CHARACTERIZATION"],
    priority: "P0",
    fixture: "vote/reduce/dummy-value-real-key",
    policyIds: ["POL-002"],
  }),
  rejected(
    {
      id: "ZK-VOTE-REDUCE-025",
      family: "ZK-VOTE-REDUCE",
      title: "invalid vote field fails Vote.assertValid",
      component: "Vote Reducer",
      sources: [voteSource],
      claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: "vote/reduce/invalid-vote-field",
    },
    "CONSTRAINT_UNSATISFIED",
  ),
  ...[
    ["026", "wrong voting-account witness index", "wrong-voting-index"],
    ["027", "wrong voting-ledger root", "wrong-voting-root"],
    ["028", "wrong nullifier witness index", "wrong-nullifier-index"],
    ["029", "wrong nullifier-ledger root", "wrong-nullifier-root"],
    ["030", "stale voting-account witness", "stale-voting-witness"],
    ["031", "stale nullifier witness", "stale-nullifier-witness"],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `ZK-VOTE-REDUCE-${id}`,
        family: "ZK-VOTE-REDUCE",
        title: `${title} is rejected`,
        component: "Vote Reducer",
        sources: [voteSource],
        claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `vote/reduce/${fixture}`,
      },
      "CONSTRAINT_UNSATISFIED",
    ),
  ),
  recorded({
    id: "ZK-VOTE-REDUCE-032",
    family: "ZK-VOTE-REDUCE",
    title:
      "equal-root witness from another lifecycle has no circuit lifecycle binding",
    component: "Vote Reducer",
    sources: [voteSource],
    claims: ["UNRESOLVED"],
    priority: "P0",
    fixture: "vote/reduce/equal-root-other-lifecycle",
    policyIds: ["POL-006"],
  }),
  ...[
    ["033", "yay", "yay"],
    ["034", "nay", "nay"],
    ["035", "abstain", "abstain"],
  ].map(([id, title, fixture]) =>
    unresolvedRejection(
      {
        id: `ZK-VOTE-REDUCE-${id}`,
        family: "ZK-VOTE-REDUCE",
        title: `${title} counter overflow in reduceBatch is rejected`,
        component: "Vote Reducer",
        sources: [voteSource],
        claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `vote/reduce/overflow-${fixture}`,
        policyIds: ["POL-010"],
      },
      "CONSTRAINT_UNSATISFIED",
    ),
  ),
];

const voteMergeCases: AssuranceCase[] = [
  accepted({
    id: "ZK-VOTE-MERGE-001",
    family: "ZK-VOTE-MERGE",
    title: "two contiguous real child proofs merge",
    component: "Vote Reducer recursion",
    sources: [voteMergeSource],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "vote/merge/two-contiguous-children",
  }),
  ...[
    [
      "002",
      "merge public input differs from first child input",
      "public-input",
    ],
    ["003", "child voting-ledger roots differ", "voting-root"],
    ["004", "child action-hash chain is discontinuous", "action-hash"],
    ["005", "child nullifier-root chain is discontinuous", "nullifier-root"],
    ["006", "child action-history target hashes differ", "history-target"],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `ZK-VOTE-MERGE-${id}`,
        family: "ZK-VOTE-MERGE",
        title: `${title} and merge rejects`,
        component: "Vote Reducer recursion",
        sources: [voteMergeSource],
        claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `vote/merge/mismatch-${fixture}`,
      },
      "CONSTRAINT_UNSATISFIED",
    ),
  ),
  authenticityRejected({
    id: "ZK-VOTE-MERGE-007",
    family: "ZK-VOTE-MERGE",
    title: "child proof from another program is rejected",
    component: "Vote Reducer recursion",
    sources: [voteMergeSource],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    fixture: "vote/merge/wrong-program-child",
  }),
  authenticityRejected({
    id: "ZK-VOTE-MERGE-008",
    family: "ZK-VOTE-MERGE",
    title: "child proof under another verification key is rejected",
    component: "Vote Reducer recursion",
    sources: [voteMergeSource],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    fixture: "vote/merge/wrong-key-child",
  }),
  ...[
    ["009", "one base proof is returned without a merge", "one-leaf"],
    [
      "010",
      "three proofs have associative totals and terminal roots",
      "three-leaf",
    ],
    [
      "011",
      "five proofs give equal outputs across alternate trees",
      "five-leaf",
    ],
  ].map(([id, title, fixture]) =>
    accepted({
      id: `ZK-VOTE-MERGE-${id}`,
      family: "ZK-VOTE-MERGE",
      title,
      component: "Vote Reducer recursion",
      sources: [voteMergeSource, voteProverSource],
      claims: ["ORACLE", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: `vote/merge/${fixture}`,
    }),
  ),
  ...[
    ["012", "yay", "yay"],
    ["013", "nay", "nay"],
    ["014", "abstain", "abstain"],
  ].map(([id, title, fixture]) =>
    unresolvedRejection(
      {
        id: `ZK-VOTE-MERGE-${id}`,
        family: "ZK-VOTE-MERGE",
        title: `${title} counter overflow in merge is rejected`,
        component: "Vote Reducer recursion",
        sources: [voteMergeSource],
        claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `vote/merge/overflow-${fixture}`,
        policyIds: ["POL-010"],
      },
      "CONSTRAINT_UNSATISFIED",
    ),
  ),
  authenticityAccepted({
    id: "ZK-VOTE-MERGE-015",
    family: "ZK-VOTE-MERGE",
    title: "real recursive Vote Reducer proof verifies with its intended key",
    component: "Vote Reducer recursion",
    sources: [voteMergeSource, voteProverSource],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    fixture: "vote/merge/real-proof-verification",
  }),
];

const voteHistoryCases: AssuranceCase[] = [
  accepted({
    id: "ZK-VOTE-HISTORY-001",
    family: "ZK-VOTE-HISTORY",
    title: "all five action-history targets are found",
    component: "Vote Reducer action history",
    sources: [voteMergeSource, ownerSource],
    claims: ["CONSTRAINT", "CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "vote/history/all-targets-found",
  }),
  ...[
    ["002", "one action-history target is not found", "target-not-found"],
    ["003", "one action-history target is the initial state", "initial-target"],
    ["004", "two action-history target hashes are equal", "duplicate-target"],
    [
      "005",
      "final action hash differs from actionStateOne",
      "wrong-final-hash",
    ],
    ["006", "action-history target order is reversed", "reversed-targets"],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `ZK-VOTE-HISTORY-${id}`,
        family: "ZK-VOTE-HISTORY",
        title: `${title} and tally rejects`,
        component: "Vote Reducer action history",
        sources: [voteMergeSource, ownerSource, proposalSource],
        claims: ["CONSTRAINT", "CONTRACT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `vote/history/${fixture}`,
      },
      "TRANSACTION_PRECONDITION",
    ),
  ),
  recorded({
    id: "ZK-VOTE-HISTORY-007",
    family: "ZK-VOTE-HISTORY",
    title:
      "more than five action transitions retain only the required target history",
    component: "Vote Reducer action history",
    sources: [voteTracerSource, voteMergeSource, ownerSource],
    claims: ["CHARACTERIZATION"],
    priority: "P0",
    fixture: "vote/history/more-than-five-transitions",
    policyIds: ["POL-004"],
  }),
  recorded({
    id: "ZK-VOTE-HISTORY-008",
    family: "ZK-VOTE-HISTORY",
    title: "equal action roots can be reused across lifecycle identities",
    component: "Vote Reducer action history",
    sources: [voteMergeSource, ownerSource],
    claims: ["UNRESOLVED"],
    priority: "P0",
    fixture: "vote/history/equal-root-other-lifecycle",
    policyIds: ["POL-006"],
  }),
];

const ownerCases: AssuranceCase[] = [
  ...[
    ["001", "first valid lifecycle slot is accepted", "first-valid", true],
    ["002", "last valid lifecycle slot is accepted", "last-valid", true],
    ["003", "slot before the lifecycle period is rejected", "before", false],
    ["004", "slot after the lifecycle period is rejected", "after", false],
    ["005", "lifecycle zero is handled", "zero", true],
    ["006", "maximum safe lifecycle ID is handled", "maximum-safe", true],
    [
      "007",
      "ID above the safe lifecycle bound is rejected",
      "above-safe",
      false,
    ],
  ].map(([id, title, fixture, doesAccept]) =>
    doesAccept
      ? accepted({
          id: `SC-OWNER-${id}`,
          family: "SC-OWNER",
          title: String(title),
          component: "Treasury Owner",
          sources: [ownerSource],
          claims: ["ORACLE", "CONTRACT", "PROOF_MODE_PARITY"],
          priority: "P0",
          fixture: `contract/owner/lifecycle-${fixture}`,
        })
      : rejected(
          {
            id: `SC-OWNER-${id}`,
            family: "SC-OWNER",
            title: String(title),
            component: "Treasury Owner",
            sources: [ownerSource],
            claims: ["ORACLE", "CONTRACT", "PROOF_MODE_PARITY"],
            priority: "P0",
            fixture: `contract/owner/lifecycle-${fixture}`,
          },
          "TRANSACTION_PRECONDITION",
        ),
  ),
  accepted({
    id: "SC-OWNER-008",
    family: "SC-OWNER",
    title: "new proposal account is created through the Owner",
    component: "Treasury Owner",
    sources: [ownerSource, proposalSource],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "contract/owner/create-proposal-new-account",
  }),
  ...[
    ["009", "proposal account reuse is rejected", "proposal-account-reuse"],
    [
      "010",
      "missing or false proposal isNew precondition is rejected",
      "proposal-is-new",
    ],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `SC-OWNER-${id}`,
        family: "SC-OWNER",
        title,
        component: "Treasury Owner",
        sources: [ownerSource],
        claims: ["CONTRACT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `contract/owner/${fixture}`,
      },
      "TRANSACTION_PRECONDITION",
    ),
  ),
  ...[
    ["011", "signed sender equals the voter key", "sender-is-voter"],
    ["012", "signed sender differs from the voter key", "sender-differs"],
    [
      "013",
      "voter key has an extra transaction signature",
      "extra-voter-signature",
    ],
    [
      "014",
      "unrelated sender consumes another voter identity",
      "unrelated-sender",
    ],
    [
      "015",
      "two senders submit for one voter identity",
      "two-senders-one-voter",
    ],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-OWNER-${id}`,
      family: "SC-OWNER",
      title: `${title} records sender-to-voter binding behavior`,
      component: "Treasury Owner",
      sources: [ownerSource, proposalSource],
      claims: ["CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/owner/vote-identity-${fixture}`,
      policyIds: ["POL-036"],
    }),
  ),
  recorded({
    id: "SC-OWNER-016",
    family: "SC-OWNER",
    title: "unrelated fee payer submits a tally transaction",
    component: "Treasury Owner",
    sources: [ownerSource],
    claims: ["CONTRACT", "CHARACTERIZATION"],
    priority: "P1",
    fixture: "contract/owner/tally-unrelated-fee-payer",
    policyIds: ["POL-007"],
  }),
  ...[
    ["017", "wrong Vote Reducer verification key", "vote-key"],
    ["018", "wrong staking transformation verification key", "staking-key"],
  ].map(([id, title, fixture]) =>
    authenticityRejected({
      id: `SC-OWNER-${id}`,
      family: "SC-OWNER",
      title: `${title} is rejected by tally proof consumption`,
      component: "Treasury Owner",
      sources: [ownerSource, proposalSource, voteMergeSource],
      claims: ["PROOF_AUTHENTICITY", "CONTRACT"],
      priority: "P0",
      fixture: `contract/owner/proof-binding-${fixture}`,
    }),
  ),
  ...[
    ["019", "wrong proposal lifecycle staking root", "lifecycle-root"],
    ["020", "wrong initial voting root", "initial-voting-root"],
    ["021", "different final voting roots between proofs", "final-voting-root"],
    ["022", "nonzero staking transformation start index", "start-index"],
    ["023", "nonexhausted staking transformation proof", "not-exhausted"],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `SC-OWNER-${id}`,
        family: "SC-OWNER",
        title: `${title} is rejected by tally proof consumption`,
        component: "Treasury Owner",
        sources: [ownerSource, proposalSource],
        claims: ["CONTRACT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `contract/owner/proof-binding-${fixture}`,
      },
      "TRANSACTION_PRECONDITION",
    ),
  ),
  recorded({
    id: "SC-OWNER-024",
    family: "SC-OWNER",
    title: "proof from another lifecycle records the missing lifecycle binding",
    component: "Treasury Owner",
    sources: [ownerSource, proposalSource, voteMergeSource],
    claims: ["CONTRACT", "UNRESOLVED"],
    priority: "P0",
    fixture: "contract/owner/proof-binding-other-lifecycle",
    policyIds: ["POL-006"],
  }),
  ...[
    ["025", "proof from another program", "other-program"],
    ["026", "proof JSON with one changed field", "mutated-json"],
  ].map(([id, title, fixture]) =>
    authenticityRejected({
      id: `SC-OWNER-${id}`,
      family: "SC-OWNER",
      title: `${title} is rejected by tally proof consumption`,
      component: "Treasury Owner",
      sources: [ownerSource, proposalSource, voteMergeSource],
      claims: ["PROOF_AUTHENTICITY", "CONTRACT"],
      priority: "P0",
      fixture: `contract/owner/proof-binding-${fixture}`,
    }),
  ),
  accepted({
    id: "SC-OWNER-027",
    family: "SC-OWNER",
    title: "accepted tally applies real proofs and emits matching totals",
    component: "Treasury Owner",
    sources: [ownerSource, proposalSource],
    claims: ["ORACLE", "CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "contract/owner/tally-approved",
  }),
  accepted({
    id: "SC-OWNER-028",
    family: "SC-OWNER",
    title: "directional votes below approval write REJECTED",
    component: "Treasury Owner",
    sources: [ownerSource, proposalSource],
    claims: ["ORACLE", "CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "contract/owner/tally-rejected-directional",
  }),
  authenticityAccepted({
    id: "SC-OWNER-029",
    family: "SC-OWNER",
    title: "accepted tally consumes real proofs under the intended keys",
    component: "Treasury Owner",
    sources: [ownerSource, proposalSource, voteMergeSource],
    claims: ["PROOF_AUTHENTICITY", "CONTRACT"],
    priority: "P0",
    fixture: "contract/owner/tally-real-proof-authentication",
  }),
];

const proposalCases: AssuranceCase[] = [
  ...[
    ["001", "vote", "vote"],
    ["002", "tallyVotes", "tally"],
    ["003", "execute", "execute"],
    ["004", "togglePause", "toggle-pause"],
    [
      "005",
      "state change nested under an unrelated account update",
      "unrelated-parent",
    ],
    [
      "006",
      "state change through the wrong token owner or approval path",
      "wrong-token-owner",
    ],
  ].map(([id, method, fixture]) =>
    recorded({
      id: `SC-PROPOSAL-${id}`,
      family: "SC-PROPOSAL",
      title: `direct Proposal ${method} call records Owner and token-approval enforcement`,
      component: "Treasury Proposal",
      sources: [proposalSource, ownerSource],
      claims: ["CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/proposal/direct-${fixture}`,
      policyIds: ["POL-037"],
    }),
  ),
  recorded({
    id: "SC-PROPOSAL-007",
    family: "SC-PROPOSAL",
    title: "public Proposal vote entry point receives an exact dummy action",
    component: "Treasury Proposal",
    sources: [proposalSource],
    claims: ["CONTRACT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "contract/proposal/public-dummy-vote",
    policyIds: ["POL-035"],
  }),
  recorded({
    id: "SC-PROPOSAL-008",
    family: "SC-PROPOSAL",
    title: "below-participation tally rejects before terminal status write",
    component: "Treasury Proposal",
    sources: [proposalSource, ownerSource],
    claims: ["CONTRACT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "contract/proposal/tally-below-participation",
    policyIds: ["POL-014"],
  }),
  ...[
    ["009", "no votes", "no-votes"],
    ["010", "abstain-only votes", "abstain-only"],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-PROPOSAL-${id}`,
      family: "SC-PROPOSAL",
      title: `${title} reject before terminal status write`,
      component: "Treasury Proposal",
      sources: [proposalSource, ownerSource],
      claims: ["ORACLE", "CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/proposal/tally-${fixture}`,
      policyIds: ["POL-015"],
    }),
  ),
  ...[
    ["011", "one vote below each threshold", "below-thresholds", false],
    [
      "012",
      "exact participation and approval thresholds",
      "exact-thresholds",
      true,
    ],
    ["013", "one vote above each threshold", "above-thresholds", true],
  ].map(([id, title, fixture, doesAccept]) =>
    doesAccept
      ? accepted({
          id: `SC-PROPOSAL-${id}`,
          family: "SC-PROPOSAL",
          title: String(title),
          component: "Treasury Proposal",
          sources: [proposalSource, ownerSource],
          claims: ["ORACLE", "CONTRACT", "PROOF_MODE_PARITY"],
          priority: "P0",
          fixture: `contract/proposal/tally-${fixture}`,
        })
      : recorded({
          id: `SC-PROPOSAL-${id}`,
          family: "SC-PROPOSAL",
          title: String(title),
          component: "Treasury Proposal",
          sources: [proposalSource, ownerSource],
          claims: ["ORACLE", "CONTRACT", "CHARACTERIZATION"],
          priority: "P0",
          fixture: `contract/proposal/tally-${fixture}`,
          policyIds: ["POL-014", "POL-015"],
        }),
  ),
  ...[
    ["014", "zero treasury balance", "zero-treasury-balance"],
    ["015", "zero proposal amount", "zero-proposal-amount"],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-PROPOSAL-${id}`,
      family: "SC-PROPOSAL",
      title: `${title} records threshold and division behavior`,
      component: "Treasury Proposal",
      sources: [proposalSource],
      claims: ["ORACLE", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/proposal/${fixture}`,
      policyIds: ["POL-026"],
    }),
  ),
  accepted({
    id: "SC-PROPOSAL-016",
    family: "SC-PROPOSAL",
    title:
      "maximum supported proposal and treasury amounts preserve acceptance arithmetic",
    component: "Treasury Proposal",
    sources: [proposalSource],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    fixture: "contract/proposal/maximum-supported-amounts",
  }),
  ...[
    ["017", "zero payout", "zero"],
    ["018", "exact full payout", "full"],
    ["019", "excessive payout", "excessive"],
    ["020", "cumulative partial payouts", "cumulative"],
    ["021", "payout after completion", "after-completion"],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-PROPOSAL-${id}`,
      family: "SC-PROPOSAL",
      title: `${title} records paidOutAmount and event behavior`,
      component: "Treasury Proposal",
      sources: [proposalSource, ownerSource],
      claims: ["ORACLE", "CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/proposal/payout-${fixture}`,
      policyIds: ["POL-027", "POL-033"],
    }),
  ),
  ...[
    ["022", "proposal bond charge", "charge"],
    ["023", "proposal bond return", "return"],
    ["024", "outstanding bond liability", "liability"],
    ["025", "distinct proposer and bond payer", "distinct-roles"],
    ["026", "recipient and executor role collision", "role-collision"],
    ["027", "refund destination differs from proposer", "refund-destination"],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-PROPOSAL-${id}`,
      family: "SC-PROPOSAL",
      title: `${title} records value conservation and role behavior`,
      component: "Treasury Proposal",
      sources: [proposalSource, ownerSource],
      claims: ["ORACLE", "CONTRACT", "UNRESOLVED"],
      priority: "P0",
      fixture: `contract/proposal/bond-${fixture}`,
      policyIds: ["POL-028", "POL-029"],
    }),
  ),
  recorded({
    id: "SC-PROPOSAL-028",
    family: "SC-PROPOSAL",
    title: "pause and unpause preserve or overwrite a terminal Proposal state",
    component: "Treasury Proposal",
    sources: [proposalSource, ownerSource, pauseSource],
    claims: ["CONTRACT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "contract/proposal/pause-terminal-state",
    policyIds: ["POL-018"],
  }),
];

const pauseCases: AssuranceCase[] = [
  rejected(
    {
      id: "SC-PAUSE-001",
      family: "SC-PAUSE",
      title: "signature count below threshold is rejected",
      component: "Treasury Pause Controller",
      sources: [pauseSource, multisigSource],
      claims: ["CONSTRAINT", "CONTRACT", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: "contract/pause/threshold-below",
    },
    "TRANSACTION_PRECONDITION",
  ),
  ...[
    ["002", "signature count at threshold is accepted", "at"],
    ["003", "signature count above threshold is accepted", "above"],
    [
      "004",
      "valid signer positions and input orders verify",
      "positions-order",
    ],
  ].map(([id, title, fixture]) =>
    accepted({
      id: `SC-PAUSE-${id}`,
      family: "SC-PAUSE",
      title,
      component: "Treasury Pause Controller",
      sources: [pauseSource, multisigSource],
      claims: ["CONSTRAINT", "CONTRACT", "PROOF_MODE_PARITY"],
      priority: "P0",
      fixture: `contract/pause/threshold-${fixture}`,
    }),
  ),
  ...[
    ["005", "wrong nonce", "wrong-nonce"],
    ["006", "replayed nonce", "replayed-nonce"],
    ["007", "wrong message type", "wrong-message"],
    ["008", "wrong Proposal address", "wrong-proposal"],
    ["009", "wrong old rotation commitment", "wrong-old-commitment"],
    ["010", "wrong new rotation commitment", "wrong-new-commitment"],
  ].map(([id, title, fixture]) =>
    rejected(
      {
        id: `SC-PAUSE-${id}`,
        family: "SC-PAUSE",
        title: `${title} is rejected`,
        component: "Treasury Pause Controller",
        sources: [pauseSource, multisigSource],
        claims: ["CONSTRAINT", "CONTRACT", "PROOF_MODE_PARITY"],
        priority: "P0",
        fixture: `contract/pause/${fixture}`,
      },
      "TRANSACTION_PRECONDITION",
    ),
  ),
  ...[
    [
      "011",
      "signature replay against another controller deployment",
      "deployment",
    ],
    ["012", "signature replay on another network", "network"],
    ["013", "signature replay under another protocol version", "protocol"],
  ].map(([id, title, fixture]) =>
    recorded({
      id: `SC-PAUSE-${id}`,
      family: "SC-PAUSE",
      title,
      component: "Treasury Pause Controller",
      sources: [pauseSource, multisigSource],
      claims: ["CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/pause/replay-${fixture}`,
      policyIds: ["POL-009"],
    }),
  ),
  recorded({
    id: "SC-PAUSE-014",
    family: "SC-PAUSE",
    title: "pause signature records state direction and event truth",
    component: "Treasury Pause Controller",
    sources: [pauseSource, multisigSource],
    claims: ["CONTRACT", "CHARACTERIZATION"],
    priority: "P0",
    fixture: "contract/pause/direction-event",
    policyIds: ["POL-016"],
  }),
  ...[
    ["015", "four configured participants", "participants-four", ["POL-017"]],
    ["016", "six configured participants", "participants-six", ["POL-017"]],
    [
      "017",
      "duplicate configured participants",
      "participants-duplicate",
      ["POL-017"],
    ],
    ["018", "empty configured participant", "participant-empty", ["POL-017"]],
    ["019", "repeated signer identity", "signer-repeated", ["POL-017"]],
    ["020", "signer distinctness", "signer-distinctness", ["POL-017"]],
    [
      "021",
      "rotation participant order",
      "rotation-order",
      ["POL-017", "POL-031"],
    ],
    [
      "022",
      "rotation preimage and commitment",
      "rotation-preimage",
      ["POL-031"],
    ],
  ].map(([id, title, fixture, policyIds]) =>
    recorded({
      id: `SC-PAUSE-${id}`,
      family: "SC-PAUSE",
      title: `${title} records participant and rotation policy behavior`,
      component: "Treasury Pause Controller",
      sources: [pauseSource, multisigSource],
      claims: ["CONSTRAINT", "CONTRACT", "CHARACTERIZATION"],
      priority: "P0",
      fixture: `contract/pause/${fixture}`,
      policyIds: policyIds as readonly `POL-${string}`[],
    }),
  ),
];

export const voteAndContractCases = defineCases([
  ...voteReducerCases,
  ...voteMergeCases,
  ...voteHistoryCases,
  ...ownerCases,
  ...proposalCases,
  ...pauseCases,
]);
