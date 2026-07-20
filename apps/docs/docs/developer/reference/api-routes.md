---
title: API Routes
sidebar_label: API Routes
---

The API surface is split across app API, indexer API, and processor API.

## App API

- staking ledger account and witness reads,
- voting ledger account reads,
- proposal content validation and submission.

## Indexer API

- event reads,
- indexer status,
- health checks.

## Processor API

- proposal projections,
- vote projections,
- nullifiers,
- tallies,
- executions,
- processor status.

## Source Material

- `apps/api/README.md`
- `apps/api/src/*routes.ts`
