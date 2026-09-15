---
title: State And Reconciliation
sidebar_label: State and reconciliation
audience: operator
page_kind: concept
---

# State And Reconciliation

Reconciliation means comparing the state that should exist with the state that
each system actually reports. It answers a more useful question than “is the
process running?”

The Treasury needs reconciliation because one accepted Mina change travels
through several asynchronous services before it appears in the web
application.

## Begin At The First Authority

Check systems in dependency order:

1. Mina transaction and account state.
2. Archive block, event, or action record.
3. Indexer record and cursor.
4. Processor view and offset.
5. App API response.
6. Web display.

Stop at the first difference. A later layer cannot correct missing data in an
earlier layer.

For example, if Mina stores `APPROVED` but the web shows `UNKNOWN`, first check
that Archive exposes the tally event. Then check indexer and processor
progress. Do not submit another tally only to refresh the page.

## Health Is Not Readiness

An HTTP health route usually shows that a process can answer a request. It does
not show that the process has the correct network, recent data, or a usable
downstream connection.

Readiness for the Treasury needs stronger checks:

| Component | Useful readiness question                                |
| --------- | -------------------------------------------------------- |
| Mina      | Is the node on the selected network and synchronized?    |
| Archive   | Does its head advance for the same network?              |
| Indexer   | Do its pending and canonical cursors approach the head?  |
| Processor | Does its offset approach the indexer sequence?           |
| API       | Does it return the configured Treasury and current data? |
| Worker    | Can it read the selected trace and write a proof result? |

## Pending, Canonical, And Orphaned Records

The indexer can observe a recent block before it becomes canonical. It marks
records as pending while that branch can still change.

A canonical record belongs to the selected canonical chain. An orphaned
record belonged to a branch that is no longer active. The processor recomputes
its active views when indexed records change finality or become orphaned.

This is why the newest application result can be active but not yet final.
Show the finality state instead of converting every recent result into a
simple success or failure label.

## Reconcile Configuration As Well As Data

Two processes can both be healthy while using different values. Compare the
resolved values for:

- network ID and endpoints;
- contract addresses;
- lifecycle duration and deployment slot;
- verification keys and empty roots;
- lifecycle ID and staking root;
- database, SQLite, and Redis locations.

After a deployment, read contract state from Mina and compare it with the
compiled and generated values. After a proof run, compare public inputs with
Proposal state before you submit the tally.

## Recover From The First Broken Boundary

When a durable stage contains partial or inconsistent state:

1. Stop the processes that can write or consume the affected lifecycle.
2. Identify the last trustworthy input.
3. Move invalid outputs out of the live data path.
4. Rebuild from the original snapshot or event stream.
5. Compare roots, offsets, and account state.
6. Start consumers only after the checks pass.

Use the applicable [failure procedure](../failures/index.md) for the exact
commands. Use [Events and projections](../architecture/events-and-projections.md)
for finality and replay details.

## Sources

- `packages/indexer/src/events-indexer.ts`
- `packages/indexer/src/events-repository.ts`
- `packages/indexer/src/entities.ts`
- `packages/processor/src/events-processor.ts`
- `packages/processor/src/processor-data-source.ts`
- `apps/api/src/indexer-status-routes.ts`
- `apps/api/src/processor-status-routes.ts`
- `devops/compose.yml`
