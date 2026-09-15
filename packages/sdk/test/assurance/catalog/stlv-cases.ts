import { defineCases } from "../case-types.js";

const STLV_PROGRAM =
  "packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts";
const PREFIXED_MERKLE_TREE =
  "packages/sdk/src/provable/merkle-tree/prefixed-merkle-tree.ts";
const STLV_TRACER =
  "packages/sdk/src/proving/tracing/staking-ledger-to-voting-ledger-tracer.ts";
const STLV_PROVER =
  "packages/sdk/src/proving/prover/staking-ledger-to-voting-ledger-prover.ts";
const MERGE_ORCHESTRATOR =
  "packages/sdk/src/proving/prover/merge-proof-orchestrator.ts";
const STLV_PROOF_STORAGE =
  "packages/sdk/src/storage/keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.ts";
const TREASURY_PROPOSAL =
  "packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts";

export const stlvCases = defineCases([
  {
    id: "ZK-STLV-DIGEST-001",
    family: "ZK-STLV-DIGEST",
    title: "Digest one full default-token batch",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "ACCOUNT_BATCH_SIZE",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Five dense default-token accounts with unique delegates and an independently computed voting root.",
    proofOff: {
      outcome: "accept",
      note: "Digest consumes indices 0 through 4, adds all five balances, returns index 4, and sets exhausted=false.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real proof verifies and has the same index, voting root, and exhausted=false output as proof-off.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-002",
    family: "ZK-STLV-DIGEST",
    title: "Digest one real account with four trailing padding accounts",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "ACCOUNT_BATCH_SIZE",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "One populated account followed by committed Account.empty() leaves at batch positions 1 through 4.",
    proofOff: {
      outcome: "accept",
      note: "Only the real account adds voting weight; all five committed positions are consumed and output index is 4.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real proof verifies with the same root and index produced in proof-off.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-003",
    family: "ZK-STLV-DIGEST",
    title: "Digest two real accounts with three trailing padding accounts",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "ACCOUNT_BATCH_SIZE",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Two populated accounts followed by committed Account.empty() leaves at batch positions 2 through 4.",
    proofOff: {
      outcome: "accept",
      note: "The two real balances are included, padding adds zero, and output index is 4.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof matches the proof-off public output and independent root.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-004",
    family: "ZK-STLV-DIGEST",
    title: "Digest three real accounts with two trailing padding accounts",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "ACCOUNT_BATCH_SIZE",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Three populated accounts followed by committed Account.empty() leaves at batch positions 3 and 4.",
    proofOff: {
      outcome: "accept",
      note: "The three real balances are included, padding adds zero, and output index is 4.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof matches the proof-off public output and independent root.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-005",
    family: "ZK-STLV-DIGEST",
    title: "Digest four real accounts with one trailing padding account",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "ACCOUNT_BATCH_SIZE",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Four populated accounts followed by one committed Account.empty() leaf at batch position 4.",
    proofOff: {
      outcome: "accept",
      note: "The four real balances are included, padding adds zero, and output index is 4.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof matches the proof-off public output and independent root.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-006",
    family: "ZK-STLV-DIGEST",
    title: "Accumulate accounts that share one delegate",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["ORACLE", "HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Five default-token accounts share one nonempty delegate; an independent UInt64 sum supplies the expected weight.",
    proofOff: {
      outcome: "accept",
      note: "The delegate balance equals the ordered sum, and each rolling voting-root witness uses the preceding write.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof produces the same accumulated balance and terminal voting root.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-007",
    family: "ZK-STLV-DIGEST",
    title: "Ignore custom-token balances in a mixed batch",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest", "TokenId.default"],
      },
    ],
    claims: ["ORACLE", "HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Default-token and custom-token accounts share delegates and use distinct nonzero balances.",
    proofOff: {
      outcome: "accept",
      note: "Only default-token balances contribute to voting weight; custom-token accounts still consume their staking indices.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies with the same default-token-only totals and roots.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-008",
    family: "ZK-STLV-DIGEST",
    title: "Digest zero-balance default-token accounts",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["ORACLE", "HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Five populated default-token accounts have zero balances and nonempty delegates.",
    proofOff: {
      outcome: "accept",
      note: "All indices advance, no voting balance changes, and the terminal voting root equals the initial root.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof preserves the voting root and matches the proof-off output.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-009",
    family: "ZK-STLV-DIGEST",
    title: "Accept the exact maximum accumulated delegate balance",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Shared-delegate default-token balances and initial voting weight sum to UInt64.MAXINT() exactly.",
    proofOff: {
      outcome: "accept",
      note: "The final delegate weight is UInt64.MAXINT() without wraparound.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real proof verifies the exact UInt64 maximum result.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-010",
    family: "ZK-STLV-DIGEST",
    title: "Ignore an all-custom-token batch",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest", "TokenId.default"],
      },
    ],
    claims: ["ORACLE", "HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Five custom-token accounts have nonzero balances, including UInt64.MAXINT(), and valid height-36 witnesses.",
    proofOff: {
      outcome: "accept",
      note: "Every custom-token contribution is zero, the voting root is unchanged, and the output index is 4.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies without custom-token overflow and matches the proof-off output.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-011",
    family: "ZK-STLV-DIGEST",
    title: "Use real height-36 witnesses at the lower index boundary",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "PrefixedMerkleWitness36",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
      {
        path: PREFIXED_MERKLE_TREE,
        symbols: ["PrefixedMerkleTree", "PrefixedMerkleWitness", "leafCount"],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A real PrefixedMerkleTree height-36 path starts at leaf index 0 and covers indices 0 through 4.",
    proofOff: {
      outcome: "accept",
      note: "Witness indices and the independently computed staking root bind the first five leaves.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies the same height-36 witness paths and public roots.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-012",
    family: "ZK-STLV-DIGEST",
    title: "Use the highest complete batch in the height-36 domain",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "PrefixedMerkleWitness36",
          "StakingLedgerToVotingLedger",
          "digest",
        ],
      },
      {
        path: PREFIXED_MERKLE_TREE,
        symbols: [
          "PrefixedMerkleTree.leafCount",
          "PrefixedMerkleWitness.calculateIndex",
        ],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Sparse scripted height-36 witnesses cover indices 2^35-5 through 2^35-1 without allocating the complete tree.",
    proofOff: {
      outcome: "accept",
      note: "The input index 2^35-5 is valid, and the output index is the maximum leaf index 2^35-1.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real proof verifies the exact upper-bound batch and matches proof-off.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-013",
    family: "ZK-STLV-DIGEST",
    title: "Reject a staking witness with the wrong index",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedgerErrors.stakingLedgerIndexMismatch",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The first account uses a valid staking witness for a different index; all durable-state snapshots start empty.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The staking index assertion rejects before a voting-ledger write; all protected host state stays unchanged.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects on the same staking index constraint and publishes no proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-014",
    family: "ZK-STLV-DIGEST",
    title: "Reject a staking witness with the wrong root",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedgerErrors.stakingLedgerRootMismatch",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The first account and index are valid, but its witness calculates a different staking root.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The staking root assertion rejects before a voting-ledger write; protected host state stays unchanged.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects on the same staking-root constraint and publishes no proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-015",
    family: "ZK-STLV-DIGEST",
    title: "Reject a voting witness with the wrong delegate index",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedgerErrors.votingLedgerIndexMismatch",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The first voting-account witness calculates an index other than Poseidon(delegate.toFields()).",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The voting index assertion rejects before setVotingAccount() or setLeaf().",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects on the same voting-index constraint and publishes no proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-016",
    family: "ZK-STLV-DIGEST",
    title: "Reject a voting witness with the wrong rolling root",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedgerErrors.votingLedgerRootMismatch",
          "digest",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The first delegate index is correct, but its voting witness calculates a root different from publicInput.votingLedgerRoot.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The voting-root assertion rejects before the two voting-ledger writes.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects on the same rolling-root constraint and publishes no proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-017",
    family: "ZK-STLV-DIGEST",
    title: "Record state after a stale later witness rejects",
    component: "StakingLedgerToVotingLedger.digest host callbacks",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["stakingLedgerToVotingLedgerContext", "digest"],
      },
    ],
    claims: ["HOST", "CHARACTERIZATION", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-020"],
    fixture:
      "Position 0 writes successfully; position 1 receives the pre-write voting witness and fails its rolling-root assertion.",
    proofOff: {
      outcome: "record",
      note: "The call rejects, but the first host write can remain; record accounts, leaves, roots, trace count, and proof count exactly.",
    },
    proofOn: {
      outcome: "record",
      note: "Proof generation rejects after witness callbacks; compare the same durable-state snapshot with proof-off.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-018",
    family: "ZK-STLV-DIGEST",
    title: "Reject a witness from another ledger",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "digest",
          "PrefixedMerkleWitness36",
          "PrefixedMerkleWitness255",
        ],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Use a same-height staking or voting witness from an independently rooted ledger at the first batch position.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The calculated foreign root does not match the public root.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The real proving path rejects the same foreign-root constraint.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-019",
    family: "ZK-STLV-DIGEST",
    title: "Characterize an interior empty staking account",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["Account.empty", "StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-005"],
    fixture:
      "A committed Account.empty() leaf occurs between populated accounts in one fixed batch.",
    proofOff: {
      outcome: "accept",
      note: "The circuit has no density assertion; it consumes the empty leaf and continues through the batch.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies the implemented sparse-ledger behavior, but it does not establish approved protocol validity.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-020",
    family: "ZK-STLV-DIGEST",
    title: "Characterize a populated account after an interior empty account",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["Account.empty", "StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-005"],
    fixture:
      "One committed empty leaf is followed by a populated default-token account in the same batch.",
    proofOff: {
      outcome: "accept",
      note: "Digest continues after the hole and includes the later account because the circuit checks membership, not density.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof records the same later-account inclusion as characterization evidence.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-021",
    family: "ZK-STLV-DIGEST",
    title: "Reject default-token voting-weight overflow",
    component: "StakingLedgerToVotingLedger.digest arithmetic",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedger",
          "digest",
          "VotingAccount.balance",
        ],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A default-token balance makes one delegate's accumulated UInt64 balance exceed UInt64.MAXINT() by one.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "UInt64 addition rejects; no wrapped public output is accepted.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects the same overflow and publishes no valid proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-022",
    family: "ZK-STLV-DIGEST",
    title: "Record host writes made before later balance overflow",
    component: "StakingLedgerToVotingLedger.digest host callbacks",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["stakingLedgerToVotingLedgerContext", "digest"],
      },
    ],
    claims: ["HOST", "CHARACTERIZATION", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-010", "POL-020"],
    fixture:
      "An early account writes successfully; a later account overflows the same or another delegate's UInt64 voting balance.",
    proofOff: {
      outcome: "record",
      note: "The call rejects after earlier callbacks can mutate host state; record the exact mixed state and publish no proof.",
    },
    proofOn: {
      outcome: "record",
      note: "The proving call rejects, and its durable-state snapshot must match the characterized proof-off side effects.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-023",
    family: "ZK-STLV-DIGEST",
    title: "Characterize a default-token account with an empty delegate",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest", "PublicKey.empty"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-030"],
    fixture:
      "A populated default-token account has PublicKey.empty() as its delegate and a nonzero balance.",
    proofOff: {
      outcome: "accept",
      note: "Current code adds the balance to the voting account at the empty delegate index.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies the implemented empty-delegate behavior without resolving whether the account is eligible.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-024",
    family: "ZK-STLV-DIGEST",
    title: "Reject an input index equal to 2^35",
    component: "StakingLedgerToVotingLedger.digest index domain",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["PrefixedMerkleWitness36", "digest"],
      },
      {
        path: PREFIXED_MERKLE_TREE,
        symbols: [
          "PrefixedMerkleTree.leafCount",
          "PrefixedMerkleTree.getWitness",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Set publicInput.index to 2^35, one above the exact height-36 leaf domain 0..2^35-1.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The ledger cannot supply an in-domain witness; a scripted witness also fails the calculated-index constraint.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The witness provider rejects index 2^35 before a proof can be published.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-025",
    family: "ZK-STLV-DIGEST",
    title: "Reject a five-account batch that crosses the height-36 boundary",
    component: "StakingLedgerToVotingLedger.digest index domain",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["ACCOUNT_BATCH_SIZE", "PrefixedMerkleWitness36", "digest"],
      },
      {
        path: PREFIXED_MERKLE_TREE,
        symbols: [
          "PrefixedMerkleTree.leafCount",
          "PrefixedMerkleTree.getWitness",
        ],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Start at 2^35-4, so positions 0 through 3 are in range and position 4 requests index 2^35.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The fifth witness request is outside 0..2^35-1; record any earlier host writes before rejection.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The fifth witness request is outside the tree domain, so the batch cannot produce a proof.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-026",
    family: "ZK-STLV-DIGEST",
    title: "Digest a final full batch followed by a committed empty leaf",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Five populated final leaves form one batch, and the independently committed next leaf is Account.empty().",
    proofOff: {
      outcome: "accept",
      note: "Digest accepts the five populated leaves and returns their last index with exhausted=false.",
    },
    proofOn: {
      outcome: "accept",
      note: "The digest proof verifies; the following empty leaf is reserved for a separate exhaust case.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-027",
    family: "ZK-STLV-DIGEST",
    title: "Record an account-write and leaf-write split failure",
    component: "StakingLedgerToVotingLedger.digest host callbacks",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["stakingLedgerToVotingLedgerContext", "digest"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-020"],
    fixture:
      "A test ledger lets setVotingAccount() succeed and makes the immediately following setLeaf() fail.",
    proofOff: {
      outcome: "record",
      note: "The call rejects after a possible account/leaf split; record the exact durable state and prohibited mixed-state requirement.",
    },
    proofOn: {
      outcome: "record",
      note: "The proving call rejects at the same callback; compare its durable state with proof-off.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-028",
    family: "ZK-STLV-DIGEST",
    title: "Record trace publication failure at batch setMany",
    component: "StakingLedgerToVotingLedgerTracer.digest publication",
    sources: [
      {
        path: STLV_TRACER,
        symbols: [
          "StakingLedgerToVotingLedgerTracer",
          "digest",
          "KeyValueBatchStorage.setMany",
        ],
      },
    ],
    claims: ["HOST", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-020"],
    fixture:
      "Tracing completes one batch, then the combined trace-and-voting-ledger setMany() operation fails.",
    proofOff: {
      outcome: "record",
      note: "Trace publication rejects; reopen storage and record whether trace and voting changes committed together or diverged.",
    },
    proofOn: {
      outcome: "record",
      note: "The host publication result must match proof-off because proof mode does not change storage atomicity.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-029",
    family: "ZK-STLV-DIGEST",
    title: "Characterize proof reuse by trace index alone",
    component: "StakingLedgerToVotingLedgerProver.digest cache",
    sources: [
      {
        path: STLV_PROVER,
        symbols: ["StakingLedgerToVotingLedgerProver", "digest"],
      },
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage.getProof"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "RESILIENCE"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-022"],
    fixture:
      "Persist proof ID 0, then change trace 0 content while retaining the same lifecycle namespace and index.",
    proofOff: {
      outcome: "record",
      note: 'Current digest skips the changed trace because getProof("0") succeeds; record the stale proof and absent content binding.',
    },
    proofOn: {
      outcome: "record",
      note: "Current digest also skips proof generation in proof-on; provenance must detect the stale reuse before acceptance.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-030",
    family: "ZK-STLV-DIGEST",
    title: "Characterize a tracer stop at a batch-start hole",
    component: "StakingLedgerToVotingLedgerTracer.digest",
    sources: [
      {
        path: STLV_TRACER,
        symbols: [
          "StakingLedgerToVotingLedgerTracer",
          "digest",
          "Account.isEmpty",
        ],
      },
    ],
    claims: ["HOST", "CHARACTERIZATION", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-005"],
    fixture:
      "The first account of a trace batch is empty, but a later staking index is populated.",
    proofOff: {
      outcome: "record",
      note: "The tracer stops before creating the batch and omits the later populated account.",
    },
    proofOn: {
      outcome: "record",
      note: "No proof task exists for the omitted batch; record the same tracer behavior under proof-on configuration.",
    },
  },
  {
    id: "ZK-STLV-DIGEST-031",
    family: "ZK-STLV-DIGEST",
    title: "Characterize an all-empty direct digest batch",
    component: "StakingLedgerToVotingLedger.digest",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["Account.empty", "StakingLedgerToVotingLedger", "digest"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-005"],
    fixture:
      "All five direct digest inputs are committed Account.empty() leaves in an empty height-36 staking tree.",
    proofOff: {
      outcome: "accept",
      note: "The circuit consumes five empty leaves, preserves the voting root, returns index 4, and sets exhausted=false.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies the implemented direct-call behavior without approving an empty staking-ledger policy.",
    },
  },

  {
    id: "ZK-STLV-MERGE-001",
    family: "ZK-STLV-MERGE",
    title: "Merge two adjacent digest proofs",
    component: "StakingLedgerToVotingLedger.merge",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Two valid adjacent digest proofs share the staking root and have exact voting-root continuity.",
    proofOff: {
      outcome: "accept",
      note: "The merged output ends at child two, carries its voting root, and sets exhausted=false.",
    },
    proofOn: {
      outcome: "accept",
      note: "Both real child proofs verify and the merged proof verifies with the same public output.",
    },
  },
  {
    id: "ZK-STLV-MERGE-002",
    family: "ZK-STLV-MERGE",
    title: "Merge three leaves in a left-heavy tree",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture: "Merge leaves 0 and 1, then merge their proof with leaf 2.",
    proofOff: {
      outcome: "accept",
      note: "The root spans all three leaves and equals the independent sequential transformation output.",
    },
    proofOn: {
      outcome: "accept",
      note: "The two recursive merge proofs verify and match the proof-off root output.",
    },
  },
  {
    id: "ZK-STLV-MERGE-003",
    family: "ZK-STLV-MERGE",
    title: "Merge three leaves in a right-heavy tree",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture: "Merge leaves 1 and 2, then merge leaf 0 with their proof.",
    proofOff: {
      outcome: "accept",
      note: "The root spans all three leaves and equals the independent sequential transformation output.",
    },
    proofOn: {
      outcome: "accept",
      note: "The two recursive merge proofs verify and match the proof-off root output.",
    },
  },
  {
    id: "ZK-STLV-MERGE-004",
    family: "ZK-STLV-MERGE",
    title: "Merge five leaves in a balanced tree",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Use a deterministic near-balanced binary tree over five consecutive digest proofs.",
    proofOff: {
      outcome: "accept",
      note: "The root spans all five leaves and equals the independent sequential output.",
    },
    proofOn: {
      outcome: "accept",
      note: "Every recursive child and the final root proof verify.",
    },
  },
  {
    id: "ZK-STLV-MERGE-005",
    family: "ZK-STLV-MERGE",
    title: "Merge five leaves in a left-heavy tree",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture: "Fold five consecutive digest proofs from the left.",
    proofOff: {
      outcome: "accept",
      note: "The left fold returns the independent terminal index and voting root.",
    },
    proofOn: {
      outcome: "accept",
      note: "Every left-heavy recursive proof verifies with the expected key.",
    },
  },
  {
    id: "ZK-STLV-MERGE-006",
    family: "ZK-STLV-MERGE",
    title: "Merge five leaves in a right-heavy tree",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture: "Fold five consecutive digest proofs from the right.",
    proofOff: {
      outcome: "accept",
      note: "The right fold returns the independent terminal index and voting root.",
    },
    proofOn: {
      outcome: "accept",
      note: "Every right-heavy recursive proof verifies with the expected key.",
    },
  },
  {
    id: "ZK-STLV-MERGE-007",
    family: "ZK-STLV-MERGE",
    title: "Compare alternate valid recursive trees",
    component: "StakingLedgerToVotingLedger.merge recursion",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["ORACLE", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Reuse the same three-leaf and five-leaf inputs across balanced, left-heavy, and right-heavy trees.",
    proofOff: {
      outcome: "accept",
      note: "All valid tree shapes have identical public inputs and public outputs; proof bytes need not match.",
    },
    proofOn: {
      outcome: "accept",
      note: "All valid roots verify and preserve the proof-off public-value equality.",
    },
  },
  {
    id: "ZK-STLV-MERGE-008",
    family: "ZK-STLV-MERGE",
    title: "Promote one base proof to the root ID",
    component: "MergeProofOrchestrator.merge",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: [
          "MergeProofOrchestrator.ROOT_PROOF_ID",
          "MergeProofOrchestrator.merge",
        ],
      },
    ],
    claims: ["HOST", "RESILIENCE", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "Proof storage contains only base proof ID 0 and has no merge proof.",
    proofOff: {
      outcome: "accept",
      note: "The orchestrator stores the unchanged base proof under root and does not enqueue a two-child merge.",
    },
    proofOn: {
      outcome: "accept",
      note: "The same verified base proof is promoted without an additional recursive proof.",
    },
  },
  {
    id: "ZK-STLV-MERGE-009",
    family: "ZK-STLV-MERGE",
    title: "Reject reversed recursive children",
    component: "StakingLedgerToVotingLedger.merge continuity",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Pass a later valid proof as proof1 and its preceding proof as proof2.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "output1.index+1 does not equal input2.index.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The recursive proof rejects on the same adjacency constraint.",
    },
  },
  {
    id: "ZK-STLV-MERGE-010",
    family: "ZK-STLV-MERGE",
    title: "Reject nonadjacent recursive children",
    component: "StakingLedgerToVotingLedger.merge continuity",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Two valid child proofs have a one-batch gap between proof1 output and proof2 input.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The adjacency assertion rejects the gap.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The recursive proving path rejects the same gap.",
    },
  },
  {
    id: "ZK-STLV-MERGE-011",
    family: "ZK-STLV-MERGE",
    title: "Reject children with different staking roots",
    component: "StakingLedgerToVotingLedger.merge continuity",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Adjacent child proofs bind different stakingLedgerRoot values while other continuity values match.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "input1.stakingLedgerRoot must equal input2.stakingLedgerRoot.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The recursive proving path rejects the staking-root mismatch.",
    },
  },
  {
    id: "ZK-STLV-MERGE-012",
    family: "ZK-STLV-MERGE",
    title: "Reject broken voting-root continuity",
    component: "StakingLedgerToVotingLedger.merge continuity",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Adjacent valid child proofs have output1.votingLedgerRoot different from input2.votingLedgerRoot.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The rolling voting-root assertion rejects.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The recursive proving path rejects the same root discontinuity.",
    },
  },
  {
    id: "ZK-STLV-MERGE-013",
    family: "ZK-STLV-MERGE",
    title: "Reject a recursive child from another program",
    component: "StakingLedgerToVotingLedger.merge child verification",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge", "SelfProof.verify"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Cast a real proof from another ZkProgram into a shape whose public fields satisfy explicit merge continuity.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records the capability boundary because disabled proof verification cannot establish program identity.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "SelfProof verification rejects a child created by another program.",
    },
  },
  {
    id: "ZK-STLV-MERGE-014",
    family: "ZK-STLV-MERGE",
    title: "Reject a recursive child from another verification key",
    component: "StakingLedgerToVotingLedger.merge child verification",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge", "SelfProof.verify"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Use a structurally compatible proof made by a changed STLV circuit and a different verification key.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records that disabled verification cannot authenticate the child key.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "SelfProof verification rejects the child made with the other key.",
    },
  },
  {
    id: "ZK-STLV-MERGE-015",
    family: "ZK-STLV-MERGE",
    title: "Reject a mutated recursive child public input",
    component: "StakingLedgerToVotingLedger.merge child verification",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge", "SelfProof.verify"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Mutate a child public input and adjust external merge arguments so explicit continuity still holds, but retain the original proof bytes.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records the negative-control boundary because public-value consistency alone cannot authenticate the mutation.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "The original proof bytes do not verify against the mutated child public input.",
    },
  },
  {
    id: "ZK-STLV-MERGE-016",
    family: "ZK-STLV-MERGE",
    title: "Reject a mutated recursive child public output",
    component: "StakingLedgerToVotingLedger.merge child verification",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge", "SelfProof.verify"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Mutate a child public output and adjust the adjacent child so explicit continuity still holds, but retain the original proof bytes.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records the negative-control boundary because explicit continuity can be made internally consistent.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "The original proof bytes do not verify against the mutated child public output.",
    },
  },
  {
    id: "ZK-STLV-MERGE-017",
    family: "ZK-STLV-MERGE",
    title: "Characterize a merge that consumes an exhausted child",
    component: "StakingLedgerToVotingLedger.merge terminal semantics",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "merge", "exhaust"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-011", "POL-013"],
    fixture:
      "Place a valid exhausted proof in each child position with otherwise valid adjacency and root continuity.",
    proofOff: {
      outcome: "accept",
      note: "Current merge does not constrain child exhausted flags and always returns exhausted=false.",
    },
    proofOn: {
      outcome: "accept",
      note: "The recursive proof verifies the implemented reset-to-false behavior without approving terminal extension semantics.",
    },
  },
  {
    id: "ZK-STLV-MERGE-018",
    family: "ZK-STLV-MERGE",
    title: "Reject merge orchestration with no base proofs",
    component: "MergeProofOrchestrator.merge",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge"],
      },
    ],
    claims: ["HOST", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture: "The STLV proof store reports count 0.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "merge() rejects with no base proofs before queue work or root publication.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The same host preflight rejects before any proof-on work.",
    },
  },
  {
    id: "ZK-STLV-MERGE-019",
    family: "ZK-STLV-MERGE",
    title: "Reject a missing base proof in a counted range",
    component: "MergeProofOrchestrator.merge",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "readBaseProof"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "Proof count includes IDs 0 through 2, but base proof ID 1 is absent.",
    proofOff: {
      outcome: "reject",
      failureClass: "STORAGE_FAILURE",
      note: "The orchestrator rejects the missing contiguous base ID and does not publish root.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "STORAGE_FAILURE",
      note: "The same storage check rejects before a proof can be accepted.",
    },
  },
  {
    id: "ZK-STLV-MERGE-020",
    family: "ZK-STLV-MERGE",
    title: "Reject a disjoint pending proof forest",
    component: "MergeProofOrchestrator.merge",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge"],
      },
      {
        path: STLV_PROVER,
        symbols: ["StakingLedgerToVotingLedgerProver.findMergeableProofs"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "All counted base proofs exist, but their public index spans cannot form one contiguous chain.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The merge ends with multiple disjoint proofs and does not publish a root.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The same disjoint-chain check rejects after all executable merge work drains.",
    },
  },
  {
    id: "ZK-STLV-MERGE-021",
    family: "ZK-STLV-MERGE",
    title: "Reuse a compatible cached merge proof",
    component: "MergeProofOrchestrator.merge cache",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "mergeIdFor"],
      },
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage.getMergeProof"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "A prior run stored the valid merge proof for the exact unchanged pair of child IDs and proof contents.",
    proofOff: {
      outcome: "accept",
      note: "The cache hit avoids a duplicate merge task and returns the same public output.",
    },
    proofOn: {
      outcome: "accept",
      note: "Reuse is allowed only after the cached proof verifies with the expected key and current provenance.",
    },
  },
  {
    id: "ZK-STLV-MERGE-022",
    family: "ZK-STLV-MERGE",
    title: "Detect a replaced base proof under the same storage ID",
    component: "MergeProofOrchestrator.merge cache identity",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "mergeIdFor"],
      },
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage.setProof"],
      },
    ],
    claims: ["RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-022", "POL-032"],
    fixture:
      "Replace one base proof's content under its original ID while retaining a cached merge for the unchanged pair IDs.",
    proofOff: {
      outcome: "record",
      note: "Current merge IDs bind child IDs, not proof content; record stale cache reuse unless provenance rejects it.",
    },
    proofOn: {
      outcome: "record",
      note: "Require a cache miss or verified rejection before accepting the root; current orchestration does not enforce this itself.",
    },
  },
  {
    id: "ZK-STLV-MERGE-023",
    family: "ZK-STLV-MERGE",
    title: "Reject or flag a corrupt cached root proof",
    component: "STLV cached root retrieval",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: [
          "MergeProofOrchestrator.ROOT_PROOF_ID",
          "MergeProofOrchestrator.merge",
        ],
      },
      {
        path: STLV_PROVER,
        symbols: ["StakingLedgerToVotingLedgerProver.proveExhaust"],
      },
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage.getMergeProof"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "unresolved",
    policyIds: ["POL-023", "POL-032"],
    fixture:
      "Replace the cached root with malformed JSON and, separately, a decodable proof whose bytes do not match its public fields.",
    proofOff: {
      outcome: "record",
      note: "Malformed JSON must reject; proof-off cannot authenticate a decodable forged root and records the capability boundary.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "The forged root must fail verification before it becomes accepted exhaustion evidence.",
    },
  },
  {
    id: "ZK-STLV-MERGE-024",
    family: "ZK-STLV-MERGE",
    title: "Handle an incompatible first candidate before a valid later pair",
    component: "StakingLedgerToVotingLedgerProver.findMergeableProofs",
    sources: [
      {
        path: STLV_PROVER,
        symbols: ["StakingLedgerToVotingLedgerProver.findMergeableProofs"],
      },
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge"],
      },
    ],
    claims: ["RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-022"],
    fixture:
      "The pending set has an index-adjacent pair with incompatible roots before another index-adjacent pair with valid roots.",
    proofOff: {
      outcome: "record",
      note: "Current selection checks only index adjacency and can stop on the incompatible first pair instead of selecting the later valid pair.",
    },
    proofOn: {
      outcome: "record",
      note: "Record the same selection failure; proof verification does not repair candidate search order.",
    },
  },
  {
    id: "ZK-STLV-MERGE-025",
    family: "ZK-STLV-MERGE",
    title: "Detect changed child content with stable child IDs",
    component: "MergeProofOrchestrator.merge cache identity",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "mergeIdFor"],
      },
    ],
    claims: ["RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-022", "POL-032"],
    fixture:
      "Change one or both child proof payloads without changing their pair of storage IDs.",
    proofOff: {
      outcome: "record",
      note: "The derived merge ID remains unchanged; record whether stale cached output is returned.",
    },
    proofOn: {
      outcome: "record",
      note: "Require verified rejection or a content-bound cache miss; current ID derivation does not supply that binding.",
    },
  },
  {
    id: "ZK-STLV-MERGE-026",
    family: "ZK-STLV-MERGE",
    title: "Reject proof-off cache reuse in proof-on",
    component: "STLV proof cache mode isolation",
    sources: [
      {
        path: STLV_PROVER,
        symbols: [
          "StakingLedgerToVotingLedgerProver",
          "digest",
          "proveExhaust",
        ],
      },
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "unresolved",
    policyIds: ["POL-022", "POL-032"],
    fixture:
      "Point a proof-on run at a proof namespace populated by proof-off artifacts with the same lifecycle and storage IDs.",
    proofOff: {
      outcome: "record",
      note: "Create and identify the proof-off cache artifact as the required negative-control source.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "Mode or provenance validation must reject before reuse; absence of that production check is an unresolved enforcement gap.",
    },
  },
  {
    id: "ZK-STLV-MERGE-027",
    family: "ZK-STLV-MERGE",
    title: "Detect cached proof reuse across lifecycle or build",
    component: "STLV proof cache provenance",
    sources: [
      {
        path: STLV_PROOF_STORAGE,
        symbols: ["KeyvStakingLedgerToVotingLedgerProofStorage"],
      },
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "mergeIdFor"],
      },
    ],
    claims: ["RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-006", "POL-022"],
    fixture:
      "Supply same-ID cached children or root from another lifecycle or application build with equal public roots.",
    proofOff: {
      outcome: "record",
      note: "Current proof fields can be indistinguishable when roots match; record whether external provenance flags reuse.",
    },
    proofOn: {
      outcome: "record",
      note: "Cryptographic verification alone does not bind lifecycle or build metadata when the circuit and public values match.",
    },
  },
  {
    id: "ZK-STLV-MERGE-028",
    family: "ZK-STLV-MERGE",
    title: "Record merge-proof persistence failure",
    component: "MergeProofOrchestrator.persist",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.merge", "persist"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-020", "POL-023"],
    fixture:
      "setMergeProof() and merged flags stage successfully, then batchWriter.setMany() fails.",
    proofOff: {
      outcome: "record",
      note: "The operation rejects; reopen storage and record proof, flags, buffered entries, and retry behavior.",
    },
    proofOn: {
      outcome: "record",
      note: "The same persistence atomicity result is required after a real merge proof completes.",
    },
  },
  {
    id: "ZK-STLV-MERGE-029",
    family: "ZK-STLV-MERGE",
    title: "Record root-publication failure",
    component: "MergeProofOrchestrator root publication",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: [
          "MergeProofOrchestrator.ROOT_PROOF_ID",
          "MergeProofOrchestrator.merge",
          "persist",
        ],
      },
    ],
    claims: ["HOST", "RESILIENCE", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "unresolved",
    policyIds: ["POL-023"],
    fixture:
      "All merges complete, then root setMergeProof() or its batchWriter.setMany() publication fails.",
    proofOff: {
      outcome: "record",
      note: "The operation rejects and no completion consumer can treat an absent or partial root as published.",
    },
    proofOn: {
      outcome: "record",
      note: "The same publication rule applies after the real root proof verifies.",
    },
  },
  {
    id: "ZK-STLV-MERGE-030",
    family: "ZK-STLV-MERGE",
    title: "Serialize concurrent merge persistence",
    component: "MergeProofOrchestrator.persist",
    sources: [
      {
        path: MERGE_ORCHESTRATOR,
        symbols: ["MergeProofOrchestrator.persist", "persistQueue"],
      },
    ],
    claims: ["HOST", "RESILIENCE", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "Two merge tasks complete concurrently and share one buffered proof storage and batch writer.",
    proofOff: {
      outcome: "accept",
      note: "Persistence runs serially; neither call clears the other call's unwritten entries.",
    },
    proofOn: {
      outcome: "accept",
      note: "Real-proof completion order does not change the serialized persistence invariant.",
    },
  },

  {
    id: "ZK-STLV-EXHAUST-001",
    family: "ZK-STLV-EXHAUST",
    title: "Exhaust after a padded final batch",
    component: "StakingLedgerToVotingLedger.exhaust",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A valid final digest proof includes trailing committed empty accounts, and output.index+1 is also a committed empty leaf.",
    proofOff: {
      outcome: "accept",
      note: "Exhaust binds the child input, checks the next empty leaf, preserves index and voting root, and sets exhausted=true.",
    },
    proofOn: {
      outcome: "accept",
      note: "The child and exhaust proofs verify with the same terminal public output.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-002",
    family: "ZK-STLV-EXHAUST",
    title: "Exhaust after a full populated final batch",
    component: "StakingLedgerToVotingLedger.exhaust",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["ORACLE", "CONSTRAINT", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A valid digest proof ends on five populated leaves and the immediately following committed leaf is Account.empty().",
    proofOff: {
      outcome: "accept",
      note: "The empty-next-leaf check succeeds and changes only exhausted from false to true.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real child and terminal proofs verify with the same public values.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-003",
    family: "ZK-STLV-EXHAUST",
    title: "Characterize circuit exhaustion of a nonzero-start child",
    component: "StakingLedgerToVotingLedger.exhaust circuit",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["CHARACTERIZATION", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "characterization",
    policyIds: ["POL-025"],
    fixture:
      "A valid child proof starts above index 0 and its next staking leaf is committed empty.",
    proofOff: {
      outcome: "accept",
      note: "The circuit binds the child public input but has no start-at-zero constraint.",
    },
    proofOn: {
      outcome: "accept",
      note: "The real exhaust proof verifies this circuit behavior; wrapper and contract rejection are separate cases.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-004",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a nonzero-start root in the prover wrapper",
    component: "StakingLedgerToVotingLedgerProver.proveExhaust",
    sources: [
      {
        path: STLV_PROVER,
        symbols: [
          "StakingLedgerToVotingLedgerProver.proveExhaust",
          "MergeProofOrchestrator.ROOT_PROOF_ID",
        ],
      },
    ],
    claims: ["HOST", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture:
      "Store a valid root proof whose publicInput.index is nonzero under the root proof ID.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "proveExhaust() rejects before compilation or witness access because the stored root does not start at 0.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The same wrapper preflight rejects before proof-on work.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-005",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a nonzero-start transformation at the contract",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: ["TreasuryProposalSmartContract.tallyVotes"],
      },
      {
        path: STLV_PROGRAM,
        symbols: ["SideLoadedStakingLedgerToVotingLedgerProof"],
      },
    ],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Pass an otherwise valid exhausted transformation proof whose publicInput.index is nonzero into tallyVotes().",
    proofOff: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "The contract start-at-zero assertion rejects with no state, balance, action, or event change.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "A real valid proof still fails the independent contract start-index assertion.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-006",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a nonexhausted transformation at the contract",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: ["TreasuryProposalSmartContract.tallyVotes"],
      },
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedgerProgramOutput.exhausted"],
      },
    ],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Pass a valid digest or merge proof with publicOutput.exhausted=false and all other contract bindings valid.",
    proofOff: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "The contract exhausted assertion rejects with no protected transaction effect.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "A real valid nonterminal proof still fails the contract terminal-flag assertion.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-007",
    family: "ZK-STLV-EXHAUST",
    title: "Document the fully populated height-36 capacity limit",
    component: "StakingLedgerToVotingLedger.exhaust capacity",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["PrefixedMerkleWitness36", "exhaust"],
      },
      {
        path: PREFIXED_MERKLE_TREE,
        symbols: ["PrefixedMerkleTree.leafCount"],
      },
    ],
    claims: ["STATIC_ONLY", "UNRESOLVED"],
    priority: "P0",
    phasePolicy: "external-exception",
    policyStatus: "unresolved",
    policyIds: ["POL-025"],
    fixture:
      "Static boundary model for exactly 2^35 populated leaves at indices 0..2^35-1; do not allocate the tree.",
    proofOff: {
      outcome: "not-applicable",
      note: "There is no in-domain next leaf for the implemented empty-next-leaf check; this is a documented capacity limit.",
    },
    proofOn: {
      outcome: "not-applicable",
      note: "Do not attempt proof generation for an impossible next witness or claim full-capacity exhaustion.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-008",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a nonempty next staking leaf",
    component: "StakingLedgerToVotingLedger.exhaust circuit",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust", "Account.empty"],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The child output index is followed by a committed populated staking account.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Calculating the witness root with Account.empty() does not equal the child staking root.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "Proof generation rejects on the same empty-next-leaf constraint.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-009",
    family: "ZK-STLV-EXHAUST",
    title: "Reject an exhaust public input that differs from its child input",
    component: "StakingLedgerToVotingLedger.exhaust child binding",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedger",
          "exhaust",
          "StakingLedgerToVotingLedgerProgramInput",
        ],
      },
    ],
    claims: ["CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Change one public input field passed to exhaust while retaining an unchanged valid child proof.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The Poseidon hash of the method public input does not equal the child public-input hash.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The proving path rejects the same explicit public-input binding.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-010",
    family: "ZK-STLV-EXHAUST",
    title: "Reject an exhaust child proof from another key",
    component: "StakingLedgerToVotingLedger.exhaust child verification",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust", "SelfProof.verify"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Use a structurally compatible child proof from another program or changed STLV verification key with matching public values.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records that explicit public-value constraints do not authenticate the child proof.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "SelfProof verification rejects the foreign child proof.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-011",
    family: "ZK-STLV-EXHAUST",
    title: "Characterize exhaustion after a sparse prefix",
    component: "StakingLedgerToVotingLedger.exhaust density",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-005"],
    fixture:
      "A valid child covers only a prefix, the next leaf is empty, and a later leaf is populated.",
    proofOff: {
      outcome: "accept",
      note: "The circuit checks only the immediate next leaf and sets exhausted=true.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies the implemented local check but cannot establish complete-ledger transformation without a density invariant.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-012",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a stale staking snapshot in the prover wrapper",
    component: "StakingLedgerToVotingLedgerProver.proveExhaust",
    sources: [
      {
        path: STLV_PROVER,
        symbols: ["StakingLedgerToVotingLedgerProver.proveExhaust"],
      },
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["HOST", "CONSTRAINT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "The stored root proof binds snapshot A, but proveExhaust() receives staking ledger snapshot B with a different root.",
    proofOff: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The next-leaf witness from snapshot B cannot calculate the proof input root from snapshot A.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "CONSTRAINT_UNSATISFIED",
      note: "The real exhaust proof cannot be generated across the stale snapshot boundary.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-013",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a stale staking root at the contract",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: [
          "TreasuryProposalSmartContract.tallyVotes",
          "stakingEpochDataLedgerHash",
        ],
      },
    ],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A valid exhausted proof binds a staking root different from the Proposal stakingEpochDataLedgerHash state.",
    proofOff: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "The contract staking-root assertion rejects with no protected transaction effect.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "A cryptographically valid stale-snapshot proof still fails the contract state binding.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-014",
    family: "ZK-STLV-EXHAUST",
    title: "Characterize a second exhaust call",
    component: "StakingLedgerToVotingLedger.exhaust terminal semantics",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "exhaust"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-012"],
    fixture:
      "Use a valid exhausted proof as the child of another exhaust call while its same next leaf remains empty.",
    proofOff: {
      outcome: "accept",
      note: "Current exhaust does not reject exhausted children; it preserves the terminal public values.",
    },
    proofOn: {
      outcome: "accept",
      note: "The second real exhaust proof verifies, but the protocol meaning remains undecided.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-015",
    family: "ZK-STLV-EXHAUST",
    title: "Characterize digest extension after exhaustion",
    component: "StakingLedgerToVotingLedger terminal extension",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest", "exhaust"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-013"],
    fixture:
      "After a valid exhausted proof, invoke digest at the next valid batch input using its staking and voting roots.",
    proofOff: {
      outcome: "accept",
      note: "Digest has no exhausted input field and accepts independently valid public input and witnesses.",
    },
    proofOn: {
      outcome: "accept",
      note: "A new digest proof can verify; no recursive link to the exhausted proof enforces terminality.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-016",
    family: "ZK-STLV-EXHAUST",
    title: "Accept a complete exhausted transformation at tally",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: ["TreasuryProposalSmartContract.tallyVotes"],
      },
      {
        path: STLV_PROGRAM,
        symbols: ["SideLoadedStakingLedgerToVotingLedgerProof"],
      },
    ],
    claims: ["CONTRACT", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Use a start-0 exhausted STLV proof whose staking root, empty initial voting root, and final voting root match Proposal and VoteReducer inputs.",
    proofOff: {
      outcome: "accept",
      note: "The STLV-specific tally bindings pass; remaining tally inputs independently satisfy their contract conditions.",
    },
    proofOn: {
      outcome: "accept",
      note: "The side-loaded proof verifies with the configured STLV key and passes the same contract bindings.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-017",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a nonempty initial voting root at tally",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: [
          "TreasuryProposalSmartContract.emptyVotingLedgerRoot",
          "TreasuryProposalSmartContract.tallyVotes",
        ],
      },
    ],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A valid exhausted STLV proof starts at index 0 but binds a nonempty initial votingLedgerRoot.",
    proofOff: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "The contract initial-voting-root assertion rejects without protected effects.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "A real valid proof still fails the independent empty-root contract binding.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-018",
    family: "ZK-STLV-EXHAUST",
    title: "Reject a final voting-root mismatch at tally",
    component: "TreasuryProposalSmartContract.tallyVotes",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: ["TreasuryProposalSmartContract.tallyVotes"],
      },
    ],
    claims: ["CONTRACT", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "Valid STLV and VoteReducer proofs bind different final voting-ledger roots while their other contract fields match.",
    proofOff: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "The contract cross-proof voting-root assertion rejects without protected effects.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "TRANSACTION_PRECONDITION",
      note: "Both real proofs can verify separately, but their root mismatch still rejects at the contract.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-019",
    family: "ZK-STLV-EXHAUST",
    title: "Reject an STLV proof from another program or key at tally",
    component: "TreasuryProposalSmartContract.tallyVotes proof verification",
    sources: [
      {
        path: TREASURY_PROPOSAL,
        symbols: [
          "TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey",
          "TreasuryProposalSmartContract.tallyVotes",
        ],
      },
      {
        path: STLV_PROGRAM,
        symbols: ["SideLoadedStakingLedgerToVotingLedgerProof"],
      },
    ],
    claims: ["PROOF_AUTHENTICITY", "CONTRACT"],
    priority: "P0",
    phasePolicy: "proof-authenticity",
    policyStatus: "conformance",
    fixture:
      "Supply a shape-compatible proof from another program or changed key whose public values satisfy the explicit tally bindings.",
    proofOff: {
      outcome: "record",
      note: "Proof-off records that disabled verification cannot establish the configured STLV program identity.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "PROOF_VERIFICATION",
      note: "Side-loaded proof verification rejects against the Proposal's configured STLV verification key.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-020",
    family: "ZK-STLV-EXHAUST",
    title: "Characterize equal-root proof reuse across lifecycle IDs",
    component: "STLV proof lifecycle binding",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: [
          "StakingLedgerToVotingLedgerProgramInput",
          "StakingLedgerToVotingLedgerProgramOutput",
        ],
      },
      {
        path: TREASURY_PROPOSAL,
        symbols: ["TreasuryProposalSmartContract.tallyVotes"],
      },
    ],
    claims: ["CHARACTERIZATION", "UNRESOLVED", "CONTRACT"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "unresolved",
    policyIds: ["POL-006"],
    fixture:
      "Reuse a valid exhausted proof in another lifecycle whose authoritative staking and voting roots are exactly equal.",
    proofOff: {
      outcome: "accept",
      note: "The STLV public input has no lifecycle field, so equal-root reuse is indistinguishable to current constraints.",
    },
    proofOn: {
      outcome: "accept",
      note: "The proof verifies because its circuit and public values match; lifecycle provenance remains external and unresolved.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-021",
    family: "ZK-STLV-EXHAUST",
    title: "Reject wrapper exhaustion when no root proof exists",
    component: "StakingLedgerToVotingLedgerProver.proveExhaust",
    sources: [
      {
        path: STLV_PROVER,
        symbols: [
          "StakingLedgerToVotingLedgerProver.proveExhaust",
          "MergeProofOrchestrator.ROOT_PROOF_ID",
        ],
      },
    ],
    claims: ["HOST", "PROOF_MODE_PARITY"],
    priority: "P1",
    phasePolicy: "host-dual",
    policyStatus: "conformance",
    fixture: "The STLV proof store has no proof under the root ID.",
    proofOff: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "proveExhaust() rejects before context setup, compilation, or witness access.",
    },
    proofOn: {
      outcome: "reject",
      failureClass: "HOST_PREFLIGHT",
      note: "The same missing-root preflight rejects before proof-on work.",
    },
  },
  {
    id: "ZK-STLV-EXHAUST-022",
    family: "ZK-STLV-EXHAUST",
    title:
      "Establish complete transformation with an independent density invariant",
    component: "STLV complete-transformation oracle",
    sources: [
      {
        path: STLV_PROGRAM,
        symbols: ["StakingLedgerToVotingLedger", "digest", "merge", "exhaust"],
      },
    ],
    claims: ["ORACLE", "PROOF_AUTHENTICITY", "PROOF_MODE_PARITY"],
    priority: "P0",
    phasePolicy: "paired-semantic",
    policyStatus: "conformance",
    fixture:
      "A dense authoritative account list has a frozen count, all covered batches start at 0, and the next committed leaf is empty.",
    proofOff: {
      outcome: "accept",
      note: "Proof public values plus the independent dense account-count oracle establish complete transformation for the fixture.",
    },
    proofOn: {
      outcome: "accept",
      note: "The verified proof and the same independent density oracle establish the equivalent proof-on claim.",
    },
  },
] as const);
