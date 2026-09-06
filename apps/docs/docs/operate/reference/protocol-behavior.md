---
title: Protocol Behavior
sidebar_label: Protocol behavior
sidebar_position: 2
audience: operator
page_kind: reference
---

# Protocol behavior

The treasury stores MINA in one `TreasuryOwnerSmartContract` account. Each proposal is a token account under the Owner token.

## Lifecycle

Let:

- `S` be `treasuryDeployedAtSlot`.
- `D` be `lifecyclePeriodDuration`.
- `L` be `lifecycleId`.

The contract calculates these slots:

~~~text
proposal start    = S + 4 × D × L
exploration start = proposal start + D
voting start      = proposal start + 2 × D
cooldown start    = proposal start + 3 × D
next lifecycle    = proposal start + 4 × D
~~~

The default `LIFECYCLE_PERIOD_DURATION` is `7140` slots. One lifecycle has four equal periods.

| Operation | Earliest period | Upper time limit in this protocol |
| --- | --- | --- |
| `createProposal` | Proposal period | Exploration start slot, inclusive |
| `vote` | Voting period | Cooldown start slot, inclusive |
| `tallyVotes` | Cooldown period | No lifecycle upper bound |
| `executeProposal` | Proposal period of lifecycle `L + 1` | No lifecycle upper bound |

The pinned o1js `requireBetween` precondition includes both range limits. The contract sets each bounded upper limit to `period start + D`. Proposal and Exploration therefore share one boundary slot. Voting and Cooldown also share one boundary slot. Submit bounded operations before a shared boundary slot when possible.

Epoch alignment is an Operator configuration invariant. The contract does not check it.

The supported scheduler configuration uses these rules:

~~~text
D = one Mina epoch
S = the first slot of a Mina epoch
deployedEpoch = floor(S / D)
snapshotEpoch = deployedEpoch + 4 × L
~~~

A future `S` delays all lifecycle operations. A past `S` selects a later period and can require historical snapshot data.

## Proposal creation

The Operator or a user supplies a proposal key, amount, recipient, content commitment, and lifecycle ID.

`TreasuryOwnerSmartContract.createProposal` creates the Proposal account. The Proposal is not deployed with a separate deployment command.

Creation records these values from the transaction network state:

- `stakingEpochData.ledger.hash`
- `stakingEpochData.ledger.totalCurrency`

The contract does not derive the staking snapshot epoch from `lifecycleId`.

Before creation, preserve the exact ledger for the recorded root. Confirm that it contains the default-token Owner account with a nonzero balance.

Creation does not check these conditions. A missing ledger, missing account, wrong token, or zero balance prevents a later tally.

The bond is:

~~~text
bond = floor(requestedAmount / BOND_AMOUNT_DIVISOR)
BOND_AMOUNT_DIVISOR = 10
~~~

Current [CLI](./cli-commands) and web builders use the sender as bond payer. A manual transaction can use another signed bond payer.

The Owner requires the sender signature. A different bond payer needs another signature; its signature does not replace the sender signature.

The supported web and operator workflows require a positive request.

The bond enters the shared Treasury Owner balance. The protocol has no bond account, bond reservation, refund method, or separate bond record.

## Voting

`TreasuryOwnerSmartContract.vote` requires the voting period and the global unpaused state. It calls `TreasuryProposalSmartContract.vote`.

The Proposal dispatches a `VoteAction`. The action contains the voter public key and `Vote.YAY`, `Vote.NAY`, or `Vote.ABSTRAIN`.

The transaction requires the voter signature. The transaction sender can be a different account.

## Proof preparation

`StakingLedgerToVotingLedger` converts the recorded Mina staking ledger into delegate voting weights. It aggregates default-token balances by delegate.

`VoteReducer` reads those weights and reduces Proposal actions. A nullifier root makes only the first action for a voter add weight.

The two proofs establish the business relations in their circuits. They do more than protect an off-chain storage boundary.

## Tally

Tally starts in cooldown and remains available later. The transaction supplies both side-loaded proofs and a staking-ledger witness for the Treasury Owner account.

The Proposal binds:

- the staking proof input root to its recorded staking root;
- the staking proof output root to the vote proof voting root;
- both proof chains to configured empty roots;
- the vote proof action states to Proposal account action states;
- the Treasury Owner balance to the same recorded staking root.

The Owner also checks exactly five target action-state hashes. They must be found, non-initial, unique, and present in Proposal account history.

This condition can block tally when only one high-weight voter submitted an action.

Tally has three distinct outcomes:

| Conditions | Transaction result | Proposal status |
| --- | --- | --- |
| Participation is sufficient, `yay + nay > 0`, and approval passes | Success | `APPROVED` |
| Participation is sufficient, `yay + nay > 0`, and approval fails | Success | `REJECTED` |
| Participation is insufficient | Failure | `UNKNOWN` |
| Votes are abstain-only | Failure | `UNKNOWN` |

An Operator can skip proof generation when no useful transition can succeed. The Proposal then stays `UNKNOWN`.

## Execution and shared balance

Execution starts in lifecycle `L + 1`. Any signed Owner-method sender can authorize execution when all checks pass.

The same account can pay the fee. A different fee payer does not replace the Owner-method sender signature.

The committed recipient can receive this total:

~~~text
requestedAmount + bond - paidOutAmount
~~~

Execution can be partial and repeated. The CLI defaults to the complete remaining amount, including the bond.

The supported execution workflow uses a positive amount.

:::warning Shared treasury balance

Approval does not reserve funds. Transaction order and the available Owner balance control which approved proposal can execute.

If the Owner balance is too low, select a smaller execution amount.

:::

The recipient and bond payer can be different accounts. A rejected or unresolved proposal leaves its bond in the shared balance.

## Pause behavior

The global pause blocks creation, voting, tally, and execution. It does not block proposal pause toggles.

Proposal pause is encoded in `ProposalStatus`. It is not a separate Boolean field.

~~~text
any non-PAUSED status -> PAUSED
PAUSED status         -> UNKNOWN
~~~

:::danger Final result can be erased

A proposal pause toggle can replace `APPROVED` or `REJECTED` with `PAUSED`. The next toggle sets the status to `UNKNOWN`.

Reconcile the Proposal account after each toggle.

:::

The caller supplies the `paused` value in `proposalPauseToggled`. The contract does not bind this value to the new state.

## Verification-key configuration

Use this compile order:

1. Compile `VoteReducer`.
2. Compile `StakingLedgerToVotingLedger`.
3. Configure both keys and the empty roots on `TreasuryProposalSmartContract`.
4. Compile `TreasuryProposalSmartContract`. Compilation populates `TreasuryProposalSmartContract._verificationKey`.
5. Keep that populated static cache available when the Owner creates a Proposal.
6. Compile `TreasuryPauseControllerSmartContract`.
7. Compile `TreasuryOwnerSmartContract` with the same configuration.
8. Copy the complete emitted `browserEnv` values to the web and backoffice environments.

The verification keys and empty roots are compile-time values. They are not mutable Proposal state.

`createProposal` reads `TreasuryProposalSmartContract._verificationKey`. It does not read `TreasuryOwnerSmartContract.proposalContractVerificationKey`.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
