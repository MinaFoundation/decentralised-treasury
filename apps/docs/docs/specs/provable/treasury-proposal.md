---
title: Treasury Proposal
sidebar_label: Treasury Proposal
---

## Summary

`TreasuryProposalSmartContract` must be the proposal-local SmartContract that stores proposal state, accepts vote actions, tallies using side-loaded vote-reducer and staking-to-voting proofs, executes approved payouts, and holds proposal-local pause status. It is deployed under the treasury owner's derived token id and depends on the owner for lifecycle coordination, event emission, treasury balance movements, and approval of proposal account updates.

The proposal zkApp consumes `SideLoadedVoteReducerProof` and `SideLoadedStakingLedgerToVotingLedgerProof` during tallying. It must bind vote-reducer tallies to the voting ledger produced from the proposal's staking epoch ledger hash, then apply participation and approval thresholds derived from proposal size, treasury owner balance, and staking epoch total currency.

## Scope

- Storing proposal recipient, requested amount, lifecycle id, staking epoch data, status, and paid-out amount.
- Dispatching vote actions through the proposal reducer.
- Verifying side-loaded vote and staking-ledger transformation proofs for tallying.
- Calculating participation and approval thresholds.
- Mutating proposal status after tallying.
- Authorizing recipient payouts for approved proposals.
- Toggling proposal-local pause status.

## Concept specification

### Proposal-Local State

The proposal account must own proposal-local data that should not live on the treasury owner: recipient commitment, requested amount, lifecycle id, staking epoch ledger hash, staking epoch total currency, status, and paid-out amount. The owner initializes these fields during proposal creation so later tallying and execution can operate from proposal-local state.

### Vote Action Collection

The proposal must use an o1js reducer to collect vote actions. A vote action contains a vote enum and voter public key. The proposal account only dispatches actions; it does not calculate voting weights when votes arrive. This keeps vote dispatch cheap and defers weighted tallying to the vote reducer proof.

### Tally Binding

Tallying must verify both side-loaded proofs. The vote reducer proof must start from the initial actions hash and empty nullifier root, and its voting ledger root must match the final voting ledger root produced by the staking-ledger-to-voting-ledger proof. Its output action hash must match the first reported action-state hash. The staking-ledger-to-voting-ledger proof must start from staking index `0`, start from the configured empty voting ledger root, match the proposal's staking epoch ledger hash, and prove exhaustion.

The proposal must also verify the treasury owner account against the same staking epoch ledger root. This binds the treasury owner balance used in threshold calculation to the epoch ledger that produced the voting weights.

### Acceptance Math

The proposal must derive participation and approval requirements from the proposal amount, treasury owner balance, and staking epoch total currency. Proposal amount as a share of the treasury is capped at 100% and fed through participation and approval curves. The result must produce a required participation amount and required approval basis points.

A proposal must only be approved when participating vote weight meets the required participation, at least one yay/nay approval vote exists, and yay votes meet the required approval basis points among yay+nay votes. Otherwise the proposal must be rejected.

### Execution and Local Pause

Execution must be proposal-local authorization for a treasury owner payout. The proposal must require approved status, enforce the recipient commitment, prevent paying more than the remaining amount plus bond, update `paidOutAmount`, and approve the recipient account update. This allows partial payouts while preserving the total payout cap.

Proposal pause is local to the proposal account. Toggling pause must restore `PAUSED` proposals to `UNKNOWN` and must move any non-paused proposal status to `PAUSED`; globally paused treasury behavior remains owned by the pause controller and treasury owner.

## Technical specification

### Constants and configuration

| Name | Meaning |
|------|---------|
| `BOND_AMOUNT_DIVISOR = 10` | Execution cap includes proposal amount plus the bond amount |
| `BASIS_POINTS = UInt128(10_000)` | Basis-point denominator for threshold calculations in acceptance curve math |
| `MIN_PARTICIPATION_BP = 2_000` | Minimum participation threshold |
| `MAX_PARTICIPATION_BP = 5_000` | Maximum participation threshold |
| `MIN_APPROVAL_BP = 5_100` | Minimum approval threshold |
| `MAX_APPROVAL_BP = 7_000` | Maximum approval threshold |
| `CURVE_CONSTANT_PARTICIPATION_BP = 500` | Participation curve shape constant |
| `CURVE_CONSTANT_APPROVAL_BP = 1_000` | Approval curve shape constant |
| `voteReducerVerificationKey` | Verification key used for `SideLoadedVoteReducerProof` |
| `stakingLedgerToVotingLedgerVerificationKey` | Verification key used for `SideLoadedStakingLedgerToVotingLedgerProof` |
| `emptyNullifierRoot` | Required vote reducer starting nullifier root |
| `emptyVotingLedgerRoot` | Required staking-to-voting starting voting root |

### On-chain state

```ts
class TreasuryProposalSmartContract extends SmartContract {
  @state(Field) recipientHash: State<Field>;
  @state(UInt64) amount: State<UInt64>;
  @state(UInt32) lifecycleId: State<UInt32>;
  @state(Field) stakingEpochDataLedgerHash: State<Field>;
  @state(UInt64) stakingEpochDataLedgerTotalCurrency: State<UInt64>;
  @state(ProposalStatus) status: State<ProposalStatus>;
  @state(UInt64) paidOutAmount: State<UInt64>;
}
```

`recipientHash` must commit to the payout recipient without storing the public key directly. `paidOutAmount` must allow partial execution while preventing total payout beyond `amount + amount / BOND_AMOUNT_DIVISOR`.

### Types

