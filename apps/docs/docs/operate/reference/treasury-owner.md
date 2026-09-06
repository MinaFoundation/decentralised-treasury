---
title: Treasury Owner
sidebar_label: Treasury Owner
sidebar_position: 4
audience: operator
page_kind: reference
---

# Treasury Owner

## Intent

`TreasuryOwnerSmartContract` holds the shared MINA balance. It coordinates
every proposal state transition. Its deployment can enable a direct emergency
withdrawal path.

## Place in the system

The contract extends `TokenContract`. Each Proposal is an account under the Owner-derived token.

The Owner approves Proposal account updates. It also calls the Pause Controller for global and proposal pause checks.

## Actors

| Actor                        | Action                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| Fee payer                    | Pays the transaction fee.                                       |
| Transaction sender           | Authorizes sender-bound Owner methods.                          |
| Funding account              | Supplies MINA to `receive`.                                     |
| Bond payer                   | Supplies the proposal bond during creation.                     |
| Proposal account key         | Authorizes creation of the Proposal token account.              |
| Voter                        | Signs the vote account update.                                  |
| Break-glass signers          | Authorize a proposal pause toggle through the Pause Controller. |
| Treasury Owner key custodian | Authorizes a direct emergency withdrawal from an enabled Owner. |
| Recipient                    | Receives an approved execution amount.                          |

Any user can submit create, tally, or execute when all inputs and conditions are valid. Voting also requires the voter signature.

## State and compile inputs

| Name                                             | Type                    | Purpose                                                    |
| ------------------------------------------------ | ----------------------- | ---------------------------------------------------------- |
| `treasuryDeployedAtSlot`                         | `UInt32` state          | Anchors every lifecycle.                                   |
| `pauseControllerPublicKey`                       | `PublicKey` state       | Selects the Pause Controller.                              |
| `lifecyclePeriodDuration`                        | Static compile input    | Sets period length.                                        |
| `TreasuryProposalSmartContract._verificationKey` | Proposal compile result | Supplies the key installed during Proposal creation.       |
| `proposalContractVerificationKey`                | Compatibility cache     | Runtimes assign it, but `createProposal` does not read it. |

`deploy` sets both state fields and uses `proof` for `access` and `send`.
`deployWithWithdrawalPermission` sets the same state fields and accepts
`proof` or `proofOrSignature`. The selected permissions apply to `access` and
`send`.

## Methods

| Method                                     | Main effect                                                          |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `snapshotStakingEpochData`                 | Reads the staking ledger hash and total currency from network state. |
| `deploy`                                   | Sets permissions, lifecycle start slot, and Pause Controller key.    |
| `deployWithWithdrawalPermission`           | Deploys with an explicit Owner withdrawal permission.                |
| `getLifecyclePeriodSlotRange`              | Calculates the slot range for one period.                            |
| `requireLifecyclePeriod`                   | Adds a Mina global-slot precondition.                                |
| `requireLifecyclePeriodGreaterThanOrEqual` | Adds a lower-bounded period precondition.                            |
| `receive`                                  | Adds an amount to the Owner balance.                                 |
| `createProposal`                           | Creates and initializes one Proposal account.                        |
| `vote`                                     | Sends a signed vote action to a Proposal.                            |
| `tallyVotes`                               | Checks proof and action-state bindings, then calls Proposal tally.   |
| `executeProposal`                          | Debits the Owner and calls Proposal execution.                       |
| `togglePauseProposal`                      | Checks break-glass authorization and toggles Proposal status.        |
| `requireNotPaused`                         | Calls the Pause Controller global-pause check.                       |
| `approveBase`                              | Rejects external updates that use the Owner token.                   |

## Authorization

The contract uses proof authorization for state edits and receive. The
deployment selects proof-only or proof-or-signature authorization for access
and send. Nonce increments allow a proof or the Treasury Owner signature.

`setVerificationKey` is impossible during the current protocol version. All other permission fields are impossible.

Every submitted transaction needs a fee-payer signature.

`createProposal` requires the transaction sender and Proposal account
signatures. The CLI accepts an optional Proposal private key. Otherwise, it
generates the keypair in memory, adds its signature, and discards the private
key after deployment. This key cannot authorize later Proposal control.
Proposal state uses proof authorization, and its custom-token account updates
require Treasury Owner approval. A different bond payer needs an additional
signature.

`vote` requires a sender signature and a voter signature. The two public keys can be different.

`tallyVotes` and `executeProposal` require a sender signature. The sender does not need a special governance role.

`togglePauseProposal` requires a sender signature and all three contract proofs. It also requires the embedded break-glass signature threshold.

See the [authorization matrix](./authorization-matrix) for each authorization type.

### Direct signature authorization

In `proofOrSignature` mode, the `access` and `send` permissions let the Treasury
Owner key authorize a direct MINA debit. This is an account permission. It is
not a public smart-contract method.

The emergency command rejects Owners deployed with `proof` mode. The mode
cannot change after deployment because `setPermissions` is impossible. The
selection is permanent for the Owner address.

The direct signature path does not prove normal governance conditions. It does not check a Proposal, lifecycle, recipient commitment, payout cap, or global pause. It cannot edit Owner state or change Owner permissions.

:::danger Single-key withdrawal authority

In `proofOrSignature` mode, the Treasury Owner key can debit the complete
available Owner balance. Keep this key as an offline emergency asset. Prefer
the supported Ledger signing path.

