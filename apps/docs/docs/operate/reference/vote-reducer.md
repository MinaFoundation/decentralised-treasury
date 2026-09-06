---
title: Vote Reducer
sidebar_label: Vote Reducer
sidebar_position: 8
audience: operator
page_kind: reference
---

# Vote Reducer

## Intent

`VoteReducer` proves weighted `yay`, `nay`, and `abstain` totals from Proposal vote actions.

## Place in the system

`TreasuryProposalSmartContract.vote` dispatches `VoteAction` values. The Vote Reducer reads these actions after voting.

The reducer uses the voting ledger from `StakingLedgerToVotingLedger`. The Proposal verifies the final side-loaded proof during tally.

## Actors

| Actor or component | Action |
| --- | --- |
| Proposal account | Stores the Mina action-state history. |
| Operator | Fetches actions and selects five target action states. |
| Tracer | Records vote actions, witnesses, and rolling state. |
| Proving worker | Generates batch or merge proofs. |
| Treasury Proposal | Verifies the proof and uses its totals. |

## Public input and output

`VoteReducerPublicInput` contains:

| Field | Meaning |
| --- | --- |
| `fromActionsHash` | Action hash before the batch or proof chain. |
| `votingLedgerRoot` | Fixed root for voter weights. |
| `fromNullifierRoot` | Nullifier root before the batch or proof chain. |
| `actionStateHistoryTarget` | Five target Proposal action-state hashes. |

`VoteReducerPublicOutput` contains:

| Field | Meaning |
| --- | --- |
| `toActionsHash` | Action hash after the proof. |
| `toNullifierRoot` | Nullifier root after the proof. |
| `yay` | Weighted `yay` total. |
| `nay` | Weighted `nay` total. |
| `abstain` | Weighted abstain total. |
| `actionStateHistory` | Five targets with their `found` flags. |

The private input for `reduceBatch` is `VoteAction[5]`.

## Methods

| Method | Private input | Main relation |
| --- | --- | --- |
| `reduceBatch` | Five vote actions | Advances action and nullifier roots, then calculates weights. |
| `merge` | Two self proofs | Proves continuity and adds child tallies. |

Supporting helpers include `Vote.assertValid`, `VoteAction.isDummy`, `VoteAction.dummy`, and `ActionStateHistory.fromTarget`.

## Authorization and consumer bindings

The ZkProgram does not authorize a Mina transaction.

`SideLoadedVoteReducerProof` has `maxProofsVerified = 2`. The Proposal verifies it with `voteReducerVerificationKey`.

`VoteReducerProof` is the native program proof class. The side-loaded class defines the Proposal consumer interface.

The Proposal requires:

- `fromActionsHash = Reducer.initialActionState`;
- `fromNullifierRoot = emptyNullifierRoot`;
- `votingLedgerRoot` equal to the staking proof output root;
- `toActionsHash` equal to the first action-state target.

The Owner requires all five targets to be found, non-initial, unique, and present in Proposal account state.

## Conditions

`reduceBatch` checks the voting witness root and voter-derived index. It checks the nullifier witness against the rolling nullifier root.

`merge` requires equal voting roots and target hashes. It requires action-hash and nullifier-root continuity.

## Business logic

### Reduction

~~~mermaid
flowchart LR
  Actions[Five vote actions] --> Padding{Dummy action?}
  Padding -->|Yes| Skip[Do not change roots or totals]
  Padding -->|No| Voting[Verify voter under voting ledger root]
  Voting --> Nullifier[Verify current voter nullifier]
  Nullifier --> First{Nullifier false?}
  First -->|Yes| Add[Add voting balance to selected total]
  First -->|No| NoWeight[Add zero]
  Add --> Mark[Set voter nullifier]
  NoWeight --> Mark
  Mark --> Hash[Append action hash]
  Hash --> Targets[Mark matching action-state targets]
  Targets --> Output[New roots and totals]
~~~

The voting and nullifier ledgers are keyed by `Poseidon.hash(publicKey.toFields())`.

Only the first non-dummy action for one voter adds weight. Later actions still advance the action hash, but add zero weight.

A padding action is exactly `Vote.DUMMY` with `PublicKey.empty()`. It does not change action state, nullifiers, or totals.

`Vote.DUMMY` with a non-empty key is not padding. It advances action and nullifier state but adds no vote weight.

The source enum identifier is `Vote.ABSTRAIN`. The public output field is `abstain`.