| Type | Meaning |
|------|---------|
| `Proposal` | Proposal creation input: amount, recipient, and zkApp URI |
| `ProposalStatus.UNKNOWN = 0` | Untallied or unpaused active proposal state |
| `ProposalStatus.APPROVED = 1` | Tally result permits execution |
| `ProposalStatus.REJECTED = 2` | Tally result prevents execution |
| `ProposalStatus.PAUSED = 3` | Proposal-local pause state |

### Methods

| Method | Authorization and preconditions | State / account-update effect |
|--------|---------------------------------|-------------------------------|
| `getLifecycleId()` | Reads proposal state | Returns lifecycle id for owner lifecycle checks |
| `vote(voteAction)` | Proposal not locally paused | Dispatches reducer action |
| `tallyVotes(voteReducerProof, stakingLedgerToVotingLedgerProof, treasuryOwnerPublicKey, treasuryOwnerAccount, treasuryOwnerAccountWitness)` | Proposal not locally paused, status is `UNKNOWN`, both side-loaded proofs verify | Checks proof bindings, treasury owner account witness, threshold math, sets status to approved or rejected |
| `execute(amountToPayOut, recipient)` | Proposal not locally paused, status is approved | Checks recipient, remaining payout, updates `paidOutAmount`, approves recipient account update |
| `togglePause()` | Called through owner coordination | Restores `PAUSED` to `UNKNOWN`; otherwise sets status to `PAUSED` |

### Proof bindings

The vote reducer proof must expose:

```ts
{
  publicInput: {
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot: stakingProof.publicOutput.votingLedgerRoot,
    fromNullifierRoot: emptyNullifierRoot,
  },
  publicOutput: {
    toActionsHash,
    toNullifierRoot,
    yay,
    nay,
    abstain,
    actionStateHistory,
  },
}
```

The staking-ledger-to-voting-ledger proof must expose a start index of `0`, the empty voting ledger root as its input voting root, the proposal's staking epoch ledger hash as its staking root, and `exhausted = true`.

### Errors

| Message | Meaning |
|---------|---------|
| `Proposal is paused` | Proposal-local status is paused |
| `Vote result already set` | Tallying was attempted after status left `UNKNOWN` |
| `fromActionsHash should be the initial action state` | Vote reducer proof does not start from the initial action hash |
| `fromNullifierRoot does not match` | Vote reducer proof does not start from the empty nullifier root |
| `voting ledger root does not match` | Vote reducer proof does not use the voting root produced by staking-to-voting proof |
| `toActionsHash does not match action state one hash` | Vote reducer proof output does not match the first action state approved during tallying |
| `staking ledger transformation must start at index 0` | Staking-to-voting proof starts mid-ledger |
| `initial voting ledger root must be empty` | Staking-to-voting proof does not start from the empty voting ledger |
| `staking ledger root does not match` | Staking-to-voting proof does not match proposal staking epoch root |
| `staking ledger to voting ledger proof did not exhaust` | Staking-to-voting proof is not finalized |
| `Treasury owner account public key does not match` | Witnessed treasury owner account belongs to another key |
| `Treasury owner account token id does not match` | Treasury owner account is not a default-token staking account |
| `Treasury owner account witness does not match staking ledger hash` | Treasury owner account is not included in the proposal staking epoch ledger |
| `Participation not met` | Participating vote weight is below the required threshold |
| `No approval votes cast` | Yay+nay approval denominator is zero |
| `Proposal not approved` | Execution was attempted before approval |
| `Amount to pay out is greater than the remaining amount to pay out` | Execution would exceed amount plus bond minus prior payouts |
| `Recipient hash does not match on chain state` | Execution recipient does not match the committed recipient |

## Acceptance criteria

- Proposal state stores amount, recipient hash, lifecycle id, staking epoch ledger hash, staking epoch total currency, status, and paid-out amount.
- Votes dispatch reducer actions only while the proposal is not locally paused.
- Tallying rejects proofs with wrong action hash, nullifier root, voting root, staking root, start index, or exhaustion flag.
- Tallying verifies the treasury owner account against the same staking epoch ledger root used by voting weights.
- Acceptance thresholds match the configured curve outputs for proposal sizes from 1% to 100% of treasury balance.
- Tallying sets status to approved only when participation and approval thresholds are met.
- Execution cannot exceed remaining amount plus bond and must pay the committed recipient.
- Proposal pause toggling restores `PAUSED` proposals to `UNKNOWN` and moves any non-paused status to `PAUSED`.

## Design choices

### Proposal State Isolation

Proposal-local status, payout accounting, staking epoch data, and recipient commitment live on the proposal account. This avoids overloading the treasury owner with per-proposal state while keeping owner approval required for treasury-affecting transitions.

### Deferred Weighted Tallying

Votes are collected as reducer actions and weighted later by a vote reducer proof. This keeps vote dispatch independent from voting ledger witnesses and lets tallying happen after the voting period with a recursive proof.

### Dynamic Threshold Curves

Participation and approval requirements scale with proposal size relative to treasury balance. Larger proposals require higher participation and approval thresholds, capped by configured minimum and maximum basis points.

## Invariants and constraints

- Tallying must only move status from `UNKNOWN` to `APPROVED` or `REJECTED`.
- Vote reducer and staking-to-voting proofs must refer to the same voting ledger root.
- The staking-to-voting proof's staking root must match the proposal's staking epoch ledger hash.
- Treasury owner balance used for threshold math must be proven in the same staking epoch ledger.
- `paidOutAmount` must monotonically increase and must not exceed proposal amount plus bond.

## Related specs

- [Treasury owner](treasury-owner.md)
- [Vote reducer](vote-reducer.md)
- [Staking ledger → voting ledger](staking-ledger-to-voting-ledger.md)
- [Treasury pause controller](treasury-pause-controller.md)
