---
title: Vote
sidebar_label: Vote
sidebar_position: 6
audience: user
page_kind: procedure
---

Voting is simple to submit, but its weight comes from the staking snapshot that
the proposal recorded earlier. During the Voting period, you can vote `yay`,
`nay`, or `abstain`. Each choice requires the voter signature.

## Voting Weight

Voting weight comes from the staking ledger recorded when the proposal was created.
The proof process groups default-token stake by delegate public key.

A voter key has weight when it is a delegate key in the selected voting ledger.
The web application shows the connected wallet's available voting weight.

Later staking or delegation changes do not change this recorded snapshot.
They can affect a later lifecycle that records a different snapshot.

## Diagnose Missing Voting Weight

First confirm the [deployment](check-your-deployment.md), Proposal lifecycle, and connected public key.
Open the following App API paths in a browser. Prefix each path with the App API base URL from the deployment record.
Replace `<L>` with the Proposal lifecycle and `<KEY>` with your wallet public key.

```text
/staking-ledger/lifecycles/<L>/accounts/<KEY>
/voting-ledger/lifecycles/<L>/accounts/<KEY>
```

The staking response contains `delegatePublicKey` and the historical account `balance`.
The voting response contains `voteWeight`, in nanomina.
These API responses describe local ledger data. Ask the operator to confirm that its root matches the Proposal snapshot.

| Result                                        | Meaning and next action                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Positive `voteWeight`                         | This key has weight in the available ledger. Check timing and pause state if voting remains unavailable.            |
| `voteWeight` is `"0"`                         | This key has no counted stake in that ledger. Inspect the historical delegate and confirm the connected key.        |
| Staking account is absent                     | The key is absent from that staking snapshot. Check its voting entry separately; another holder can delegate to it. |
| HTTP `404` says lifecycle data is unavailable | This is missing service data, not proof of zero weight. Ask the operator to prepare the matching ledger.            |
| HTTP `400`, `500`, or a connection failure    | Correct the key or lifecycle input, or report the service error. Do not infer voting eligibility.                   |

For example, Alice delegates `100` MINA to Bob. Bob also has `40` MINA delegated to his own key.
If these are the only eligible balances in the example, Bob has `140` MINA of voting weight.
Alice's key has zero voting weight. Connecting Alice's funded wallet does not let her cast Bob's weighted vote.

A current delegation change does not alter an existing Proposal snapshot.
To prepare for a future Proposal, select the intended delegation in your wallet and verify it in the later recorded staking ledger.
Wait for the matching voting ledger before expecting the application to show that weight.
The docs do not promise a fixed activation date for a delegation change.

Send the operator the Proposal address, lifecycle, wallet public key, endpoint, and error when data is unavailable.
Use the support contact obtained with the deployment record. Never send a private key.

## Vote Choices

- `yay` supports the proposal.
- `nay` opposes the proposal.
- `abstain` adds weight to participation without adding approval or opposition weight.

The first counted vote from a voter key uses that key's weight.
Later votes from the same key do not add voting weight.

## Before You Vote

Check these conditions:

- The proposal is in the Voting period.
- The treasury is not globally paused.
- The proposal is not `PAUSED`.
- The connected wallet is the voter key.
- The voter account exists on the Mina network.
- The fee payer has enough MINA for the transaction fee.
- You independently matched the exact Markdown to the Proposal account `zkappUri`.
- The recipient and amount are correct.

## Verify the Proposal Content

The App API hashes submitted Markdown and compares it with the processor projection.
The web application marks available stored content as verified by this projection check.
It does not query the Proposal account for an independent content check.

Complete [Verify a proposal](verify-a-proposal.md) before a material vote.
It supplies tool setup, exact Markdown download, Base58 token derivation,
direct Mina queries, expected output, and failure handling.
Do not vote when the content differs or the Mina query fails.

## Vote in the Web Application

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro) to prepare the wallet and check each
approval.

1. Connect the voter wallet.
2. Open the proposal.
3. Read the proposal content and details.
4. Find the **Voting** section.
5. Select **Yay**, **Nay**, or **Abstain**.
6. Review the vote and fee.
7. Select **Cast vote transaction**.
8. The application compiles and proves the transaction automatically.
9. Approve the wallet signature.
10. The application submits the signed transaction.
11. Wait for transaction inclusion.
12. Save the transaction hash.

The transaction summary does not show all zkApp account updates.

The web application blocks its vote buttons when the connected wallet has zero displayed weight.
The contract can still receive a signed action from a zero-weight key.

## After You Vote

The application can take time to show a new vote.
The indexer and processor must first read and project the event.

A visible vote event is not the final result.
The operator must reduce the actions and submit the tally after voting ends.

## Next Step

Wait for the operator to submit a successful tally. Then follow
[Results and Acceptance](results-and-acceptance.md). Do not execute a proposal
only because its votes appear sufficient.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `vote`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `vote`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts` — `Vote`, `VoteAction`, `VoteReducer`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts` — delegate-based voting accounts
- `packages/sdk/src/utils/proposal-content-hash.ts` — Markdown commitment format
- `apps/api/src/proposal-content-routes.ts` — projection-based content check
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — web vote transaction flow
- `packages/ui/src/treasury/proposals/proposal-detail.tsx` — vote controls and displayed voting weight
