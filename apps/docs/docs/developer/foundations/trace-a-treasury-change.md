---
title: Trace A Treasury Change
sidebar_label: Trace a Treasury change
audience: developer
page_kind: concept
---

# Trace A Treasury Change

The easiest way to understand this codebase is to follow one real behavior
through it. Proposal creation is a useful example because it touches the
browser, content API, SDK, Mina contracts, events, indexer, processor, and
read APIs.

## 1. The Browser Collects The Request

The proposal creation page collects the lifecycle, recipient, amount, and
Markdown content. The browser worker calculates the content commitment and
builds the provable transaction work outside the main UI thread.

The shared UI package supplies the form components. The web feature owns page
state, wallet interaction, submission progress, and transaction inclusion
checks.

Start here when a problem exists before wallet approval:

- `apps/web/features/proposals/containers/proposal-create-page-container.tsx`
- `apps/web/features/proposals/lib/proposal-prover-runtime.ts`
- `apps/web/features/proposals/workers/treasury-proposal.worker.ts`

## 2. Content And Contract State Take Different Paths

The Markdown goes to the App API. The hash-based `zkAppUri` goes into the Mina
transaction. The API stores content only when its calculated value matches the
submitted commitment.

This split lets the application serve readable text while the Proposal account
binds that text to Mina state.

Start here when content is missing or has a mismatch:

- `apps/api/src/proposal-content-routes.ts`
- `packages/sdk/src/utils/proposal-content-hash.ts`
- `apps/web/features/proposals/lib/proposal-content-submission.ts`

## 3. The SDK Builds The Mina Update

The CLI and web code both use Treasury domain code from `packages/sdk`. The CLI
uses the Treasury Owner service to prepare Proposal data, signers, and the
contract call. The browser worker builds the same contract flow for the web
application.

`TreasuryOwnerSmartContract.createProposal` checks the lifecycle period,
Treasury pause state, bond transfer, snapshot values, and Proposal update. It
creates the Proposal account under the Treasury Owner token and emits a
`ProposalCreated` event.

Start here when Mina rejects the transaction or stores unexpected state:

- `packages/sdk/src/services/treasury-owner-service.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/events/treasury-proposal-events.ts`

## 4. Archive And Indexer Preserve The Event

After Mina accepts the transaction, Archive exposes its event data. The
indexer polls block ranges, resolves the event discriminator, and stores a
typed record with pending, canonical, or orphaned status.

The generic indexer does not know how a Proposal page should look. Its job is
to preserve ordered, typed network observations and cursor progress.

Start here when Mina state changed but no typed event appears:

- `packages/indexer/src/archive/`
- `packages/indexer/src/events-indexer.ts`
- `packages/indexer/src/events-repository.ts`
- `packages/indexer/src/entities.ts`

## 5. The Processor Builds The Proposal View

The generic processor reads typed events in order. The Treasury-specific
`ProposalCreatedEventHandler` decodes the event and updates proposal projection
records. It also connects the projected commitment to stored proposal content.

The processor advances its offset only with the applicable database update.
A failing event blocks later events until retry or reconciliation resolves it.

Start here when the indexed event exists but the API result is missing:

- `packages/processor/src/events-processor.ts`
- `apps/api/src/processor.ts`
- `apps/api/src/processors/proposals/proposal-created-event-handler.ts`
- `apps/api/src/processors/proposals/proposal-projection-reconciler.ts`

## 6. APIs And The Browser Read The View

The App API combines projection data, content, and lifecycle ledger data for
proposal list and detail routes. The browser turns that response into a status
and a content-check display.

Start here when the database is correct but the user sees the wrong result:

- `apps/api/src/proposal-list-routes.ts`
- `apps/api/src/proposal-search-routes.ts`
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx`
- `apps/web/features/proposals/lib/proposal-presentation.ts`

## Use The Trace For Your Own Change

Ask these questions in order:

1. Which layer owns the rule?
2. Which data crosses the next boundary?
3. Is that data contract state, an event, an API shape, or display-only state?
4. Which consumer can break if the shape or meaning changes?
5. Which narrow test proves each boundary?
6. Does the change need User, Operator, or Developer documentation?

Do not edit every layer by default. Follow the value until its meaning stops.
Then run the checks described in the [testing guide](../testing.md).

## Sources

- `apps/web/features/proposals/`
- `apps/api/src/proposal-content-routes.ts`
- `apps/api/src/proposal-list-routes.ts`
- `apps/api/src/processors/proposals/`
- `packages/sdk/src/services/treasury-owner-service.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/events/treasury-proposal-events.ts`
- `packages/indexer/src/`
- `packages/processor/src/`
