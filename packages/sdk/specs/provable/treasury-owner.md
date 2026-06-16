# Treasury owner

## Summary

`TreasuryOwnerSmartContract` must be the token-owning SmartContract that coordinates treasury governance across proposal zkApps, the pause controller zkApp, `SideLoadedVoteReducerProof`, and `SideLoadedStakingLedgerToVotingLedgerProof`. It owns the treasury token namespace, treasury balance movements, lifecycle gating, proposal deployment, vote dispatch, vote tally coordination, proposal execution, and proposal-pause coordination.

The treasury owner zkApp depends on `TreasuryPauseControllerSmartContract` for global pause checks and proposal-pause authorization. It deploys and approves `TreasuryProposalSmartContract` account updates under its derived token id, verifies `SideLoadedVoteReducerProof` and `SideLoadedStakingLedgerToVotingLedgerProof` before delegating tally checks to the proposal account, and emits the owner-level events consumed by indexer and operator services.

## Scope

- Deploying the treasury owner account with proof-authorized permissions and pause-controller linkage.
- Receiving treasury funds and holding proposer bonds.
- Creating proposal zkApp accounts under the treasury owner's derived token id.
- Enforcing lifecycle windows for proposal, voting, cooldown, and execution periods.
- Dispatching votes to proposal accounts while preventing direct external token updates.
- Coordinating vote tallying, proposal execution, and proposal-pause toggles.
- Emitting proposal lifecycle events from the owner account.

## Concept specification

### Treasury Ownership Boundary

The treasury owner must be the coordination point for treasury movement and proposal account authority. Proposal accounts live under the owner's derived token id, so the owner must approve proposal account updates that create proposals, dispatch votes, tally votes, toggle proposal pause, or execute payouts. This keeps proposal-local state on the proposal account while ensuring treasury-owned token operations remain mediated by the owner.

### Lifecycle Windows

The owner must divide governance into four fixed periods per lifecycle: proposal, exploration, voting, and cooldown. The lifecycle slot range is derived from the treasury deployment slot, `LIFECYCLE_PERIOD_DURATION`, the lifecycle id, and the requested period. Proposal creation must happen in the proposal period, voting must happen in the voting period, vote tallying must happen at or after cooldown, and proposal execution must happen only after the next lifecycle has reached the proposal period.

### Proposal Creation

Proposal creation must snapshot the Mina staking epoch ledger hash and total currency from network preconditions. The owner must create a proposal account update under its token id, initialize proposal state, set the proposal verification key and zkApp URI, collect the proposal bond into the treasury owner account, and emit `proposalCreated`. The proposal stores the staking epoch data because later tallying must bind vote weights to the same staking epoch.

### Vote Dispatch

Voting must go through the owner instead of directly mutating the proposal account. The owner must require the treasury not to be globally paused, require the proposal to be in its voting period, validate the vote enum, call the proposal account's `vote` method, approve the proposal account update, and emit `proposalVoteDispatched`. The owner may create a signed account update for the voter public key so votes from public keys outside the active L1 ledger can still be represented.

### Vote Tally Coordination

Tallying must happen at the owner level so both side-loaded proofs can be verified at the top-level transaction before the proposal account applies its tally rules. The owner must verify the vote reducer proof and staking-ledger-to-voting-ledger proof with the proposal zkApp's configured verification keys, require the cooldown window, prove the proposal account has seen each action state reported by the vote reducer, and delegate vote-result calculation to the proposal account.

The owner must emit `proposalVotesTallied` with the resulting vote weights and status, then approve the proposal account update. The proposal account owns the approval math and status mutation; the owner owns proof orchestration, action-state account-update approvals, and event emission.

### Execution and Pause Coordination

Execution must pay from the treasury owner balance only after the proposal account authorizes the payout. The owner must require global unpaused state, require the execution lifecycle window, subtract the payout from its own balance, call the proposal account's `execute`, emit `proposalExecuted`, and approve the proposal update. The proposal account must enforce recipient, status, remaining payout, and recipient account update details.

Proposal pause toggling must be coordinated across the pause controller and proposal account. The owner must ask the pause controller to authorize the toggle with multisig signatures and nonce, call the proposal account's pause toggle, emit `proposalPauseToggled`, and approve the proposal update. The `paused` argument emitted by the owner is informational; the proposal account performs a toggle rather than setting a target pause value from that argument. Global pause state and proposal-local pause state remain separate.

## Technical specification

### Constants and configuration


| Name                                    | Meaning                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `LIFECYCLE_PERIOD_DURATION = 7140`      | Mainnet-oriented duration for each proposal lifecycle period                     |
| `LifecyclePeriod.PROPOSAL = 0`          | Window for creating proposals                                                    |
| `LifecyclePeriod.EXPLORATION = 1`       | Reserved lifecycle period between creation and voting                            |
| `LifecyclePeriod.VOTING = 2`            | Window for dispatching votes                                                     |
| `LifecyclePeriod.COOLDOWN = 3`          | Earliest period after which tallying may occur                                   |
| `LifecyclePeriod.NUMBER_OF_PERIODS = 4` | Number of periods per lifecycle                                                  |
| `BOND_AMOUNT_DIVISOR = 10`              | Proposal bond divisor; proposal creation adds `amount / 10` to the owner balance |


### On-chain state

```ts
class TreasuryOwnerSmartContract extends TokenContract {
  @state(UInt32) treasuryDeployedAtSlot: State<UInt32>;
  @state(PublicKey) pauseControllerPublicKey: State<PublicKey>;
}
```

