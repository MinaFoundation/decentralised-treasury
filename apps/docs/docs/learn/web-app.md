---
title: Use the Web Application
sidebar_label: Web Application
sidebar_position: 9
audience: user
page_kind: procedure
---

The web application is the main user interface.
It shows the treasury, lifecycles, proposals, votes, results, and execution history.

## Open the Application

Use the URL supplied by the operator.
Confirm that the operator configured the expected Mina network and Treasury Owner address.

The header shows the treasury balance and current lifecycle period.
The application refreshes data when it detects new Mina blocks.

## Connect a Wallet

1. Select **Connect wallet**.
2. Select **Auro** or **Ledger**.
3. Complete the wallet-specific steps.

For Auro, the application uses the account that is selected in Auro.
Approve each transaction in the Auro extension.

For Ledger, enter the Mina account index.
Open the Mina app and confirm the derived address on the device.

Ledger needs WebHID in a secure Chromium browser context.
The application remembers the Ledger address and account index for later sessions.

## Browse and Search

Open **Proposals** to view the proposal table.
Use its filters and page controls to find a proposal.

Select a proposal to view these details:

- content and content-check status;
- lifecycle and status;
- creator, recipient, request, and bond;
- staking-ledger hash;
- participation and approval values;
- votes and execution history.

## Create a Proposal

Follow [Create a Proposal](create-a-proposal.md) for the complete procedure.

The application uploads the Markdown after transaction inclusion.
If the upload fails, use **Retry content upload** on the proposal page.

Outside the Proposal period, select **Save as draft**.
Submit the saved draft during a later Proposal period.

## Vote

Follow [Vote](vote.md) for the complete procedure.

The application disables voting before the Voting period.
It also disables voting for a paused proposal or a wallet with zero displayed weight.

## Read the Result

Open the **Voting** section after the operator submits the tally.
Check the participation, approval, vote weights, and latest tally block.

`APPROVED` and `REJECTED` are completed tally results.
`UNKNOWN` can mean that no successful tally changed the state.

Use [Results and Acceptance](results-and-acceptance.md) to check the stored
result. Continue to execution only when the status is `APPROVED`. The current
lifecycle must also be later than the Proposal lifecycle.

## Execute an Approved Proposal

Follow [Execute an Approved Proposal](execute-a-proposal.md) for the complete
procedure.

The current web application requires the connected wallet to match the proposal creator.
The smart contract does not impose this sender restriction.

The [planned screenshot workflow](web-app-screenshots.md) lists the images that
will be added to this guide.

## If the Page Is Behind

Keep each transaction hash.
Wait for the indexer and processor to project the new event.

For a material or uncertain result, check Mina account state directly.
The web application is not the final source of account state.

## Sources

- `apps/web/README.md`
- `apps/web/features/wallet/containers/wallet-connection-dialog.tsx` — `WalletConnectionDialog`
- `apps/web/features/wallet/containers/wallet-session-provider.tsx` — `WalletSessionProvider`
- `apps/web/features/proposals/containers/proposal-create-page-container.tsx` — `ProposalCreatePageContainer`
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — `ProposalDetailPageContainer`
- `packages/ui/src/treasury/proposals/proposal-creation-form.tsx` — `TreasuryProposalCreationForm`
- `packages/ui/src/treasury/proposals/proposal-detail.tsx` — `TreasuryProposalDetail`
