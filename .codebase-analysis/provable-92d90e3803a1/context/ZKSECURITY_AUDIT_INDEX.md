# zkSecurity Mina Treasury audit — bound finding index

- Source: https://reports.zksecurity.xyz/reports/mina-treasury-1.md
- Markdown SHA-256 at retrieval: `fbe4fb7745391609600ba40c0a4c527e3756bd086af852acc71b95fa31abf7e6`
- Published: 2026-04-28
- Audited revision: `f2c93cfdb27836b156769ca4eaeca7d5f01fa8b5`
- Scope: `packages/sdk/src/provable`, specifically 11 files named by the report.
- Current analyzed revision: `1e27b1aea88f5ea2764db96e4b337b24fe6dbeb3`

The report contains 28 items: 8 High, 2 Medium, 4 Low, and 14 Informational.

High: prover-controlled action-history `found` flags; action history not linked to `toActionsHash`; action-state uniqueness missing; ineffective deploy permissions; voting/nullifier index aliasing; UInt64 overflow in acceptance criteria; unconstrained initial staking-ledger index; unconstrained initial voting-ledger root.

Medium: missing token-ID check on Treasury Owner input; restrictive Treasury Owner permissions preventing operation.

Low: permissionless execution on behalf of recipient; bond paid to recipient rather than proposer; weak pause-controller signature binding; last-block-slot precondition rather than inclusion slot.

Informational: merge commit/tally; create-proposal state-reset reliance on permissions; delegate emptiness instead of token ID; DUMMY votes; hashed struct comparison; missing minimum proposal/voting balance; staking-to-voting proof efficiency; proposal methods needlessly proof-authorized; raw `Field(0)` status; redundant action-hash assertion; stale staking epoch data; toggle without intended state; pause destroys proposal finality; redundant proof verification.

The report marks the eight High findings and both Medium findings as fixed in cited commits, and marks the commit/tally informational item fixed. All remaining Low and Informational items are acknowledged. This run must independently inspect the current revision and may not inherit either remediation or severity without source traceability.
