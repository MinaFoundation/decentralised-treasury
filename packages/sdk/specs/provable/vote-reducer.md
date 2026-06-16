# Vote reducer

## Summary

`VoteReducer` must be the ZkProgram circuit that turns proposal vote actions into weighted yay, nay, and abstain totals. It consumes vote actions emitted by `TreasuryProposalSmartContract`, reads delegate balances from the voting ledger produced by `StakingLedgerToVotingLedger`, writes nullifiers to prevent double counting, and exposes public output that proposal tallying can verify.

The `VoteReducer` ZkProgram belongs to the off-chain circuit layer and is consumed by treasury proposal tallying through `SideLoadedVoteReducerProof`. Operators may trace vote-action batches and replay them in proving workers, but trace data is not trusted unless the circuit constraints validate voting ledger roots, nullifier roots, action hash continuity, and witness indexes.

## Scope

- Reducing fixed-size vote action batches into weighted vote totals.
- Preventing double-counting with a nullifier ledger keyed by voter public key.
- Maintaining action hash continuity from proposal reducer actions.
- Tracking whether expected proposal action-state hashes have been seen.
- Recursively merging adjacent vote reducer proofs.
- Exposing a side-loaded proof interface for proposal tallying.

## Concept specification

### Weighted Vote Reduction

The vote reducer must translate proposal vote actions into weighted vote totals. Each non-dummy vote action identifies a voter public key and vote enum. The circuit must prove the voter's voting account under the public voting ledger root, then add that voting account balance to the selected vote bucket unless the voter nullifier is set.

Vote weights come from the voting ledger, not from proposal actions. This separates vote intent collection from vote-weight lookup and lets the proposal tally consume a proof rather than re-reading every vote witness.

### Nullifier-Based Double-Vote Prevention

The reducer must use a nullifier ledger keyed by voter public key. For each non-dummy vote action, the circuit must prove the current nullifier value under the rolling nullifier root, count the vote only when the nullifier is false, and update the nullifier root to mark the voter as used. Duplicate votes in the same batch or across batches must contribute weight only once.

Dummy actions exist only to pad fixed-size batches. A dummy action is valid padding only when the vote is `DUMMY` and the public key is `PublicKey.empty()`. A `DUMMY` vote paired with a non-empty public key must still update action and nullifier state while contributing zero vote weight.

### Action Hash Continuity

The reducer must append every non-dummy vote action to the proposal action hash chain using Mina zkApp action hashing. Public input starts from `fromActionsHash`, and public output exposes `toActionsHash`. Merged proofs must prove that the first proof's `toActionsHash` equals the second proof's `fromActionsHash`.

The reducer also tracks up to five target action-state hashes. Each batch marks a target as found when the rolling action hash reaches it, and merge preserves found flags across adjacent proofs. Treasury owner tallying uses this output to approve proposal action-state account updates.

### Parallel Proof Generation

The proving flow must allow vote action batches to be proven independently. The trace must be produced by dry-running the circuit with proofs disabled so the operator captures public input, private vote actions, voting/nullifier witnesses, and public output. A proving worker can replay the captured witness data with proofs enabled, and the circuit must still constrain all replayed data back to public roots and indexes.

## Technical specification

### Constants and configuration

| Name | Meaning |
|------|---------|
| `VOTE_ACTION_BATCH_SIZE = 5` | Number of vote actions reduced per base proof |
| Voting ledger tree height `255` | Voting account witness height |
| Nullifier ledger tree height `255` | Nullifier witness height |
| Voting account hash prefix `MinaVotingAccount*********` | Voting account leaf hash domain |
| Nullifier hash prefix `MinaNullifier*************` | Nullifier leaf hash domain |
| Merkle path prefixes `TreasuryMklTree000******` through `TreasuryMklTree254******` | Per-level prefixes for voting and nullifier ledgers |
| Side-loaded proof depth `maxProofsVerified = 2` | Treasury zkApp-verifiable side-loaded proof can verify recursive reducer proofs |

### Public and private IO

```ts
class VoteReducerPublicInput extends Struct({
  fromActionsHash: Field,
  votingLedgerRoot: Field,
  fromNullifierRoot: Field,
  actionStateHistoryTarget: ActionStateHistoryTarget,
}) {}

class VoteReducerPublicOutput extends Struct({
  toActionsHash: Field,
  toNullifierRoot: Field,
  yay: UInt64,
  nay: UInt64,
  abstain: UInt64,
  actionStateHistory: ActionStateHistory,
}) {}
```

`fromActionsHash` and `toActionsHash` commit to reducer action continuity. `votingLedgerRoot` fixes the voting weights for the full proof chain. `fromNullifierRoot` and `toNullifierRoot` roll forward as voters are marked used. `actionStateHistoryTarget` and `actionStateHistory` let the proof report which proposal action states were encountered.

