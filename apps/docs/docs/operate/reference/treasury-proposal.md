---
title: Treasury Proposal
sidebar_label: Treasury Proposal
sidebar_position: 5
audience: operator
page_kind: reference
---

# Treasury Proposal

## Intent

`TreasuryProposalSmartContract` stores one proposal. It collects vote actions, records the tally result, and tracks execution.

## Place in the system

The Proposal is an Owner token account. `TreasuryOwnerSmartContract.createProposal` creates it.

The Owner coordinates every public transition. The Proposal performs proposal-specific proof, status, recipient, and amount checks.

## Actors

| Actor | Action |
| --- | --- |
| Owner contract | Calls Proposal methods and approves the token account update. |
| Voter | Supplies a signed vote action through the Owner. |
| Prover | Produces the staking and vote proofs. |
| Fee payer | Pays for the submitted transaction. |
| Transaction sender | Authorizes the coordinated Owner method. |
| Recipient | Receives partial or complete execution. |
| Break-glass signers | Authorize a local pause toggle through the Owner. |

## State and proof inputs

| Name | Type | Purpose |
| --- | --- | --- |
| `recipientHash` | `Field` | Commits to the recipient public key. |
| `amount` | `UInt64` | Stores the requested amount. |
| `lifecycleId` | `UInt32` | Selects lifecycle windows. |
| `stakingEpochDataLedgerHash` | `Field` | Stores the creation-time staking root. |
| `stakingEpochDataLedgerTotalCurrency` | `UInt64` | Stores creation-time staking total currency. |
| `status` | `ProposalStatus` | Stores `UNKNOWN`, `APPROVED`, `REJECTED`, or `PAUSED`. |
| `paidOutAmount` | `UInt64` | Stores cumulative execution. |

Static compile inputs are `voteReducerVerificationKey`, `stakingLedgerToVotingLedgerVerificationKey`, `emptyNullifierRoot`, and `emptyVotingLedgerRoot`.

These values are compile-time values. They are not mutable Proposal state.

## Methods

| Method | Main effect |
| --- | --- |
| `requireNotPaused` | Rejects status `PAUSED`. |
| `getLifecycleId` | Returns the stored lifecycle ID. |
| `vote` | Dispatches a `VoteAction`. |
| `minUInt128` | Returns the smaller of two values. |
| `calculateAcceptanceCriteria` | Calculates participation and approval thresholds. |
| `calculateApprovalStatus` | Calculates tally values and a candidate status. |
| `tallyVotes` | Verifies proof bindings and stores the final status. |
| `execute` | Checks the recipient and cap, then increases `paidOutAmount`. |
| `togglePause` | Changes non-paused status to `PAUSED`, or `PAUSED` to `UNKNOWN`. |

## Authorization

Proposal state edits use the Proposal account authorization in the Owner transaction. Normal configured operation uses a Proposal proof.

Every submitted transaction also needs a fee-payer signature. Owner methods can require a separate sender signature.

`tallyVotes` also verifies both side-loaded proofs. `execute` approves an unsigned credit account update for the committed recipient.

The Owner approves the Proposal account update under the derived token.

Creation installs o1js default permissions. State edits, sends, and action edits require proofs. Receives and access need no authorization.

Delegate, permission, verification-key, URI, token-symbol, nonce, voting, and timing changes require signatures.

## Lifecycle and state conditions

The Owner enforces lifecycle conditions before it calls the Proposal.

| Method | Owner lifecycle condition | Proposal state condition |
| --- | --- | --- |
| `vote` | Voting period | Status is not `PAUSED`. |
| `tallyVotes` | Cooldown or later | Status is `UNKNOWN`. |
| `execute` | Lifecycle `L + 1` or later | Status is `APPROVED`. |
| `togglePause` | None | No status restriction. |

## Business logic

### Tally proof bindings

`tallyVotes` requires:

- vote reduction from `Reducer.initialActionState`;
- vote reduction from `emptyNullifierRoot`;
- the vote proof root to equal the staking proof output root;
- staking transformation from index `0`;
- staking transformation from `emptyVotingLedgerRoot`;
- the staking input root to equal `stakingEpochDataLedgerHash`;
- `exhausted = true`;
- the final vote action hash to equal the first action-state target;
- the Treasury Owner default-token account under the same staking root.

The Owner adds another condition. Exactly five targets must be found, non-initial, unique, and present in Proposal account history.

