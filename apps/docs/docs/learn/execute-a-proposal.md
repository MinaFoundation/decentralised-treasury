---
title: Execute an Approved Proposal
sidebar_label: Execute a Proposal
sidebar_position: 8
audience: user
page_kind: procedure
---

Execution moves shared treasury funds to the proposal recipient.
An approval does not move funds automatically.

## When Execution Can Start

The proposal status must be `APPROVED`.
Execution starts from the beginning of the next lifecycle.

The treasury and the Proposal must not be paused.
The transaction recipient must match the recipient hash stored during creation.

The sender must fund a new Mina account when the recipient account does not exist.

## Maximum Execution Amount

The maximum total includes the requested amount and the bond.
It subtracts the amount already stored in `paidOutAmount`.

```text
bond = floor(requestedAmount / 10)

remainingAmount =
  requestedAmount + bond - paidOutAmount
```

The recipient can receive more than the request only by the bond component.
The recipient and bond payer can be different accounts.

## Partial Execution

An approved proposal can execute in parts.
Each successful transaction adds its amount to `paidOutAmount`.

The next transaction can execute up to the new `remainingAmount`.
No transaction can make the total exceed the request plus bond.

Enter an execution amount greater than zero.

## Shared Treasury Balance

:::warning Approval does not reserve funds

All bonds and treasury funds share the Treasury Owner balance.
An approved proposal does not reserve any part of that balance.

Transaction order and the available balance control which approved proposals can execute.

:::

The requested amount can be valid while the shared balance is too low.
In that case, select a smaller partial amount or wait for more funds.

The [CLI](./cli) defaults to the full remaining request plus bond.
Specify a smaller amount when the treasury cannot cover that default.

## Execute in the Web Application

The current web application enables execution only for the recorded proposal creator.
The smart contract itself accepts any valid signed sender.

1. Wait until the proposal is in a later lifecycle.
2. Open the approved proposal.
3. Connect the recorded proposal creator wallet.
4. Find the execution section.
5. Check the bond, `paidOutAmount`, and remaining amount.
6. Enter an amount that is greater than zero.
7. Select the available execution action.
8. Review the recipient, amount, and transaction fee.
9. Compile and prove the transaction.
10. Approve the wallet signature.
11. Wait for transaction inclusion.
12. Save the transaction hash.

Use the CLI when another account must submit a valid execution transaction.

## Reconcile the Execution

Check the recipient balance and Proposal `paidOutAmount` on the MINA network.
Then check the application execution history.

The application can update after the Mina state changes.
Wait for the indexer and processor before you treat a missing row as a failure.

:::info Emergency withdrawal is different

An enabled emergency Treasury Owner withdrawal is not Proposal execution. It
does not use Proposal approval, votes, the stored recipient, lifecycle rules,
or `paidOutAmount`. It also does not emit a `proposalExecuted` event.

:::

## Continue After Partial Execution

If `paidOutAmount` is below the maximum total, another valid partial execution
can occur later. Repeat the balance and Proposal state checks after every
included execution transaction.

Use [Verifiability and Trust](verifiability-and-trust.md) for the complete
reconciliation order. Read [Pause Behavior](pause-behavior.md) only when you
must understand an emergency state.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `executeProposal`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `execute`, `paidOutAmount`
- `packages/sdk/src/provable/contracts/treasury-constants.ts` — `BOND_AMOUNT_DIVISOR`
- `apps/cli/src/commands/proposal.ts` — `executeProposal`, `proposal execute`
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — web execution transaction flow
- `packages/ui/src/treasury/proposals/proposal-detail.tsx` — execution controls
