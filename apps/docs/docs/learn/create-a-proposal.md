---
title: Create a Proposal
sidebar_label: Create a Proposal
sidebar_position: 5
audience: user
page_kind: procedure
---

A proposal tells the community what you want to fund, how much it needs, and
which account will receive the funds. You can submit it only during the
Proposal period for its lifecycle.

## Before You Start

Before you open the form, prepare these items:

- a short title;
- Markdown content that explains the request;
- the recipient public key;
- the requested amount;
- enough MINA for the bond, transaction fee, and account-creation costs;
- a wallet that can sign for the sender.

The treasury must not be globally paused.
Enter a proposal request greater than zero.

Before creation, confirm that the recorded staking ledger is available.
It must contain the default-token Treasury Owner account with a nonzero balance.
Without this account and balance, a later tally cannot succeed.

## Understand the Bond

The bond divisor is `10`.
The transaction calculates the bond in nanomina with integer division.

```text
bond = floor(requestedAmount / 10)
```

The bond is approximately ten percent of the requested amount.
It enters the shared Treasury Owner balance during creation.

The system does not create a separate bond account.
It does not provide a bond refund method.

A rejected or unresolved proposal leaves its bond in the shared treasury balance.
The recipient can receive the bond component if the proposal is approved and executed.

## Write the Content

The content must be non-empty Markdown.
The default application limit is `32768` characters.

The App API rejects content that exceeds the limit.
It also rejects content that fails its explicit-language check.

Use the first level-one heading as the proposal title.
Describe the purpose, requested amount, delivery plan, and expected result.

## Content Commitment and Upload

Creation uses this sequence:

1. The [CLI](./cli) or web application hashes the Markdown into a content URN.
2. The creation transaction commits the derived `zkAppUri` hash on-chain.
3. The transaction creates the Proposal account under the Treasury Owner token.
4. The CLI or web application waits for transaction inclusion.
5. It sends the Markdown to the App API.
6. The API calculates the hash again.
7. The API stores the Markdown only when the proposal key and hash match.

The API stores matching content in the Postgres proposal projection.
This storage is not permanent public storage.

:::warning Content upload can fail after creation

An upload failure does not reverse the on-chain proposal creation.
The web application saves a local retry record and can retry from the proposal page.

:::

## Create in the Web Application

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro) to prepare the wallet and check each
approval.

1. Open **Proposals**.
2. Select **Create proposal**.
3. Connect the proposer wallet.
4. Enter the title, requested amount, recipient, and Markdown content.
5. Review the derived bond and voting requirement estimate.
6. Select **Create proposal**.
7. Review the transaction summary.
8. Select **Create proposal transaction**.
9. The application compiles and proves the transaction automatically.
10. Approve the wallet signature.
11. The application submits the signed transaction.
12. Wait for inclusion and content upload.
13. Save the proposal address and transaction hash.

The transaction summary does not show all zkApp account updates.

Outside the Proposal period, the web application saves the proposal as a draft.
It does not submit a creation transaction.

## Check the Result

Open the new proposal page.
Check the recipient, requested amount, bond, lifecycle, content hash, and staking-ledger hash.
Confirm that the recorded staking-ledger file is available to the operator.

Keep the transaction hash.
For a material decision, check the Proposal account state on the Mina network.

## Next Step

Use the Exploration period to review the stored content, recipient, amount,
bond, and staking snapshot. Then follow [Vote](vote.md) during the Voting
period.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `createProposal`, `snapshotStakingEpochData`
- `packages/sdk/src/provable/contracts/treasury-constants.ts` — `BOND_AMOUNT_DIVISOR`
- `packages/sdk/src/utils/proposal-content-hash.ts` — `hashMarkdownContentToZkappUri`
- `apps/api/src/proposal-content-routes.ts` — `DEFAULT_PROPOSAL_CONTENT_MAX_CHARS`, `createProposalContentRoutes`
- `apps/web/features/proposals/containers/proposal-create-page-container.tsx` — `ProposalCreatePageContainer`
- `apps/web/features/proposals/lib/proposal-content-retry-store.ts` — proposal content retry records