This condition can prevent tally after one high-weight voter action.

### Tally outcomes

`calculateApprovalStatus` can calculate `REJECTED` for low participation. However, `tallyVotes` rejects that transaction before it stores status.

| Conditions | Stored result |
| --- | --- |
| Participation passes and approval passes | `APPROVED` |
| Participation passes and approval fails | `REJECTED` |
| Participation fails | No transition; status stays `UNKNOWN` |
| `yay + nay = 0` | No transition; status stays `UNKNOWN` |

`abstain` counts for participation. It does not count for approval.

### Execution

The total execution cap is:

~~~text
amountWithBond = amount + floor(amount / BOND_AMOUNT_DIVISOR)
remainingAmount = amountWithBond - paidOutAmount
~~~

`execute` requires `amountToPayOut <= remainingAmount`. It then credits the committed recipient and increases `paidOutAmount`.

The supported workflow uses a positive value. Execution can be partial and repeated. The status stays `APPROVED`.

### Local pause

:::danger Status loss

`togglePause` changes `APPROVED` or `REJECTED` to `PAUSED`. A second toggle changes `PAUSED` to `UNKNOWN`.

Do not use the event `paused` field as the state authority. Reconcile the Proposal account.

:::

## Constants

| Identifier | Value |
| --- | --- |
| `ProposalStatus.UNKNOWN` | `0` |
| `ProposalStatus.APPROVED` | `1` |
| `ProposalStatus.REJECTED` | `2` |
| `ProposalStatus.PAUSED` | `3` |
| `BOND_AMOUNT_DIVISOR` | `10` |
| `BASIS_POINTS` | `10000` |

See [Constants and acceptance math](./constants-and-acceptance) for all acceptance constants.

## Events

The Proposal does not emit Owner-level events directly. The Owner emits the five protocol events after coordinated calls.

The Proposal reducer dispatches `VoteAction` actions. These actions are not the Owner event stream.

## Invariants

- A successful tally starts from `UNKNOWN`.
- A successful tally stores `APPROVED` or `REJECTED`.
- Both proof programs refer to the same voting ledger root.
- The staking proof refers to the recorded staking root.
- The historical Owner balance is proven under that same root.
- `paidOutAmount` never decreases.
- `paidOutAmount` cannot exceed the requested amount plus its bond.
- Execution uses the recipient committed by `recipientHash`.

## Errors

| Message | Cause |
| --- | --- |
| `Proposal is paused` | Status is `PAUSED`. |
| `Vote result already set` | Status is not `UNKNOWN`. |
| `fromActionsHash should be the initial action state` | Vote proof starts from another action hash. |
| `fromNullifierRoot does not match` | Vote proof starts from another nullifier root. |
| `voting ledger root does not match` | The two proofs use different voting roots. |
| `staking ledger transformation must start at index 0` | Staking proof starts at another index. |
| `initial voting ledger root must be empty` | Staking proof starts from another voting root. |
| `staking ledger root does not match` | Staking proof uses another staking root. |
| `staking ledger to voting ledger proof did not exhaust` | The proof has no successful `exhaust` step. |
| `toActionsHash does not match action state one hash` | Vote proof output does not match the first target. |
| `Treasury owner account public key does not match` | The historical account has another public key. |
| `Treasury owner account token id does not match` | The historical account is not a default-token account. |
| `Treasury owner account witness does not match staking ledger hash` | The account witness uses another staking root. |
| `Participation not met` | Participating weight is below the threshold. |
| `No approval votes cast` | `yay + nay` is zero. |
| `Proposal not approved` | Execution status is not `APPROVED`. |
| `Amount to pay out is greater than the remaining amount to pay out` | Execution exceeds the remaining cap. |
| `Recipient hash does not match on chain state` | The supplied recipient does not match `recipientHash`. |

## CLI and UI operations

See the [CLI command index](./cli-commands) for options and signing inputs.

- `proposal read-state` reads all Proposal state fields.
- `proposal vote` dispatches a vote.
- `proposal tally-votes` supplies both side-loaded proofs.
- `proposal execute` executes a partial or complete remaining amount.
- `pause-controller toggle-pause-proposal` calls `togglePause` through the Owner.
- The web application builds vote and execution transactions.

## Sources

- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-constants.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `apps/cli/src/commands/proposal.ts`
- `packages/sdk/test/provable/contracts/treasury-proposal/treasury-proposal.test.ts`
