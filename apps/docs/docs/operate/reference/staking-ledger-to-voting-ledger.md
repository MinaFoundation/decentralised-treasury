---
title: Staking Ledger to Voting Ledger
sidebar_label: Staking to voting ledger
sidebar_position: 7
audience: operator
page_kind: reference
---

# Staking Ledger to Voting Ledger

## Intent

`StakingLedgerToVotingLedger` proves the conversion from Mina accounts to delegate voting weights.

## Place in the system

Proposal creation records a staking ledger root. This ZkProgram starts from that root and produces a voting ledger root.

`VoteReducer` uses the voting ledger root. `TreasuryProposalSmartContract.tallyVotes` verifies the final side-loaded proof.

For Kubernetes snapshot acquisition, use
[1c. Staking Ledger Provider](../infrastructure/staking-ledger-provider.md).
For automatic tracing, proving, checkpoints, and artifact publication, use
[2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md).

## Actors

| Actor or component | Action |
| --- | --- |
| Voting-ledger scheduler | Selects the lifecycle snapshot and prepares SQLite state. |
| Tracer | Records private inputs, witnesses, and rolling outputs. |
| Proving worker | Replays a trace and generates a proof. |
| Operator | Merges proofs and produces the exhaustion proof. |
| Treasury Proposal | Verifies the final side-loaded proof. |

## Public input and output

`StakingLedgerToVotingLedgerProgramInput` contains:

| Field | Meaning |
| --- | --- |
| `index` | First staking ledger index for this proof. |
| `stakingLedgerRoot` | Fixed Mina staking ledger root. |
| `votingLedgerRoot` | Voting ledger root before this proof. |

`StakingLedgerToVotingLedgerProgramOutput` contains:

| Field | Meaning |
| --- | --- |
| `index` | Last staking ledger index processed. |
| `votingLedgerRoot` | Voting ledger root after this proof. |
| `exhausted` | Shows whether `exhaust` proved the next leaf empty. |

The private input for `digest` is `AccountBatch`, which contains five full Mina `Account` values.

## Methods

| Method | Private input | Main relation |
| --- | --- | --- |
| `digest` | `Account[5]` | Proves five account leaves and updates delegate weights. |
| `merge` | Two self proofs | Proves adjacent indexes and voting-root continuity. |
| `exhaust` | One self proof | Proves that the immediate next staking leaf is empty. |

## Authorization and consumer bindings

The ZkProgram does not authorize a Mina transaction.

`SideLoadedStakingLedgerToVotingLedgerProof` has `maxProofsVerified = 2`. The Proposal verifies it with `stakingLedgerToVotingLedgerVerificationKey`.

`StakingLedgerToVotingLedgerProof` is the native program proof class. The side-loaded class defines the Proposal consumer interface.

The Proposal requires:

- input `index = 0`;
- input `votingLedgerRoot = emptyVotingLedgerRoot`;
- input `stakingLedgerRoot = stakingEpochDataLedgerHash`;
- output `exhausted = true`.

The Proposal also binds the proof output `votingLedgerRoot` to the Vote Reducer input.

## Conditions

`digest` checks each staking witness index and root. It also checks each voting witness index and rolling root.

`merge` requires both child proofs to use the same staking root. It requires `output1.index + 1 = input2.index`.

`merge` also requires `output1.votingLedgerRoot = input2.votingLedgerRoot`.

`exhaust` verifies the previous proof. It then proves that `output.index + 1` contains `Account.empty()`.

## Business logic

### Transformation

~~~mermaid
flowchart LR
  Snapshot[Mina staking ledger root] --> Batch[Read five indexed accounts]
  Batch --> Token{Default MINA token?}
  Token -->|Yes| Weight[Use account balance]
  Token -->|No| Zero[Use zero]
  Weight --> Delegate[Read account delegate]
  Zero --> Delegate
  Delegate --> Add[Add to delegate voting account]
  Add --> Rolling[Update voting ledger root]
  Rolling --> Merge[Merge adjacent proofs]
  Merge --> Exhaust[Prove immediate next leaf is empty]
  Exhaust --> Final[Final voting ledger root and exhausted true]
~~~

Voting accounts are keyed by the delegate public key. More than one staking account can add balance to one delegate.

Only accounts with `TokenId.default` add voting weight. A non-default-token account adds zero.

### Ledger size and proof work