The Pause Controller 3-of-5 signatures do not authorize this debit on the MINA network. If policy requires several people to approve it, apply that policy in the Treasury Owner signing custody system.

:::

## Lifecycle and state conditions

| Method                | Lifecycle condition                      | State condition                                              |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `receive`             | None                                     | Owner account exists.                                        |
| `createProposal`      | Proposal period for `lifecycleId`        | Treasury is not paused.                                      |
| `vote`                | Voting period for the Proposal lifecycle | Treasury and Proposal are not paused.                        |
| `tallyVotes`          | Cooldown or later                        | Treasury and Proposal are not paused; Proposal is `UNKNOWN`. |
| `executeProposal`     | Lifecycle `L + 1` or later               | Treasury is not paused; Proposal is `APPROVED`.              |
| `togglePauseProposal` | None                                     | Break-glass nonce and signatures are valid.                  |

## Business logic

### Creation

`createProposal` calculates `floor(proposal.amount / 10)`. It adds that bond to the Owner balance.

The supported creation workflow uses a positive requested amount.

The method creates the Proposal account with `AccountUpdate.createSigned`. It initializes the first six app-state fields and installs the Proposal verification key.

The method records `stakingEpochData` from the transaction network state. It does not calculate the snapshot epoch from the lifecycle ID.

Before creation, preserve the exact recorded staking ledger. It must contain the default-token Owner account with a nonzero balance.

Creation does not check these conditions. Tally later needs the account witness and divides by that historical balance.

### Tally coordination

The Owner verifies `SideLoadedVoteReducerProof` and `SideLoadedStakingLedgerToVotingLedgerProof`. The Proposal verifies the same proofs again.

The Owner checks five action-state records. Each hash must be found, non-initial, unique, and present in Proposal account state.

A high-weight voter does not remove this five-hash condition. Tally cannot succeed until all five historical targets exist and match.

### Execution

`executeProposal` subtracts `amountToPayOut` from the shared Owner balance. The Proposal checks the recipient and remaining cap.

The supported execution workflow uses a positive amount.

:::warning No reservation

An approved Proposal does not reserve funds. A valid execution can fail when another transaction used the shared balance first.

:::

### Emergency withdrawal

The CLI creates a signed default-token AccountUpdate for the Treasury Owner. It sends the selected MINA amount to the selected recipient. It does not call `executeProposal`.

The normal execution invariants apply only to `executeProposal`. An emergency withdrawal does not update Proposal `paidOutAmount`. It can reduce funds that remain available for approved Proposals and proposal bonds.

Use the [break-glass procedure](../break-glass/index.md#emergency-fund-withdrawal) for the required pause, review, submission, and reconciliation steps.

## Constants

| Identifier                          | Value  | Use                          |
| ----------------------------------- | ------ | ---------------------------- |
| `LIFECYCLE_PERIOD_DURATION`         | `7140` | Default slots in one period. |
| `LifecyclePeriod.PROPOSAL`          | `0`    | Proposal creation period.    |
| `LifecyclePeriod.EXPLORATION`       | `1`    | Exploration period.          |
| `LifecyclePeriod.VOTING`            | `2`    | Voting period.               |
| `LifecyclePeriod.COOLDOWN`          | `3`    | Cooldown period.             |
| `LifecyclePeriod.NUMBER_OF_PERIODS` | `4`    | Periods in one lifecycle.    |
| `BOND_AMOUNT_DIVISOR`               | `10`   | Proposal bond divisor.       |

## Events

The Owner emits:

- `proposalCreated`
- `proposalVoteDispatched`
- `proposalVotesTallied`
- `proposalExecuted`
- `proposalPauseToggled`

See [Events](./events) for the payload fields.

A direct emergency withdrawal emits no Treasury Owner event. Reconcile the transaction and affected Mina accounts directly.

## Invariants

- Only the Owner can approve updates that use its derived token.
- Creation stores `TreasuryProposalSmartContract._verificationKey`, which Proposal compilation populates.
- Voting uses the lifecycle ID stored by the Proposal.
- Tally starts from configured empty voting and nullifier roots.
- Execution starts no earlier than lifecycle `L + 1`.
- Execution cannot select a recipient other than the Proposal commitment.

## Errors

| Message                                                  | Cause                                          |
| -------------------------------------------------------- | ---------------------------------------------- |
| `Action state not found in the merkle list`              | A target action-state hash was not found.      |
| `Action state hash must not be the initial action state` | A target uses the reducer initial state.       |
| `Action state hashes must be unique`                     | Two target action states are equal.            |
| `No external account updates allowed for this token`     | An external child update uses the Owner token. |

Lifecycle, signature, balance, and child-contract checks can add other transaction failures.

## CLI and UI operations

See the [CLI command index](./cli-commands) for options and signing inputs.

- `treasury-owner compile` compiles the Owner and all proof dependencies.
- `treasury-owner deploy` deploys the Pause Controller and Owner.
- `treasury-owner fund-treasury` calls `receive`.
- `treasury-owner emergency-withdraw` creates a direct signed Owner AccountUpdate. It does not compile or prove.
- `treasury-owner read-state` reads Owner state and lifecycle data.
- `proposal create`, `proposal vote`, `proposal tally-votes`, and `proposal execute` call Owner methods.
- The web application builds create, vote, and execute transactions.
- The web application does not expose emergency withdrawal.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-constants.ts`
- `packages/sdk/src/provable/events/treasury-proposal-events.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/commands/proposal.ts`
- `packages/sdk/test/integration/treasury-owner.test.ts`