`treasuryDeployedAtSlot` anchors lifecycle windows. `pauseControllerPublicKey` binds global pause checks and proposal-pause authorization to a dedicated pause controller account.

### Account permissions

The owner account must use proof-authorized access and state edits, proof-authorized send/receive, proof-or-signature nonce increments, and an impossible verification-key update during the active protocol version. All proposal account updates under the owner's token id must be explicitly approved by the owner.

### Methods and authorization


| Method                                                              | Authorization and preconditions                                                                            | State / account-update effect                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy()`                                                          | Static deployment config                                                                                   | Sets permissions, deployment slot, and pause-controller public key                                                                           |
| `receive(amount)`                                                   | Proof-authorized owner call                                                                                | Adds funds to owner balance                                                                                                                  |
| `createProposal(proposalPublicKey, proposal, lifecycleId)`          | Sender signature, proposal lifecycle window, global unpaused state                                         | Creates signed proposal account update under owner token id, initializes proposal state, sets VK/URI, collects bond, emits `proposalCreated` |
| `vote(proposalPublicKey, publicKey, vote)`                          | Sender signature, voting lifecycle window, global unpaused state, valid vote enum                          | Dispatches proposal vote action, optionally creates voter account update, approves proposal, emits `proposalVoteDispatched`                  |
| `tallyVotes(proposalPublicKey, voteReducerProof, stakingLedgerToVotingLedgerProof, treasuryOwnerAccount, treasuryOwnerAccountWitness)` | Sender signature, global unpaused state, cooldown-or-later lifecycle, valid side-loaded proof verification | Verifies proofs, approves proposal action-state checks, calls proposal tally with treasury owner account and staking witness, emits `proposalVotesTallied`, approves proposal |
| `executeProposal(proposalPublicKey, recipient, amountToPayOut)`     | Sender signature, global unpaused state, next-lifecycle execution window                                                     | Subtracts owner balance, calls proposal execution, emits `proposalExecuted`, approves proposal                                               |
| `togglePauseProposal(proposalPublicKey, signatures, nonce, paused)` | Sender signature, pause-controller multisig authorization                                                                    | Calls proposal local pause toggle, emits informational `proposalPauseToggled`, approves proposal                                                           |
| `requireNotPaused()`                                                | Pause-controller state precondition                                                                        | Fails guarded flows while the global pause flag is set                                                                                       |


### Events


| Event                    | Payload                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `proposalCreated`        | Proposal public key, lifecycle id, amount, recipient, zkApp URI hash, staking epoch ledger hash, staking epoch total currency, proposer, sender |
| `proposalVoteDispatched` | Proposal public key, voter public key, vote enum, sender                                                                                        |
| `proposalVotesTallied`   | Proposal public key, lifecycle id, yay/nay/abstain weights, vote result, sender                                                                 |
| `proposalExecuted`       | Proposal public key, payout amount, sender                                                                                                      |
| `proposalPauseToggled`   | Proposal public key, informational pause flag supplied to the owner call, sender                                                                 |


### Errors


| Message                                                  | Meaning                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `No external account updates allowed for this token`     | A token account update outside the owner-approved proposal flow tried to use the owner token |
| `Action state not found in the merkle list`              | Tally coordination could not prove a reported action-state hash on the proposal account      |
| `Action state hash must not be the initial action state` | Tally coordination tried to approve an initial action-state hash as a real action state      |
| `Action state hashes must be unique`                     | Tally coordination received duplicate action-state hashes                                    |


## Acceptance criteria

- Deployment sets owner permissions, deployment slot, and pause-controller public key.
- Proposal creation initializes a proposal account under the owner's token id and emits `proposalCreated`.
- Proposal creation records staking epoch ledger hash and total currency from network preconditions.
- Voting is only dispatched during the voting lifecycle period and emits `proposalVoteDispatched`.
- Direct proposal-token account updates outside the owner-approved path are rejected.
- Tallying verifies both side-loaded proofs and approves distinct non-initial proposal action states before calling proposal tally.
- Executing an approved proposal requires a sender signature, subtracts the owner balance, and credits the intended recipient through proposal authorization.
- Proposal pause toggling requires sender signature and pause-controller multisig authorization, then leaves the actual proposal-local status transition on the proposal account.

## Design choices

### Token Owner as Coordinator

The treasury owner zkApp coordinates proposal accounts because it owns the treasury token namespace and treasury balance. This gives proposal accounts local state while requiring treasury-affecting state transitions to pass through the owner.

### Lifecycle Windows from Deployment Slot

Lifecycle periods are calculated from a deployment slot and fixed period duration. This avoids storing per-proposal schedule data on the owner while still making proposal, voting, cooldown, and execution windows circuit-checkable.

### Top-Level Proof Verification

Vote reducer and staking-ledger-to-voting-ledger proofs are verified in the owner before the proposal applies tally logic. This keeps recursive proof verification visible in the top-level transaction and lets the proposal focus on proposal-local acceptance rules.

## Invariants and constraints

- Proposal accounts must use the owner's derived token id.
- Owner-controlled flows must call the pause controller before normal treasury behavior proceeds.
- Lifecycle windows are determined by deployment slot, period duration, lifecycle id, and period index.
- Proposal action-state hashes approved during tally must be non-initial, found on the proposal account, and unique.
- Owner event payloads are the proposal lifecycle surface for off-chain indexer consumers.

## Related specs

- [Treasury proposal](treasury-proposal.md)
- [Vote reducer](vote-reducer.md)
- [Staking ledger → voting ledger](staking-ledger-to-voting-ledger.md)
- [Treasury pause controller](treasury-pause-controller.md)