### Vote and action types

| Type | Meaning |
|------|---------|
| `Vote.DUMMY = 0` | Padding vote value |
| `Vote.YAY = 1` | Approval vote |
| `Vote.NAY = 2` | Rejection vote |
| `Vote.ABSTRAIN = 3` | Participation-only vote |
| `VoteAction` | `{ vote, publicKey }` reducer action |
| `ActionStateHistoryTarget` | Up to five target action-state hashes |
| `ActionStateHistory` | Target hashes plus `found` flags |

### Circuit methods

| Method | Private inputs | Public output effect |
|--------|----------------|----------------------|
| `reduceBatch` | `VoteAction[5]` | Advances action hash and nullifier root; accumulates yay/nay/abstain weights; updates action-state found flags |
| `merge` | Two self proofs | Checks proof continuity and sums tallies while preserving action-state history |

### Witnesses and off-chain data

For each vote action, the prover must supply:

- The voting account for the action public key.
- A voting account witness proving the voting account under `votingLedgerRoot` at `Poseidon.hash(publicKey.toFields())`.
- The current nullifier value for the action public key.
- A nullifier witness proving the nullifier under the rolling nullifier root at the same public-key-derived index.

The context writes updated nullifier records and leaves as an off-chain obligation. Those writes are not trusted unless the next witness and root checks succeed.

### Proofs and verification

`SideLoadedVoteReducerProof` must expose `VoteReducerPublicInput` and `VoteReducerPublicOutput` with `maxProofsVerified = 2`. Treasury proposal tallying verifies this proof with the configured vote reducer verification key and binds `publicInput.votingLedgerRoot` to the final voting ledger root from the staking-ledger-to-voting-ledger proof.

### Errors

| Message | Meaning |
|---------|---------|
| `Invalid vote` | Vote enum is not one of dummy/yay/nay/abstain |
| `Voting ledger root does not match` | Voting account witness does not resolve to the public voting ledger root |
| `Invalid witness provided for the vote nullifier` | Nullifier witness index does not match the voter public key |
| `Calculated nullifier root does not match toNullifierRoot` | Nullifier witness does not resolve to the rolling nullifier root |
| `Voting account index does not match` | Voting account witness index does not match the voter public key |
| `Vote reducer merge public input does not match first proof input` | Merge public input does not match first child input |
| `Voting ledger root does not match between merged proofs` | Merged proofs use different voting roots |
| `Action hash chain is not contiguous between merged proofs` | First output action hash does not equal second input action hash |
| `Nullifier root does not match between merged proofs` | First output nullifier root does not equal second input nullifier root |
| `Action state hash does not match between merged proofs` | Merged proofs report different target action-state hashes |

## Acceptance criteria

- A batch proof reduces exactly five vote actions.
- Yay, nay, and abstain outputs equal the sum of non-nullified voter balances for each vote option.
- Dummy actions with empty public key do not change tallies, action hash, or nullifier root.
- A `DUMMY` vote with a non-empty public key updates action and nullifier state but contributes zero weight.
- Duplicate voters in a batch or across batches are counted once.
- Voting account witness index, voting root, nullifier witness index, and nullifier root mismatches are rejected.
- Merge proofs reject mismatched public input, voting root, action hash continuity, or nullifier root continuity.
- Merged proofs sum tallies and preserve found action-state flags.
- The side-loaded proof exposes public IO needed by treasury proposal tallying.

## Design choices

### Fixed-Size Vote Batches

Vote actions are reduced in batches of five so each base proof has bounded size. Dummy actions provide padding without changing the semantic result when they use `Vote.DUMMY` and `PublicKey.empty()`.

### Nullifier Ledger

Nullifiers are separate from the voting ledger because vote weight and vote-use state are different commitments. This lets the same delegate voting balance be used for weighting while a separate public-key-indexed root prevents repeated voting.

### Action State History

The reducer tracks a bounded set of action-state hashes so the treasury owner can prove that proposal action states referenced by the reducer were present on the proposal account. This connects off-chain action fetching, recursive reduction, and on-chain account-update preconditions.

## Invariants and constraints

- The voting ledger root must remain constant across a reducer proof chain.
- The nullifier root must roll forward through batches and merges.
- Action hash output from one proof must equal action hash input to the next proof.
- Non-dummy vote actions must be appended to the action hash chain.
- A voter public key maps to both voting and nullifier witness indexes through `Poseidon.hash(publicKey.toFields())`.
- Side-loaded proof depth is `2`.

## Related specs

- [Treasury proposal](treasury-proposal.md)
- [Treasury owner](treasury-owner.md)
- [Staking ledger → voting ledger](staking-ledger-to-voting-ledger.md)
- [Provable primitives](provable-primitives.md)