Let `N` be the staking account count and `D` be the number of distinct
delegate keys with positive voting weight. The program converts `N` account
leaves into at most `D` weighted voting accounts. More than one staking
account can add to the same delegate account.

The digest workload is `ceil(N / 5)` base proofs. It depends on the staking
account count, not the delegate count. Delegate count bounds the weighted
voting accounts. Only its signable subset can submit weighted votes.

See [Voting Capacity and Period Sizing](../lifecycle/voting-capacity-and-period-sizing.md)
for the transaction and proof formulas.

`exhaust` checks the immediate next leaf after the processed account sequence.

:::note Exhaustion and Mina ledger order

Mina staking-ledger exports provide an ordered account sequence. The treasury
importer writes each exported account to its sequence index. It does not create
gaps between imported accounts.

For this representation, an empty next leaf marks the end of the imported
staking ledger. The Project Review page keeps the narrower circuit-local
statement for assessment work.

Before proving, verify that the selected export root equals the Proposal
snapshot root.

:::

## Constants

| Identifier | Value |
| --- | --- |
| `ACCOUNT_BATCH_SIZE` | `5` |
| `AccountBatch` | `Account[5]` |
| `PrefixedMerkleWitness36` | Staking ledger witness height `36` |
| `PrefixedMerkleWitness255` | Voting ledger witness height `255` |
| `accountHashPrefix` | `MinaAccount*********` |
| `votingAccountHashPrefix` | `MinaVotingAccount*********` |

## Events

This ZkProgram emits no Mina events. It produces proof JSON and local trace data.

## Invariants

- The staking ledger root stays constant through a proof chain.
- Staking indexes are contiguous.
- The voting root rolls from one proof to the next.
- Each account uses its indexed staking witness.
- Each delegate uses its public-key-derived voting witness.
- Only default-token balance adds voting weight.
- A final proof starts at index `0` when the Proposal verifies it.

## Errors

| Identifier or check | Cause |
| --- | --- |
| `stakingLedgerIndexMismatch` | A staking witness index differs from the rolling index. |
| `stakingLedgerRootMismatch` | A staking witness resolves to another root. |
| `votingLedgerIndexMismatch` | A voting witness index differs from the delegate key. |
| `votingLedgerRootMismatch` | A voting witness resolves to another rolling root. |
| Exhaustion root check | The next empty leaf does not resolve to the staking root. |
| Merge adjacency check | Child proof indexes are not adjacent. |
| Merge root check | Child voting roots are not continuous. |

## CLI and storage operations

See the [CLI command index](./cli-commands) for proof and storage commands.

- `staking-ledger from-file` reads the exported snapshot.
- `staking-ledger hydrate-account-storage` stores parsed accounts.
- `staking-ledger hydrate-merkle-tree` builds the staking Merkle tree.
- `staking-ledger get-root-hash` prints the calculated root.
- `staking-ledger-to-voting-ledger trace-digest` records digest traces.
- `staking-ledger-to-voting-ledger checkpoint-restore` restores a matching S3 checkpoint.
- `staking-ledger-to-voting-ledger checkpoint-clean` removes one lifecycle checkpoint from S3.
- `staking-ledger-to-voting-ledger prove-digest` queues digest proofs.
- `staking-ledger-to-voting-ledger prove-merge` merges adjacent proofs.
- `staking-ledger-to-voting-ledger prove-exhaust` creates the final proof.

The tracer stages trace and ledger changes before it flushes them to SQLite.

These staged writes are not one atomic database transaction. A crash can leave partial trace or ledger state.

Clear and rebuild the affected lifecycle after an interrupted flush. Do not continue from unverified partial state.

The voting-ledger scheduler uses `.sqlite.done` as a completion marker. Proving uses proof files and `.sqlite.proven`.

## Sources

- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/account.ts`
- `packages/sdk/src/provable/voting-account.ts`
- `packages/sdk/src/ledgers/staking-ledger/staking-ledger.ts`
- `packages/sdk/src/ledgers/voting-ledger/voting-ledger.ts`
- `packages/sdk/src/proving/tracing/staking-ledger-to-voting-ledger-tracer.ts`
- `packages/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.ts`
- `apps/cli/src/commands/staking-ledger.ts`
- `apps/cli/src/commands/staking-ledger-to-voting-ledger.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `apps/cli/test/staking-ledger-to-voting-ledger.test.ts`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
