---
title: Indexer and Processor
sidebar_label: Indexer and Processor
---

The indexer and processor turn chain events into application-readable state.

## Indexer

The indexer reads Archive GraphQL events, resolves event type, stores normalized event rows, tracks pending/canonical cursors, and exposes event reads.

## Processor

The processor reads typed events from the indexer API, dispatches them through handlers, and writes projection tables for proposals, votes, nullifiers, tallies, and executions.

## Design Principle

Event type is immutable after ingest. Unknown or unresolved events fail ingestion instead of being patched later.

## Source Material

- `packages/indexer/README.md`
- `packages/processor/README.md`
- `apps/api/src/processors/proposals/`
