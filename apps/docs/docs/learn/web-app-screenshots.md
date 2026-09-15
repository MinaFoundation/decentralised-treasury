---
title: Web Application Screenshot Workflow
sidebar_label: Screenshot Workflow
sidebar_position: 10
audience: user
page_kind: reference
---

The text procedures are ready, but the matching screenshot set is not yet
available. This page records the exact images that still need to be added.

:::note Screenshot status

Use the linked text procedure until the matching image is available.

:::

## Planned Screenshot Set

| Step | Planned image                                               | Text procedure                                                                       |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1    | Treasury balance, lifecycle panel, and proposal table       | [Use the Web Application](web-app.md)                                                |
| 2    | Auro and Ledger wallet connection                           | [Signing with Ledger and Auro](signing-with-ledger-and-auro.md)                      |
| 3    | Proposal list, filters, and proposal details                | [Use the Web Application](web-app.md#browse-and-search)                              |
| 4    | Proposal form, Markdown preview, bond, and transaction flow | [Create a Proposal](create-a-proposal.md#create-in-the-web-application)              |
| 5    | Vote choices, voting weight, and transaction flow           | [Vote](vote.md#vote-in-the-web-application)                                          |
| 6    | Result, participation, approval, and vote weights           | [Results and Acceptance](results-and-acceptance.md)                                  |
| 7    | Remaining amount and execution action                       | [Execute an Approved Proposal](execute-a-proposal.md#execute-in-the-web-application) |

Each screenshot must show the selected Mina network and must hide private
values. Use one consistent viewport and one example proposal through the
complete set.

## Sources

- `apps/web/features/proposals/containers/proposal-create-page-container.tsx`
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx`
- `packages/ui/src/treasury/proposals/proposal-creation-form.tsx`
- `packages/ui/src/treasury/proposals/proposal-detail.tsx`
