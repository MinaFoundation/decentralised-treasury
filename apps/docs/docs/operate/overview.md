---
title: Operator Overview
sidebar_label: Two-minute overview
audience: operator
page_kind: overview
---

# Operator Overview

The operator keeps the Treasury usable without replacing its on-chain rules.
The work connects a Mina network, deployed contracts, historical staking
ledgers, proof workers, application services, and public interfaces.

## The Operator's Main Job

Keep each layer connected to the same network, contract addresses, lifecycle
configuration, and ledger data. Then compare the result at each boundary.

The operator performs five types of work:

1. Select and record configuration.
2. Deploy contracts and services.
3. Preserve the staking ledger for each lifecycle.
4. Prepare proofs and submit tallies.
5. Reconcile Mina state with indexed and processed views.

The operator does not decide whether a valid proposal is approved. The
contracts apply the tally rules to the proof results.

## The Systems You Keep Connected

| Layer                 | What the operator needs from it                      |
| --------------------- | ---------------------------------------------------- |
| Mina node             | Transactions and account state                       |
| Archive node          | Blocks, events, and actions                          |
| Treasury contracts    | Lifecycle, authorization, tally, and execution rules |
| Ledger pipeline       | The exact recorded staking snapshot                  |
| Proof pipeline        | Voting-ledger and vote-reduction proofs              |
| Indexer and processor | Current public read models                           |
| API and web           | User access to content and projected state           |

## Two Supported Infrastructure Paths

The Compose path runs the application services on one long-running cloud host.
It uses external live-testnet Mina, Archive, and staking-snapshot services.
Use the [Compose live-testnet procedure](deployment/compose-testnet.md) for this
path.

The Kubernetes path includes ordered network and Treasury runbooks. Use it
when the deployment needs cluster resources, Helm releases, and the lifecycle
pipeline described by those runbooks.

Both paths use the same Treasury configuration and contract rules. Do not mix
environment values between them.

The o1js simulator, Mina-repository single node, and Docker Lightnet are
Developer networks. They are not operator deployment paths.

## The Most Important Operating Habit

Do not treat one healthy HTTP response as proof that the system is current.
After each important action, check the authoritative state and the downstream
progress:

1. Mina account state or transaction result;
2. Archive head and records;
3. indexer cursor;
4. processor offset;
5. API and web view.

Continue to the [operator quickstart](quickstart.md) for the shortest complete
path. If the stack is unfamiliar, first read [What you operate](foundations/what-you-operate.md).

## Sources

- `README.md`
- `devops/README.md`
- `devops/compose.yml`
- `apps/api/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`
- `packages/sdk/README.md`