### Five action-state targets

`ActionStateHistoryTarget` contains `actionStateOne` through `actionStateFive`.

Each batch reports whether its rolling action hash reached each target. `merge` combines the found flags.

The Owner checks all five targets against the Proposal account. This binds the proof chain to Mina action state.

All five targets must be distinct, non-initial, found by the proof, and present in Proposal account history.

One high-weight voter action is not sufficient for this condition.

### Action count and proof work

The supported SDK path submits one vote action in one Mina zkApp command. If a
Proposal has `V` included actions, the Vote Reducer creates `ceil(V / 5)` base
proofs. A complete merge plan uses one fewer merge than its number of base
proofs.

The Owner also binds five distinct, non-initial action-state history values.
Treat five included vote actions as a necessary lower bound for current-path
tally planning, even when fewer weighted delegates can meet participation. It
is not a finalizability guarantee.

See [Voting Capacity and Period Sizing](../lifecycle/voting-capacity-and-period-sizing.md)
for delegate and block-capacity examples.

## Constants

| Identifier | Value |
| --- | --- |
| `VOTE_ACTION_BATCH_SIZE` | `5` |
| `Vote.DUMMY` | `0` |
| `Vote.YAY` | `1` |
| `Vote.NAY` | `2` |
| `Vote.ABSTRAIN` | `3` |
| `PrefixedMerkleWitness255` | Voting and nullifier witness height `255` |
| `votingAccountHashPrefix` | `MinaVotingAccount*********` |
| `nullifierHashPrefix` | `MinaNullifier*************` |

## Events

The Vote Reducer emits no Mina events. It reduces Proposal actions.

The Owner emits `proposalVoteDispatched` for action discovery and `proposalVotesTallied` for the submitted result.

## Invariants

- The voting ledger root stays constant through the proof chain.
- The nullifier root rolls forward through each non-dummy vote.
- Action hashes are contiguous across batches and merges.
- A voter contributes nonzero weight at most once.
- Each non-dummy action advances the action hash.
- Each batch processes exactly five action slots.
- All merged proofs use the same five action-state target hashes.

## Errors

| Identifier or message | Cause |
| --- | --- |
| `Invalid vote` | The vote value is outside the four source enum values. |
| `voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH` | A voting witness resolves to another root. |
| `voteReducerErrors.VOTE_HAS_ALREADY_BEEN_NULLIFIED` | Reserved exported error identifier for a used voter. |
| `voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER` | The nullifier witness index does not match the voter. |
| `voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT` | A nullifier witness resolves to another rolling root. |
| `voteReducerErrors.VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH` | The voting witness index does not match the voter. |
| `Vote reducer merge public input does not match first proof input` | Merge input differs from the first child input. |
| `Voting ledger root does not match between merged proofs` | Child proofs use different voting roots. |
| `Action hash chain is not contiguous between merged proofs` | Child action hashes are not continuous. |
| `Nullifier root does not match between merged proofs` | Child nullifier roots are not continuous. |
| `Action state hash does not match between merged proofs` | Child proofs use different target hashes. |

## CLI and storage operations

See the [CLI command index](./cli-commands) for reducer and tally commands.

- `proposal fetch-actions` fetches Proposal actions from Archive GraphQL.
- `vote-reducer trace-run-batch` records fixed-size batch traces.
- `vote-reducer prove-run-batch` queues batch proofs.
- `vote-reducer prove-merge` merges adjacent proofs.
- `vote-reducer clear-state` removes the lifecycle-specific local reducer state.
- `proposal tally-votes` submits the final proof.

The tracer stages trace and ledger changes before it flushes them to SQLite.

These staged writes are not one atomic database transaction. A crash can leave partial trace or ledger state.

Clear and rebuild the lifecycle-specific reducer state after an interrupted flush.

Use one lifecycle-specific state set for each Proposal proof run.

## Sources

- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/ledgers/voting-ledger/voting-ledger.ts`
- `packages/sdk/src/ledgers/nullifier-ledger/nullifier-ledger.ts`
- `packages/sdk/src/proving/tracing/vote-reducer-tracer.ts`
- `packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.ts`
- `apps/cli/src/commands/vote-reducer.ts`
- `apps/cli/src/commands/proposal.ts`
- `packages/sdk/test/provable/contracts/treasury-proposal/vote-reducer.test.ts`
